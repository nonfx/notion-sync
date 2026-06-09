/**
 * Push engine — sync a local markdown tree *up* to Notion (markdown → Notion).
 *
 * This is the reverse of `engine.ts`. It walks a local directory of markdown
 * files (see `local/scan.ts`), creates/updates the corresponding Notion pages
 * preserving the folder hierarchy, converts the markdown content to Notion
 * blocks, and rewrites internal links between files into Notion page mentions.
 *
 * It works in two cases:
 *   1. Round-trip: a folder previously synced from Notion (files carry a
 *      `notion_id` in frontmatter) — existing pages are updated in place.
 *   2. Brand-new: a hand-authored folder with no ids — pages are created under
 *      a target parent page and the new ids are recorded in the index.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createNotionClient } from "../notion/client.ts";
import { createNotionWriter, type NotionWriter, type PageParent } from "../notion/writer.ts";
import { scanDirectory, flattenNodes, type LocalNode } from "../local/scan.ts";
import { resolveLocalLinks, type PathIdMap } from "../local/links.ts";
import { parseMarkdownBlocks } from "../markdown/parser.ts";
import { normalizeNotionId } from "../markdown/inline.ts";
import { upsertFrontmatter } from "../markdown/frontmatter.ts";
import { log } from "../utils/logger.ts";
import {
  loadIndex,
  writeIndex,
  createEmptyIndex,
  INDEX_DIR,
  type SyncIndex,
  type PageState,
} from "./index.ts";

export interface PushOptions {
  outputDir: string;
  notionToken?: string;
  /** Target Notion parent page for new top-level pages (defaults to index root) */
  parentPageId?: string;
  parentType?: "page" | "database";
  dryRun?: boolean;
  /** Injectable writer (for tests). Falls back to the real Notion writer. */
  writer?: NotionWriter;
}

export interface PushResult {
  created: number;
  updated: number;
  pages: number;
}

