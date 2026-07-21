/**
 * Sync engine - orchestrates the sync process
 */

import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../utils/logger.ts";
import type { EffectiveSelectors } from "../config/load.ts";
import { createNotionClient } from "../notion/client.ts";
import { buildTree, fetchAllBlocks, countPages } from "../notion/tree.ts";
import { writePageTree } from "../markdown/writer.ts";
import {
  INDEX_DIR,
  createEmptyIndex,
  loadIndex,
  writeIndex,
  type SyncIndex,
  type PageState,
} from "./index.ts";

export interface SyncOptions {
  outputDir: string;
  notionToken: string;
  dryRun: boolean;
  /** Auto-create index when missing (config-driven multi-source sync). */
  rootPageId?: string;
  /** Per-source include/exclude selectors for build-time pruning. */
  selectors?: EffectiveSelectors;
  maxDepth?: number;
}

/**
 * Ensure a per-source sync index exists, creating one when absent.
 */
export async function ensureSyncIndex(outputDir: string, rootPageId: string): Promise<SyncIndex> {
  const existing = await loadIndex(outputDir);
  if (existing) {
    if (existing.rootPageId !== rootPageId) {
      throw new Error(
        `Index rootPageId mismatch in ${outputDir}: index has ${existing.rootPageId}, config expects ${rootPageId}`
      );
    }
    return existing;
  }

  await mkdir(outputDir, { recursive: true });
  await mkdir(join(outputDir, INDEX_DIR), { recursive: true });

  const index = createEmptyIndex(rootPageId);
  await writeIndex(outputDir, index);
  log.info(`Created sync index for root page ${rootPageId} in ${outputDir}`);

  return index;
}

/**
 * Load or create the sync index for a pull run.
 */
async function resolveSyncIndex(outputDir: string, rootPageId?: string): Promise<SyncIndex | null> {
  const index = await loadIndex(outputDir);
  if (index) {
    if (rootPageId !== undefined && index.rootPageId !== rootPageId) {
      throw new Error(
        `Index rootPageId mismatch in ${outputDir}: index has ${index.rootPageId}, config expects ${rootPageId}`
      );
    }
    return index;
  }

  if (rootPageId === undefined) {
    return null;
  }

  return ensureSyncIndex(outputDir, rootPageId);
}

/**
 * Pull Notion pages under a single root into one output directory.
 */
export async function sync(options: SyncOptions): Promise<void> {
  log.info(`Starting sync to ${options.outputDir}`);

  if (options.dryRun) {
    log.info("Dry run mode - no changes will be made");
  }

  // 1. Load sync index
  const index = await resolveSyncIndex(options.outputDir, options.rootPageId);
  if (!index) {
    log.error("No sync configuration found. Run 'notion-rsync init <page-id>' first.");
    return;
  }

  log.info(`Syncing from root page: ${index.rootPageId}`);

  // 2. Create Notion client
  const client = createNotionClient({ token: options.notionToken });

  // 3. Build page tree
  log.info("Building page tree...");
  const treeOptions =
    options.selectors !== undefined ? { selectors: options.selectors } : {};
  const tree = await buildTree(client, index.rootPageId, options.maxDepth ?? 10, treeOptions);
  const pageCount = countPages(tree);
  log.info(`Found ${pageCount} pages`);

  // 4. Fetch all blocks
  log.info("Fetching page content...");
  const treeWithBlocks = await fetchAllBlocks(client, tree);

  // 5. Convert to markdown and write files
  log.info("Writing markdown files...");
  const results = await writePageTree(treeWithBlocks, {
    outputDir: options.outputDir,
    dryRun: options.dryRun,
  });

  log.info(`Processed ${results.size} pages`);

  if (options.dryRun) {
    log.info("Dry run complete - no files written");
    return;
  }

  // 6. Update index with new page states
  const pages: Record<string, PageState> = {};
  for (const [pageId, result] of results) {
    pages[pageId] = {
      path: result.path,
      title: result.title,
      lastEdited: new Date().toISOString(),
    };
  }

  const updatedIndex: SyncIndex = {
    ...index,
    lastSync: new Date().toISOString(),
    pages,
  };
  await writeIndex(options.outputDir, updatedIndex);

  // 7. Remove stale files (pages deleted in Notion)
  const stalePageIds = findStalePages(index.pages, pages);
  if (stalePageIds.length > 0) {
    log.info(`Removing ${stalePageIds.length} stale files...`);
    await removeStaleFiles(options.outputDir, index.pages, stalePageIds, options.dryRun);
  }

  log.info("Sync complete!");
}

/**
 * Find page IDs that exist in old index but not in new results
 */
function findStalePages(
  oldPages: Record<string, PageState>,
  newPages: Record<string, PageState>
): string[] {
  const stale: string[] = [];
  for (const pageId of Object.keys(oldPages)) {
    if (!(pageId in newPages)) {
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
