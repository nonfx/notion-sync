/**
 * Page tree structure for representing Notion page hierarchy
 */

import { Client, collectPaginatedAPI, isFullBlock } from "@notionhq/client";
import {
  fetchPage,
  fetchChildren,
  fetchBlocks,
  fetchDatabase,
  fetchDatabasePages,
  isLinkedDatabaseError,
  getPageTitle,
  getDatabaseTitle,
  getPageProperties,
  withRetry,
  type NotionBlock,
  type PropertyValue,
} from "./client.ts";
import { log } from "../utils/logger.ts";
import { normalizeNotionId } from "../config/schema.ts";
import type { EffectiveSelectors } from "../config/load.ts";
import {
  computePendingIncludeIds,
  resolveNodeDecision,
  shouldTraverseExcludedNode,
} from "../config/selector.ts";

/** Options passed through recursive tree building */
export interface TreeBuildOptions {
  selectors?: EffectiveSelectors;
  titlePath?: string[];
  /** Cascades an excluded ancestor's default decision to unmatched descendants. */
  ancestorExcluded?: boolean;
  /** Shared, mutated across the crawl so include-id override search can stop early. */
  pendingIncludeIds?: Set<string>;
}

/** Decision for one node: fetch normally, skip entirely, or skip content but still recurse. */
interface NodePruneResult {
  /** True when this node's own content should not be written, but children still might be. */
  excluded: boolean;
  /** True when children should not be fetched at all. */
  pruneChildren: boolean;
  /** Options to pass down to this node's children. */
  childOptions: TreeBuildOptions;
}

/**
 * Apply selector precedence + include-override traversal for one node, mutating
 * `pendingIncludeIds` when this node itself satisfies a configured include id.
 */
function resolvePruneResult(
  nodeId: string,
  titlePath: string[],
  options: TreeBuildOptions
): NodePruneResult {
  const selectors = options.selectors;
  const childOptions: TreeBuildOptions = { ...options, titlePath };

  if (!selectors) {
    return { excluded: false, pruneChildren: false, childOptions };
  }

  const ancestorExcluded = options.ancestorExcluded ?? false;
  const node = { id: nodeId, titlePath };
  const decision = resolveNodeDecision(node, selectors, ancestorExcluded);

  if (decision === "include") {
    options.pendingIncludeIds?.delete(normalizeNotionId(nodeId));
    return {
      excluded: false,
      pruneChildren: false,
      childOptions: { ...childOptions, ancestorExcluded: false },
    };
  }

  const shouldTraverse = shouldTraverseExcludedNode(node, selectors, options.pendingIncludeIds);
  if (!shouldTraverse) {
    return { excluded: true, pruneChildren: true, childOptions };
  }

  return {
    excluded: true,
    pruneChildren: false,
    childOptions: { ...childOptions, ancestorExcluded: true },
  };
}

/** Default max concurrent requests when config does not override */
export const DEFAULT_TREE_CONCURRENCY = 2;

let treeConcurrency = DEFAULT_TREE_CONCURRENCY;

/**
 * Set crawl concurrency for parallel tree/block fetches (config-driven runs).
 */
export function setTreeConcurrency(concurrency: number): void {
  treeConcurrency = concurrency;
}

/**
 * Reset crawl concurrency to the built-in default (single-root sync).
 */
export function resetTreeConcurrency(): void {
  treeConcurrency = DEFAULT_TREE_CONCURRENCY;
}

/**
 * Run promises with limited concurrency
 */
