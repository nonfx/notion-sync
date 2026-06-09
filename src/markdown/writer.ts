/**
 * Write markdown files to disk
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { PageNode } from "../notion/tree.ts";
import { pageToMarkdown, slugify, uniqueFilename } from "./page.ts";
import { resolveNotionLinks, type LinkMap } from "./links.ts";
import { log } from "../utils/logger.ts";

export interface WriteResult {
  pageId: string;
  path: string;
  title: string;
}

export interface WriterOptions {
  /** Base output directory */
  outputDir: string;
  /** Dry run - don't actually write */
  dryRun?: boolean;
}

/**
 * Write a page tree to markdown files
 * Returns mapping of page IDs to file paths
 */
export async function writePageTree(
  tree: PageNode,
  options: WriterOptions
): Promise<Map<string, WriteResult>> {
  const results = new Map<string, WriteResult>();
  const usedFilenames = new Set<string>();

  // First pass: build link map (page ID -> relative path)
  const linkMap: LinkMap = new Map();
  buildLinkMap(tree, options.outputDir, [], usedFilenames, linkMap);

  // Reset for second pass
  usedFilenames.clear();

  // Second pass: write files with resolved links
  await writePageRecursive(
    tree,
    options.outputDir,
    [],
    usedFilenames,
    results,
    linkMap,
    options.dryRun
  );

  return results;
}

/**
 * Build a map of page IDs to their file paths (first pass)
 */
function buildLinkMap(
  page: PageNode,
  baseDir: string,
  pathSegments: string[],
  usedFilenames: Set<string>,
  linkMap: LinkMap
): void {
  const dirPath = join(baseDir, ...pathSegments);
  const hasChildren = page.children.length > 0;

  let filePath: string;

  if (hasChildren) {
    const dirName = slugify(page.title);
    const pageDir = join(dirPath, dirName);
    filePath = join(pageDir, "index.md");

    // Process children
    for (const child of page.children) {
      buildLinkMap(child, baseDir, [...pathSegments, dirName], usedFilenames, linkMap);
    }
  } else {
    const baseFilename = slugify(page.title) + ".md";
    const filename = uniqueFilename(baseFilename, usedFilenames);
    filePath = join(dirPath, filename);
  }

  usedFilenames.add(filePath);

  // Store relative path from baseDir
  const relativePath = filePath.replace(baseDir + "/", "");
  linkMap.set(page.id, relativePath);
  // Also store without dashes (Notion IDs sometimes come both ways)
  linkMap.set(page.id.replace(/-/g, ""), relativePath);
}

async function writePageRecursive(
  page: PageNode,
  baseDir: string,
  pathSegments: string[],
  usedFilenames: Set<string>,
  results: Map<string, WriteResult>,
  linkMap: LinkMap,
  dryRun?: boolean
): Promise<void> {
  // Determine directory and filename
  const dirPath = join(baseDir, ...pathSegments);
  const hasChildren = page.children.length > 0;

  let filename: string;
  let filePath: string;

  if (hasChildren) {
    // Pages with children become directories with index.md
    const dirName = slugify(page.title);
    const pageDir = join(dirPath, dirName);
    filename = "index.md";
    filePath = join(pageDir, filename);

    // Create directory
    if (!dryRun) {
      await mkdir(pageDir, { recursive: true });
    }

    // Write children
    for (const child of page.children) {
      await writePageRecursive(
        child,
        baseDir,
        [...pathSegments, dirName],
        usedFilenames,
        results,
        linkMap,
        dryRun
      );
    }
  } else {
    // Leaf pages are just .md files
    const baseFilename = slugify(page.title) + ".md";
    filename = uniqueFilename(baseFilename, usedFilenames);
    filePath = join(dirPath, filename);

    // Ensure directory exists
    if (!dryRun) {
      await mkdir(dirPath, { recursive: true });
    }
  }

  usedFilenames.add(filePath);

  // Convert to markdown
  const md = pageToMarkdown(page);

  // Resolve notion:// links to local paths
  const relativePath = filePath.replace(baseDir + "/", "");
  const resolvedContent = resolveNotionLinks(md.content, relativePath, linkMap);

  if (dryRun) {
    log.info(`[dry-run] Would write: ${filePath}`);
  } else {
    await writeFile(filePath, resolvedContent, "utf-8");
    log.info(`Wrote: ${filePath}`);
  }

  // Track result
  results.set(page.id, {
    pageId: page.id,
    path: relativePath,
    title: page.title,
  });
}

/**
 * Write a single page (for incremental updates)
 */
export async function writeSinglePage(
  page: PageNode,
  filePath: string,
  dryRun?: boolean
): Promise<void> {
  const md = pageToMarkdown(page);

  if (dryRun) {
    log.info(`[dry-run] Would write: ${filePath}`);
    return;
  }

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, md.content, "utf-8");
  log.info(`Wrote: ${filePath}`);
}