export async function push(options: PushOptions): Promise<PushResult> {
  log.info(`Pushing ${options.outputDir} to Notion`);
  if (options.dryRun) log.info("Dry run mode - no changes will be made");

  const index = (await loadIndex(options.outputDir)) ?? null;

  const rootParentId = options.parentPageId ?? index?.rootPageId ?? null;
  const rootParentType = options.parentType ?? "page";

  // Build the local page tree from disk.
  const topNodes = await scanDirectory(options.outputDir);
  const allNodes = flattenNodes(topNodes);
  log.info(`Found ${allNodes.length} local page(s)`);

  if (allNodes.length === 0) {
    log.warn("No markdown files found to push.");
    return { created: 0, updated: 0, pages: 0 };
  }

  // Existing page ids come from two sources, in priority order:
  //   1. each file's `notion_id` frontmatter (self-describing)
  //   2. the sync index, keyed by path (covers files whose frontmatter was
  //      stripped — e.g. hand-authored — but were created by a previous push)
  const indexPathToId = new Map<string, string>();
  if (index) {
    for (const [pageId, state] of Object.entries(index.pages)) {
      indexPathToId.set(state.path, normalizeNotionId(pageId));
    }
  }

  const resolveExistingId = (node: LocalNode): string | null => {
    if (node.notionId) return normalizeNotionId(node.notionId);
    return indexPathToId.get(node.relPath) ?? null;
  };

  // Seed known page ids so existing pages are updated, not recreated.
  // New nodes will be assigned ids during pass 1.
  const pathIdMap: PathIdMap = new Map();
  for (const node of allNodes) {
    const existing = resolveExistingId(node);
    if (existing) pathIdMap.set(node.relPath, existing);
  }

  const writer =
    options.writer ??
    createNotionWriter(createNotionClient({ token: requireToken(options.notionToken) }));

  // A node needs a parent target only if it must be created (no existing id).
  // Top-level new pages therefore require an explicit parent (index root or
  // a CLI-provided page id).
  const topNeedsParent = topNodes.some((n) => !resolveExistingId(n));
  if (topNeedsParent && !rootParentId) {
    throw new Error(
      "No target Notion parent. Run 'notion-rsync init <page-id>' first, " +
        "or pass a parent page id: 'notion-rsync push <parent-page-id>'."
    );
  }

  const result: PushResult = { created: 0, updated: 0, pages: allNodes.length };

  // ---- Pass 1: ensure every page exists (top-down so parents come first). ----
  const resolvedIds = new Map<LocalNode, string>();

  async function ensurePages(nodes: LocalNode[], parent: PageParent): Promise<void> {
    for (const node of nodes) {
      let pageId: string;
      const existingId = resolveExistingId(node);

      if (existingId) {
        pageId = existingId;
        if (options.dryRun) {
          log.info(`[dry-run] Would update page: ${node.title} (${node.relPath})`);
        } else {
          await writer.setTitle(pageId, node.title);
        }
        result.updated++;
      } else if (options.dryRun) {
        pageId = `dry-${node.relPath}`;
        log.info(`[dry-run] Would create page: ${node.title} (under ${parent.id})`);
        result.created++;
      } else {
        pageId = await writer.createPage(parent, node.title);
        log.info(`Created page: ${node.title} -> ${pageId}`);
        result.created++;
      }

      resolvedIds.set(node, pageId);
      pathIdMap.set(node.relPath, pageId);

      if (node.children.length > 0) {
        await ensurePages(node.children, { id: pageId, type: "page" });
      }
    }
  }

  await ensurePages(topNodes, { id: rootParentId ?? "", type: rootParentType });

  // ---- Pass 2: push content (links now resolvable to real page ids). ----
  for (const node of allNodes) {
    const pageId = resolvedIds.get(node)!;
    const resolvedBody = resolveLocalLinks(node.body, node.relPath, pathIdMap);
    const blocks = parseMarkdownBlocks(resolvedBody);

    if (options.dryRun) {
      log.info(`[dry-run] Would write ${blocks.length} block(s) to: ${node.relPath}`);
      continue;
    }

    await writer.clearBlocks(pageId);
    if (blocks.length > 0) {
      await writer.appendBlocks(pageId, blocks);
    }
    log.info(`Pushed content: ${node.relPath} (${blocks.length} blocks)`);
  }

  // ---- Stamp notion_id back into files that didn't already carry one. ----
  // This makes the local tree self-describing so the next push recognises
  // these pages and updates them in place instead of creating duplicates.
  if (!options.dryRun) {
    for (const node of allNodes) {
      if (node.notionId) continue; // already self-describing
      const pageId = resolvedIds.get(node)!;
      const updates = { notion_id: pageId, title: JSON.stringify(node.title) };

      if (node.filePath) {
        const raw = await readFile(node.filePath, "utf-8");
        await writeFile(node.filePath, upsertFrontmatter(raw, updates), "utf-8");
      } else {
        // Synthetic page for a folder without an index.md — materialise one so
        // the folder round-trips on the next push.
        const absPath = join(options.outputDir, node.relPath);
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, upsertFrontmatter(`# ${node.title}\n`, updates), "utf-8");
      }
      log.debug(`Stamped notion_id into ${node.relPath}`);
    }
  }

  // ---- Update the sync index so a subsequent pull/push stays idempotent. ----
  if (!options.dryRun) {
    const base = index ?? createEmptyIndex(rootParentId ?? resolvedIds.get(topNodes[0]!) ?? "");
    const pages: Record<string, PageState> = {};
    const now = new Date().toISOString();
    for (const node of allNodes) {
      const pageId = resolvedIds.get(node)!;
      pages[pageId] = { path: node.relPath, title: node.title, lastEdited: now };
    }
    const updated: SyncIndex = {
      ...base,
      rootPageId: rootParentId ?? base.rootPageId,
      lastSync: now,
      pages,
    };
    await mkdir(join(options.outputDir, INDEX_DIR), { recursive: true });
    await writeIndex(options.outputDir, updated);
  }

  log.info(
    `Push complete: ${result.created} created, ${result.updated} updated (${result.pages} pages)`
  );
  return result;
}

function requireToken(token: string | undefined): string {
  if (!token) throw new Error("NOTION_TOKEN is required to push to Notion.");
  return token;
}
