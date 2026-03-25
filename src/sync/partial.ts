/**
 * Partial sync — fetch and update specific pages by ID.
 *
 * Unlike full sync, this does NOT build the entire page tree.
 * It fetches each requested page directly, converts to markdown,
 * and writes to the path stored in the sync index.
 *
 * New pages (not in the index) get a derived path from their title.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { Client } from "@notionhq/client";
import type { PageNode } from "../notion/tree.ts";
import {
    fetchPage,
    fetchBlocks,
    getPageTitle,
    getPageProperties,
    withRetry,
    type NotionBlock,
} from "../notion/client.ts";
import { pageToMarkdown, slugify } from "../markdown/page.ts";
import { log } from "../utils/logger.ts";
import { loadIndex, writeIndex, type SyncIndex, type PageState } from "./index.ts";

export interface PartialSyncOptions {
    outputDir: string;
    notionToken: string;
    pageIds: Array<string>;
    dryRun: boolean;
}

export async function partialSync(options: PartialSyncOptions): Promise<void> {
    log.info(`Partial sync: ${options.pageIds.length} page(s)`);

    // 1. Load sync index
    const index = await loadIndex(options.outputDir);
    if (!index) {
        log.error("No sync configuration found. Run 'notion-rsync init <page-id>' first.");
        return;
    }

    // 2. Create client
    const client = new Client({ auth: options.notionToken });

    // 3. Fetch and write each page
    let synced = 0;
    for (const rawPageId of options.pageIds) {
        const pageId = rawPageId.replace(/-/g, "");

        try {
            log.info(`Fetching page: ${pageId}`);

            // Fetch page metadata
            const page = await withRetry(() => fetchPage(client, pageId));
            const title = getPageTitle(page);
            const properties = getPageProperties(page);
            const lastEditedTime =
                "last_edited_time" in page ? (page.last_edited_time as string) : new Date().toISOString();

            log.info(`  Found: ${title}`);

            // Fetch blocks
            const blocks = await withRetry(() => fetchBlocks(client, pageId));

            // Build minimal PageNode
            const node: PageNode = {
                id: pageId,
                title,
                lastEditedTime,
                children: [],
                blocks: blocks as Array<NotionBlock>,
                properties,
            };

            // Convert to markdown
            const md = pageToMarkdown(node);

            // Determine file path — use existing index path or derive new one.
            // Index may store page IDs with or without dashes — try both.
            const dashedId = pageId.replace(
                /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
                "$1-$2-$3-$4-$5"
            );
            const existingState =
                index.pages[pageId] ?? index.pages[dashedId];
            const rawPath = existingState?.path ?? deriveFilePath(title, index);
            // The index stores paths that may include the output dir prefix — strip it
            const filePath = rawPath.startsWith(options.outputDir)
                ? rawPath.slice(options.outputDir.length).replace(/^\//, "")
                : rawPath;

            if (options.dryRun) {
                log.info(`  [dry-run] Would write: ${filePath}`);
            } else {
                const fullPath = join(options.outputDir, filePath);
                await mkdir(dirname(fullPath), { recursive: true });
                await writeFile(fullPath, md.content, "utf-8");
                log.info(`  Written: ${filePath}`);
            }

            // Update index — use the same key format as the existing entry
            const indexKey = existingState
                ? (index.pages[pageId] ? pageId : dashedId)
                : pageId;
            index.pages[indexKey] = {
                path: filePath,
                title,
                lastEdited: new Date().toISOString(),
            };

            synced++;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`  Failed to sync page ${pageId}: ${msg}`);
        }
    }

    if (!options.dryRun) {
        index.lastSync = new Date().toISOString();
        await writeIndex(options.outputDir, index);
    }

    log.info(`Partial sync complete: ${synced}/${options.pageIds.length} pages synced`);
}

/**
 * Derive a file path for a page not yet in the index.
 * Uses the page title slugified, placed at the root of the sync tree.
 */
function deriveFilePath(title: string, index: SyncIndex): string {
    const slug = slugify(title);
    // Check for collisions with existing paths
    const existingPaths = new Set(Object.values(index.pages).map((p) => p.path));
    let candidate = `${slug}.md`;
    let counter = 1;
    while (existingPaths.has(candidate)) {
        candidate = `${slug}-${counter}.md`;
        counter++;
    }
    return candidate;
}
