/**
 * Sync engine - orchestrates the sync process
 */

import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../utils/logger.ts";
import { createNotionClient } from "../notion/client.ts";
import {
  buildTree,
  fetchAllBlocks,
  fetchBlocksFiltered,
  countPages,
  flattenTree,
  type PageNode,
} from "../notion/tree.ts";
import { writePageTree, computeLinkMap } from "../markdown/writer.ts";
import { loadIndex, writeIndex, type SyncIndex, type PageState } from "./index.ts";

export interface SyncOptions {
  outputDir: string;
  notionToken: string;
  dryRun: boolean;
  /** Re-fetch every page even if it looks unchanged */
  force?: boolean;
}

const normalizeId = (id: string): string => id.replace(/-/g, "");

/** How the planner classified each page */
export interface SyncPlan {
  /** Normalized IDs that need their content fetched and rewritten */
  changedIds: Set<string>;
  /** Normalized IDs that are up to date and can be skipped entirely */
  unchangedIds: Set<string>;
  newCount: number;
}

/**
 * Decide which pages actually need fetching. A page is skippable only when
 * every cheap signal says nothing moved:
 *
 *   - the index has an entry for it,
 *   - the page's real last_edited_time matches the index,
 *   - its title matches (a rename changes its slug and its parents' links),
 *   - it would be written to the same path as last time (a renamed ancestor
 *     moves the whole subtree even when the page itself didn't change),
 *   - the file actually exists on disk.
 *
 * Anything else re-fetches. Pre-incremental indexes stamped lastEdited with
 * the sync time, so their first incremental run re-fetches everything once
 * and heals the index.
 */
export function planSync(
  nodes: PageNode[],
  index: SyncIndex,
  pathFor: (id: string) => string | undefined,
  fileExists: (relPath: string) => boolean
): SyncPlan {
  const changedIds = new Set<string>();
  const unchangedIds = new Set<string>();
  let newCount = 0;

  for (const node of nodes) {
    const normId = normalizeId(node.id);
    const oldState = lookupPageState(index, node.id);

    if (!oldState) {
      newCount++;
      changedIds.add(normId);
      continue;
    }

    const newPath = pathFor(node.id);
    const unchanged =
      oldState.lastEdited === node.lastEditedTime &&
      oldState.title === node.title &&
      newPath !== undefined &&
      oldState.path === newPath &&
      fileExists(newPath);

    if (unchanged) {
      unchangedIds.add(normId);
    } else {
      changedIds.add(normId);
    }
  }

  // Second pass: a page's rendered content embeds relative paths to the pages
  // it links to, so a skipped page goes stale when a link target moved (or a
  // previously-unresolvable target now exists). Demote those to changed.
  // (Deleting the current entry while iterating a Set is well-defined.)
  for (const normId of unchangedIds) {
    const oldState = lookupPageState(index, normId);
    if (!oldState?.links?.length) continue;

    const linkTargetMoved = oldState.links.some((linkId) => {
      const oldTargetPath = lookupPageState(index, linkId)?.path;
      const newTargetPath = pathFor(linkId);
      return oldTargetPath !== newTargetPath;
    });

    if (linkTargetMoved) {
      unchangedIds.delete(normId);
      changedIds.add(normId);
    }
  }

  return { changedIds, unchangedIds, newCount };
}

/** Index entries may be keyed with or without dashes — try both */
export function lookupPageState(index: SyncIndex, pageId: string): PageState | undefined {
  const normId = normalizeId(pageId);
  const dashedId = normId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  return index.pages[pageId] ?? index.pages[normId] ?? index.pages[dashedId];
}

