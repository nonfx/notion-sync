/**
 * Scan a local directory of markdown files into a tree of pages.
 *
 * Mirrors the structure the writer produces when syncing Notion → markdown:
 *   - A directory's `index.md` is the page for that directory; the other
 *     markdown files and subdirectories in it become its children.
 *   - A directory with no `index.md` still becomes a page (titled after the
 *     directory) so it can hold its children.
 *   - A standalone `.md` file is a leaf page.
 *
 * This also works for brand-new, hand-authored folder structures.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename, relative } from "node:path";
import { parseMarkdownFile } from "../markdown/frontmatter.ts";
import { INDEX_DIR } from "../sync/index.ts";

export interface LocalNode {
  /** Path to the backing markdown file, relative to the scan root (POSIX-style) */
  relPath: string;
  /** Absolute path to the backing markdown file (null for synthetic dir pages) */
  filePath: string | null;
  /** Page title */
  title: string;
  /** Existing Notion page id (from frontmatter), or null if not yet synced */
  notionId: string | null;
  /** Markdown body (frontmatter/header/title stripped) */
  body: string;
  /** Child pages */
  children: LocalNode[];
}

function toPosix(path: string): string {
  return path.split(/[\\/]/).join("/");
}

function titleFromFilename(name: string): string {
  return name
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Scan a directory, returning the top-level page nodes.
 *
 * If the root directory itself contains an `index.md`, the whole tree is rooted
 * at that single page; otherwise the root's entries form a forest of pages.
 */
export async function scanDirectory(rootDir: string): Promise<LocalNode[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const hasIndex = entries.some((e) => e.isFile() && e.name.toLowerCase() === "index.md");

  const children = await scanDir(rootDir, rootDir);

  if (hasIndex) {
    return [await readNode(join(rootDir, "index.md"), rootDir, children)];
  }
  return children;
}

async function scanDir(dir: string, rootDir: string): Promise<LocalNode[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => e.name)
    .toSorted();
  const subdirs = entries
    .filter((e) => e.isDirectory() && e.name !== INDEX_DIR && !e.name.startsWith("."))
    .map((e) => e.name)
    .toSorted();

  const nodes: LocalNode[] = [];

  // Leaf markdown files (everything except index.md, which represents a dir).
  for (const file of files) {
    if (file.toLowerCase() === "index.md") continue;
    nodes.push(await readNode(join(dir, file), rootDir, []));
  }

  // Subdirectories become pages (their index.md, or a synthetic page).
  for (const sub of subdirs) {
    nodes.push(await scanSubdir(join(dir, sub), rootDir));
  }

  return nodes;
}

async function scanSubdir(dir: string, rootDir: string): Promise<LocalNode> {
  const entries = await readdir(dir, { withFileTypes: true });
  const hasIndex = entries.some((e) => e.isFile() && e.name.toLowerCase() === "index.md");

  const children = await scanDir(dir, rootDir);

  if (hasIndex) {
    return readNode(join(dir, "index.md"), rootDir, children);
  }

  // No index.md — synthesize a page to hold the children.
  return {
    relPath: toPosix(relative(rootDir, join(dir, "index.md"))),
    filePath: null,
    title: titleFromFilename(basename(dir)),
    notionId: null,
    body: "",
    children,
  };
}

async function readNode(
  filePath: string,
  rootDir: string,
  children: LocalNode[]
): Promise<LocalNode> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = parseMarkdownFile(raw);
  const title = parsed.title ?? titleFromFilename(basename(filePath));

  return {
    relPath: toPosix(relative(rootDir, filePath)),
    filePath,
    title,
    notionId: parsed.notionId,
    body: parsed.body,
    children,
  };
}

/** Depth-first flatten of one or more node trees. */
export function flattenNodes(nodes: LocalNode[]): LocalNode[] {
  const out: LocalNode[] = [];
  for (const node of nodes) {
    out.push(node);
    out.push(...flattenNodes(node.children));
  }
  return out;
}