async function runWithConcurrency<T>(tasks: Promise<T>[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task.then((result) => {
      results.push(result);
      executing.splice(executing.indexOf(p), 1);
    });
    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

// Re-export PropertyValue from client
export type { PropertyValue } from "./client.ts";

export interface PageNode {
  id: string;
  title: string;
  lastEditedTime: string;
  children: PageNode[];
  blocks: NotionBlock[] | null; // null means not fetched yet
  isDatabase?: boolean; // true for database nodes (no blocks to fetch)
  properties?: Record<string, PropertyValue>; // Metadata from database entry
  /** True when this node itself is excluded by selectors (only traversed for a buried include). */
  excluded?: boolean;
}

/**
 * Build a tree starting from a root ID (auto-detects page vs database)
 */
export async function buildTree(
  client: Client,
  rootId: string,
  maxDepth = 10,
  options: TreeBuildOptions = {}
): Promise<PageNode> {
  const initializedOptions: TreeBuildOptions = {
    ...options,
    pendingIncludeIds: options.pendingIncludeIds ?? computePendingIncludeIds(options.selectors),
  };

  // Try fetching as a page first, fall back to database
  try {
    return await buildPageTree(client, rootId, 0, maxDepth, initializedOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("is a database")) {
      log.info("Root is a database, fetching entries...");
      const databaseTree = await buildDatabaseTree(client, rootId, maxDepth, 0, initializedOptions);
      if (!databaseTree) {
        throw new Error(`Cannot sync linked database root: ${rootId}`);
      }
      return databaseTree;
    }
    throw err;
  }
}

/**
 * Build a tree from a database (entries become child pages)
 */
export async function buildDatabaseTree(
  client: Client,
  databaseId: string,
  maxDepth = 10,
  depth = 0,
  options: TreeBuildOptions = {}
): Promise<PageNode | null> {
  let database;
  try {
    database = await fetchDatabase(client, databaseId);
  } catch (error) {
    if (isLinkedDatabaseError(error)) {
      log.warn(`Skipping linked database view: ${databaseId}`);
      return null;
    }
    throw error;
  }
  const title = getDatabaseTitle(database);
  const titlePath = [...(options.titlePath ?? []), title];

  log.info(`${"  ".repeat(depth)}Found database: ${title}`);

  const { excluded, pruneChildren, childOptions } = resolvePruneResult(database.id, titlePath, options);
  if (pruneChildren) {
    log.debug(`${"  ".repeat(depth)}Pruned database subtree: ${title}`);
    return {
      id: database.id,
      title,
      lastEditedTime: database.last_edited_time,
      children: [],
      blocks: null,
      isDatabase: true,
      excluded,
    };
  }

  // Fetch database entries (pages)
  const pages = await fetchDatabasePages(client, databaseId);

  // Also fetch blocks from the database view itself (may contain child_database blocks)
  const { pages: childPages, databaseIds: childDbIds } = await fetchChildren(client, databaseId);

  // Also look for nested databases inside column layouts etc
  const nestedDbIds = await findNestedDatabases(client, databaseId);
  const allDbIds = [...new Set([...childDbIds, ...nestedDbIds])];

  // Build child nodes in parallel
  const childPromises = [
    ...pages.map((page) => buildPageTree(client, page.id, depth + 1, maxDepth, childOptions)),
    ...childPages.map((page) => buildPageTree(client, page.id, depth + 1, maxDepth, childOptions)),
    ...allDbIds.map((dbId) => buildDatabaseTree(client, dbId, maxDepth, depth + 1, childOptions)),
  ];
  const children = (await runWithConcurrency(childPromises, treeConcurrency)).filter(
    (child): child is PageNode => child !== null
  );

  return {
    id: database.id,
    title,
    lastEditedTime: database.last_edited_time,
    children,
    blocks: null,
    isDatabase: true,
    excluded,
  };
}

/**
 * Recursively find child_database blocks nested inside columns, toggles, etc.
 */
async function findNestedDatabases(client: Client, blockId: string): Promise<string[]> {
  const databaseIds: string[] = [];

  async function scanBlock(id: string): Promise<void> {
    try {
      const blocks = await withRetry(() =>
        collectPaginatedAPI(client.blocks.children.list, {
          block_id: id,
        })
      );

      for (const block of blocks) {
        if (!isFullBlock(block)) continue;

        if (block.type === "child_database") {
          log.debug(`Found nested database: ${block.child_database.title} (${block.id})`);
          databaseIds.push(block.id);
        }

        // Recurse into blocks that can contain other blocks (columns, toggles, etc.)
        if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
          await scanBlock(block.id);
        }
      }
    } catch (err) {
      log.debug(`Could not scan blocks for ${id}: ${err}`);
    }
  }

  await scanBlock(blockId);
  return databaseIds;
}

/**
 * Build a tree of pages starting from a root page
 * Recursively fetches all child pages and child databases
 */
export async function buildPageTree(
  client: Client,
  rootPageId: string,
  depth = 0,
  maxDepth = 10,
  options: TreeBuildOptions = {}
): Promise<PageNode> {
  if (depth > maxDepth) {
    log.warn(`Max depth (${maxDepth}) reached, stopping recursion`);
    return {
      id: rootPageId,
      title: "[Max depth reached]",
      lastEditedTime: new Date().toISOString(),
      children: [],
      blocks: null,
    };
  }

  const page = await fetchPage(client, rootPageId);
  const title = getPageTitle(page);
  const properties = getPageProperties(page);
  const titlePath = [...(options.titlePath ?? []), title];

  log.info(`${"  ".repeat(depth)}Found page: ${title}`);

  const { excluded, pruneChildren, childOptions } = resolvePruneResult(page.id, titlePath, options);
  if (pruneChildren) {
    log.debug(`${"  ".repeat(depth)}Pruned page subtree: ${title}`);
    return {
      id: page.id,
      title,
      lastEditedTime: page.last_edited_time,
      children: [],
      blocks: null,
      properties: Object.keys(properties).length > 0 ? properties : undefined,
      excluded,
    };
  }

  const { pages: childPages, databaseIds } = await fetchChildren(client, rootPageId);

  // Build child nodes in parallel (with concurrency limit)
  const childPromises = [
    ...childPages.map((p) => buildPageTree(client, p.id, depth + 1, maxDepth, childOptions)),
    ...databaseIds.map((dbId) =>
      buildDatabaseTree(client, dbId, maxDepth, depth + 1, childOptions)
    ),
  ];

  const children = (await runWithConcurrency(childPromises, treeConcurrency)).filter(
    (child): child is PageNode => child !== null
  );

  return {
    id: page.id,
    title,
    lastEditedTime: page.last_edited_time,
    children,
    blocks: null,
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    excluded,
  };
}

/**
 * Fetch blocks for a single page node
 */
export async function fetchPageBlocks(client: Client, node: PageNode): Promise<PageNode> {
  log.debug(`Fetching blocks for: ${node.title}`);
  const blocks = await fetchBlocks(client, node.id);

  return {
    ...node,
    blocks,
  };
}

/**
 * Fetch blocks for all pages in the tree (parallel)
 */
export async function fetchAllBlocks(client: Client, tree: PageNode): Promise<PageNode> {
  // Skip database nodes (no content) and excluded nodes (never written, so fetching wastes a call)
  const withBlocks = tree.isDatabase || tree.excluded ? tree : await fetchPageBlocks(client, tree);

  // Fetch children's blocks in parallel
  const childPromises = withBlocks.children.map((child) => fetchAllBlocks(client, child));
  const childrenWithBlocks = await runWithConcurrency(childPromises, treeConcurrency);

  return {
    ...withBlocks,
    children: childrenWithBlocks,
  };
}

/**
 * Fetch blocks only for pages whose ID is in the filter set.
 * Traverses the full tree to maintain structure (needed for path resolution)
 * but only makes API calls for matching pages.
 */
export async function fetchBlocksFiltered(
  client: Client,
  tree: PageNode,
  pageIds: Set<string>
): Promise<PageNode> {
  const normalizedIds = new Set([...pageIds].map((id) => id.replace(/-/g, "")));
  const nodeId = tree.id.replace(/-/g, "");
  const shouldFetch = normalizedIds.has(nodeId) && !tree.isDatabase;

  const withBlocks = shouldFetch ? await fetchPageBlocks(client, tree) : tree;

  const childPromises = withBlocks.children.map((child) =>
    fetchBlocksFiltered(client, child, pageIds)
  );
  const childrenWithBlocks = await runWithConcurrency(childPromises, treeConcurrency);

  return {
    ...withBlocks,
    children: childrenWithBlocks,
  };
}

/**
 * Count total pages in tree
 */
export function countPages(tree: PageNode): number {
  let count = 1;
  for (const child of tree.children) {
    count += countPages(child);
  }
  return count;
}

/**
 * Flatten tree to array of pages (for iteration)
 */
export function flattenTree(tree: PageNode): PageNode[] {
  const pages: PageNode[] = [tree];
  for (const child of tree.children) {
    pages.push(...flattenTree(child));
  }
  return pages;
}

/**
 * Walk tree and call callback for each page
 */
export async function walkTree(
  tree: PageNode,
  callback: (node: PageNode, path: string[], depth: number) => Promise<void>,
  path: string[] = [],
  depth = 0
): Promise<void> {
  await callback(tree, path, depth);

  for (const child of tree.children) {
    await walkTree(child, callback, [...path, tree.title], depth + 1);
  }
}