export async function sync(options: SyncOptions): Promise<void> {
  log.info(`Starting sync to ${options.outputDir}`);

  if (options.dryRun) {
    log.info("Dry run mode - no changes will be made");
  }

  // 1. Load sync index
  const index = await loadIndex(options.outputDir);
  if (!index) {
    log.error("No sync configuration found. Run 'notion-rsync init <page-id>' first.");
    return;
  }

  log.info(`Syncing from root page: ${index.rootPageId}`);

  // 2. Create Notion client
  const client = createNotionClient({ token: options.notionToken });

  // 3. Build page tree (metadata only — this is the cheap listing pass, and
  //    it carries each page's real last_edited_time)
  log.info("Building page tree...");
  const tree = await buildTree(client, index.rootPageId);
  const pageCount = countPages(tree);
  log.info(`Found ${pageCount} pages`);

  // 4. Plan: diff the tree against the index and only fetch what moved
  const nodes = flattenTree(tree);
  const linkMap = computeLinkMap(tree, options.outputDir);
  const plan = options.force
    ? null
    : planSync(
        nodes,
        index,
        (id) => linkMap.get(id) ?? linkMap.get(normalizeId(id)),
        (relPath) => existsSync(join(options.outputDir, relPath))
      );

  // 5. Fetch blocks — all of them under --force, otherwise only changed pages
  let treeWithBlocks: PageNode;
  if (!plan) {
    log.info(`Fetching page content (all ${pageCount} pages, --force)...`);
    treeWithBlocks = await fetchAllBlocks(client, tree);
  } else if (plan.changedIds.size === 0) {
    log.info("Everything up to date — nothing to fetch.");
    treeWithBlocks = tree;
  } else {
    log.info(
      `Fetching page content (${plan.changedIds.size} changed` +
        `${plan.newCount > 0 ? `, ${plan.newCount} new` : ""}, ` +
        `${plan.unchangedIds.size} unchanged skipped)...`
    );
    treeWithBlocks = await fetchBlocksFiltered(client, tree, plan.changedIds);
  }

  // 6. Convert to markdown and write files (skipping unchanged pages)
  log.info("Writing markdown files...");
  const results = await writePageTree(treeWithBlocks, {
    outputDir: options.outputDir,
    dryRun: options.dryRun,
    skipIds: plan?.unchangedIds,
  });

  const writtenCount = [...results.values()].filter((r) => r.written).length;
  log.info(`Processed ${results.size} pages (${writtenCount} written)`);

  if (options.dryRun) {
    log.info("Dry run complete - no files written");
    return;
  }

  // 7. Update index with new page states. Written pages record the page's
  //    real last_edited_time (NOT the sync time — stamping sync time is what
  //    used to make incremental diffing impossible); skipped pages carry
  //    their existing state forward.
  const lastEditedById = new Map<string, string>();
  for (const node of nodes) {
    lastEditedById.set(normalizeId(node.id), node.lastEditedTime);
  }

  const pages: Record<string, PageState> = {};
  for (const [pageId, result] of results) {
    if (result.written) {
      pages[pageId] = {
        path: result.path,
        title: result.title,
        lastEdited: lastEditedById.get(normalizeId(pageId)) ?? new Date().toISOString(),
        ...(result.links?.length ? { links: result.links } : {}),
      };
    } else {
      const oldState = lookupPageState(index, pageId);
      pages[pageId] = oldState ?? {
        path: result.path,
        title: result.title,
        lastEdited: lastEditedById.get(normalizeId(pageId)) ?? new Date().toISOString(),
      };
    }
  }

  const updatedIndex: SyncIndex = {
    ...index,
    lastSync: new Date().toISOString(),
    pages,
  };
  await writeIndex(options.outputDir, updatedIndex);

  // 8. Remove stale files (pages deleted in Notion)
  const stalePageIds = findStalePages(index.pages, pages);
  if (stalePageIds.length > 0) {
    log.info(`Removing ${stalePageIds.length} stale files...`);
    await removeStaleFiles(options.outputDir, index.pages, stalePageIds, options.dryRun);
  }

  log.info("Sync complete!");
}

/**
 * Find page IDs that exist in old index but not in new results.
 * Key formats may differ between index generations, so compare normalized.
 */
function findStalePages(
  oldPages: Record<string, PageState>,
  newPages: Record<string, PageState>
): string[] {
  const newIds = new Set(Object.keys(newPages).map(normalizeId));
  const stale: string[] = [];
  for (const pageId of Object.keys(oldPages)) {
    if (!newIds.has(normalizeId(pageId))) {
      stale.push(pageId);
    }
  }
  return stale;
}

/**
 * Remove files for pages that no longer exist in Notion
 */
async function removeStaleFiles(
  outputDir: string,
  oldPages: Record<string, PageState>,
  stalePageIds: string[],
  dryRun?: boolean
): Promise<void> {
  for (const pageId of stalePageIds) {
    const pageState = oldPages[pageId];
    if (!pageState) continue;

    const filePath = join(outputDir, pageState.path);

    if (dryRun) {
      log.info(`[dry-run] Would remove: ${filePath}`);
    } else {
      try {
        await unlink(filePath);
        log.info(`Removed: ${filePath}`);
      } catch (err) {
        // File might already be gone
        log.debug(`Failed to remove ${filePath}: ${err}`);
      }
    }
  }
}
