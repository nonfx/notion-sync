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
  /** False when the page was skipped as unchanged (incremental sync) */
  written: boolean;
  /**
   * Normalized IDs of every notion:// link in the written content. Only
   * present for written pages; incremental sync stores these so a page is
   * re-rendered when a link target's path changes.
   */
  links?: string[];
}

export interface WriterOptions {
  /** Base output directory */
  outputDir: string;
  /** Dry run - don't actually write */
  dryRun?: boolean;
  /**
   * Normalized (dash-less) page IDs to skip writing. Skipped pages still
   * reserve their filenames and appear in the results (written: false) so
   * sibling dedup and index bookkeeping stay correct.
   */
  skipIds?: Set<string>;
}

/**
 * Compute the link map (page ID -> relative path) for a tree without writing
 * anything. This is the same first pass writePageTree runs, exposed so callers
 * can plan an incremental sync before fetching any page content.
 */
export function computeLinkMap(tree: PageNode, outputDir: string): LinkMap {
  const linkMap: LinkMap = new Map();
  buildLinkMap(tree, outputDir, [], new Set<string>(), linkMap);
  return linkMap;
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
  await writePageRecursive(tree, options, [], usedFilenames, results, linkMap);

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
  // Excluded leaf nodes (fully pruned subtrees) are never written and have no path.
  if (page.excluded && page.children.length === 0) {
    return;
  }

  // Excluded node kept only for a buried included descendant: no file of its own,
  // but children still nest under its directory name (mirrors writePageRecursive).
  if (page.excluded) {
    const dirName = slugify(page.title);
    for (const child of page.children) {
      buildLinkMap(child, baseDir, [...pathSegments, dirName], usedFilenames, linkMap);
    }
    return;
  }

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
    // Dedup on the full path: uniqueness matters per directory, and
    // usedFilenames stores full paths. (uniqueFilename suffixes before the
    // .md extension, so it works on paths as well as bare filenames.)
    filePath = uniqueFilename(join(dirPath, slugify(page.title) + ".md"), usedFilenames);
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
  options: WriterOptions,
  pathSegments: string[],
  usedFilenames: Set<string>,
  results: Map<string, WriteResult>,
  linkMap: LinkMap
): Promise<void> {
  const { outputDir: baseDir, dryRun, skipIds } = options;

  // Fully pruned excluded subtree: nothing to write, nothing to recurse into.
  if (page.excluded && page.children.length === 0) {
    return;
  }

  // Excluded node kept only to reach a buried included descendant
  // (include-override): skip its own content/index.md, but still write
  // children at the same nesting depth its directory would have occupied.
  if (page.excluded) {
    const dirName = slugify(page.title);
    for (const child of page.children) {
      await writePageRecursive(
        child,
        options,
        [...pathSegments, dirName],
        usedFilenames,
        results,
        linkMap
      );
    }
    return;
  }

  // Determine directory and filename
  const dirPath = join(baseDir, ...pathSegments);
  const hasChildren = page.children.length > 0;

  let filePath: string;

  if (hasChildren) {
    // Pages with children become directories with index.md
    const dirName = slugify(page.title);
    const pageDir = join(dirPath, dirName);
    filePath = join(pageDir, "index.md");

    // Create directory
    if (!dryRun) {
      await mkdir(pageDir, { recursive: true });
    }

    // Write children
    for (const child of page.children) {
      await writePageRecursive(
        child,
        options,
        [...pathSegments, dirName],
        usedFilenames,
        results,
        linkMap
      );
    }
  } else {
    // Leaf pages are just .md files. Dedup on the full path — usedFilenames
    // stores full paths, so bare-filename comparison never matched and
    // same-title siblings silently overwrote each other.
    filePath = uniqueFilename(join(dirPath, slugify(page.title) + ".md"), usedFilenames);

    // Ensure directory exists
    if (!dryRun) {
      await mkdir(dirPath, { recursive: true });
    }
  }

  usedFilenames.add(filePath);

  const relativePath = filePath.replace(baseDir + "/", "");

  // Unchanged page in an incremental sync: reserve the filename (done above)
  // and record the result, but don't regenerate or rewrite the file.
  if (skipIds?.has(page.id.replace(/-/g, ""))) {
    log.debug(`Unchanged, skipping: ${filePath}`);
    results.set(page.id, {
      pageId: page.id,
      path: relativePath,
      title: page.title,
      written: false,
    });
    return;
  }

  // Convert to markdown
  const md = pageToMarkdown(page);

  // Resolve notion:// links to local paths, recording the link targets
  const linkedIds = new Set<string>();
  const resolvedContent = resolveNotionLinks(md.content, relativePath, linkMap, linkedIds);

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
    written: true,
    links: [...linkedIds].toSorted(),
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
