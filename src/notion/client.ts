/**
 * Notion API client wrapper
 */

import {
  Client,
  isFullPage,
  isFullBlock,
  isFullDatabase,
  collectPaginatedAPI,
} from "@notionhq/client";
import type {
  PageObjectResponse,
  BlockObjectResponse,
  DatabaseObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import type { SupportedFetch } from "@notionhq/client/build/src/fetch-types";
import nodeFetch from "node-fetch/lib/index.js";
import { log } from "../utils/logger.ts";

export type NotionPage = PageObjectResponse;
export type NotionBlock = BlockObjectResponse | UnsupportedBlock;
export type NotionDatabase = DatabaseObjectResponse;

/** Placeholder for blocks that can't be fetched via API */
export interface UnsupportedBlock {
  object: "block";
  id: string;
  type: "api_unsupported";
  api_unsupported: {
    message: string;
    block_id: string;
  };
  has_children: false;
}

/** Create a placeholder block for API-unsupported content */
function createUnsupportedBlock(blockId: string, message: string): UnsupportedBlock {
  return {
    object: "block",
    id: blockId,
    type: "api_unsupported",
    api_unsupported: {
      message,
      block_id: blockId,
    },
    has_children: false,
  };
}

import { withRetry } from "./requests.ts";
export {
  withRetry,
  setRetryAttempts,
  resetRetryAttempts,
  DEFAULT_RETRY_ATTEMPTS,
  setRequestLimits,
  resetRequestLimits,
  DEFAULT_REQUEST_CONCURRENCY,
  DEFAULT_REQUEST_INTERVAL_MS,
} from "./requests.ts";

export interface NotionClientOptions {
  token: string;
}

/** How long one request may take, including reading its body. */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * node-fetch with a deadline that cancels the request. The SDK's own timeout
 * only stops waiting: the connection stays open, a retry would run beside it,
 * and a body cut short after its headers would never settle. The SDK timeout
 * is set later, so this abort always decides.
 *
 * node-fetch is imported by path because Bun replaces a bare "node-fetch"
 * import with its own fetch, which reports failures differently. Source runs
 * and release builds then raise the same errors.
 */
export function abortingFetch(timeoutMs: number): SupportedFetch {
  return (url, init) => nodeFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Creates a configured Notion client
 */
export function createNotionClient(options: NotionClientOptions): Client {
  return new Client({
    auth: options.token,
    fetch: abortingFetch(REQUEST_TIMEOUT_MS),
    timeoutMs: REQUEST_TIMEOUT_MS + 5_000,
  });
}

/**
 * Fetch a page by ID
 */
export async function fetchPage(client: Client, pageId: string): Promise<NotionPage> {
  log.debug(`Fetching page: ${pageId}`);

  const response = await withRetry(() => client.pages.retrieve({ page_id: pageId }), {
    idempotent: true,
  });

  if (!isFullPage(response)) {
    throw new Error(`Page ${pageId} is not accessible or is a partial response`);
  }

  return response;
}

export interface ChildItems {
  pages: NotionPage[];
  databaseIds: string[];
}

/**
 * Fetch all child pages and child databases of a page/block
 */
export async function fetchChildren(client: Client, blockId: string): Promise<ChildItems> {
  log.debug(`Fetching children of: ${blockId}`);

  const pages: NotionPage[] = [];
  const databaseIds = new Set<string>();

  async function scanBlock(id: string): Promise<void> {
    let blocks;
    try {
      blocks = await collectPaginatedAPI(
        (args) => withRetry(() => client.blocks.children.list(args), { idempotent: true }),
        { block_id: id }
      );
    } catch (error) {
      throw new Error(`Could not scan block ${id} for nested databases under ${blockId}`, {
        cause: error,
      });
    }

    for (const block of blocks) {
      if (!isFullBlock(block)) continue;

      if (block.type === "child_page") {
        if (id === blockId) pages.push(await fetchPage(client, block.id));
      } else if (block.type === "child_database") {
        databaseIds.add(block.id);
      } else if (block.has_children) {
        await scanBlock(block.id);
      }
    }
  }

  await scanBlock(blockId);
  return { pages, databaseIds: [...databaseIds] };
}

/**
 * Fetch all blocks of a page (the actual content)
 */
export async function fetchBlocks(client: Client, blockId: string): Promise<NotionBlock[]> {
  log.debug(`Fetching blocks of: ${blockId}`);

  let blocks;
  try {
    blocks = await collectPaginatedAPI(
      (args) => withRetry(() => client.blocks.children.list(args), { idempotent: true }),
      { block_id: blockId }
    );
  } catch (err) {
    // Handle unsupported block types (e.g., ai_block)
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("is not supported")) {
      log.warn(`Unsupported block in ${blockId}: ${message}`);
      // Return a placeholder block so it renders in markdown
      return [createUnsupportedBlock(blockId, message)];
    }
    throw err;
  }

  const fullBlocks: NotionBlock[] = [];

  for (const block of blocks) {
    if (!isFullBlock(block)) continue;
    fullBlocks.push(block);

    // Recursively fetch children if the block has them
    if (block.has_children) {
      const blockType = "type" in block ? block.type : "unknown";
      const children = await fetchBlocksRecursive(client, block.id, blockType);
      (block as NotionBlock & { children?: NotionBlock[] }).children = children;
    }
  }

  return fullBlocks;
}

/**
 * Recursively fetch nested blocks
 */
async function fetchBlocksRecursive(
  client: Client,
  blockId: string,
  parentType?: string
): Promise<NotionBlock[]> {
  let blocks;
  try {
    blocks = await collectPaginatedAPI(
      (args) => withRetry(() => client.blocks.children.list(args), { idempotent: true }),
      { block_id: blockId }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("is not supported")) {
      log.warn(
        `Unsupported nested block in ${blockId} (parent: ${parentType || "unknown"}): ${message}`
      );
      return [createUnsupportedBlock(blockId, message)];
    }
    throw err;
  }

  const fullBlocks: NotionBlock[] = [];

  for (const block of blocks) {
    if (!isFullBlock(block)) continue;
    fullBlocks.push(block);

    if (block.has_children) {
      const blockType = "type" in block ? block.type : "unknown";
      const children = await fetchBlocksRecursive(client, block.id, blockType);
      (block as NotionBlock & { children?: NotionBlock[] }).children = children;
    }
  }

  return fullBlocks;
}

/**
 * Extract page title from page properties
 */
export function getPageTitle(page: NotionPage): string {
  const titleProp = Object.values(page.properties).find((prop) => prop.type === "title");

  if (titleProp && titleProp.type === "title") {
    return titleProp.title.map((t) => t.plain_text).join("") || "Untitled";
  }

  return "Untitled";
}

/**
 * Whether a Notion API error refers to a linked database view (not retrievable via databases.retrieve).
 */
export function isLinkedDatabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("linked database");
}

/**
 * Fetch a database by ID
 */
export async function fetchDatabase(client: Client, databaseId: string): Promise<NotionDatabase> {
  log.debug(`Fetching database: ${databaseId}`);

  const response = await withRetry(() => client.databases.retrieve({ database_id: databaseId }), {
    idempotent: true,
  });

  if (!isFullDatabase(response)) {
    throw new Error(`Database ${databaseId} is not accessible or is a partial response`);
  }

  return response;
}

/**
 * Fetch all pages (entries) in a database
 */
export async function fetchDatabasePages(
  client: Client,
  databaseId: string
): Promise<NotionPage[]> {
  log.debug(`Fetching database pages: ${databaseId}`);

  const results = await collectPaginatedAPI(
    (args) => withRetry(() => client.databases.query(args), { idempotent: true }),
    { database_id: databaseId }
  );

  const pages: NotionPage[] = [];
  for (const result of results) {
    if (isFullPage(result)) {
      pages.push(result);
    }
  }

  return pages;
}

/**
 * Get database title
 */
export function getDatabaseTitle(database: NotionDatabase): string {
  if (database.title.length > 0) {
    return database.title.map((t) => t.plain_text).join("") || "Untitled Database";
  }
  return "Untitled Database";
}

/** Simplified property value for frontmatter */
export type PropertyValue = string | number | boolean | string[] | null;

/**
 * Extract page properties as simple key-value pairs for frontmatter
 */
export function getPageProperties(page: NotionPage): Record<string, PropertyValue> {
  const result: Record<string, PropertyValue> = {};

  for (const [key, prop] of Object.entries(page.properties)) {
    // Skip title (already handled separately)
    if (prop.type === "title") continue;

    const value = extractPropertyValue(prop);
    if (value !== null) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Extract a single property value
 */
function extractPropertyValue(prop: NotionPage["properties"][string]): PropertyValue {
  switch (prop.type) {
    case "rich_text":
      return prop.rich_text.map((t) => t.plain_text).join("") || null;

    case "number":
      return prop.number;

    case "select":
      return prop.select?.name ?? null;

    case "multi_select":
      return prop.multi_select.map((s) => s.name);

    case "status":
      return prop.status?.name ?? null;

    case "date":
      if (!prop.date) return null;
      if (prop.date.end) {
        return `${prop.date.start} → ${prop.date.end}`;
      }
      return prop.date.start;

    case "checkbox":
      return prop.checkbox;

    case "url":
      return prop.url;

    case "email":
      return prop.email;

    case "phone_number":
      return prop.phone_number;

    case "formula":
      if (prop.formula.type === "string") return prop.formula.string;
      if (prop.formula.type === "number") return prop.formula.number;
      if (prop.formula.type === "boolean") return prop.formula.boolean;
      if (prop.formula.type === "date") return prop.formula.date?.start ?? null;
      return null;

    case "relation":
      // Just return count for now (IDs aren't useful in markdown)
      return prop.relation.length > 0 ? `${prop.relation.length} items` : null;

    case "rollup":
      if (prop.rollup.type === "number") return prop.rollup.number;
      if (prop.rollup.type === "date") return prop.rollup.date?.start ?? null;
      if (prop.rollup.type === "array") return `${prop.rollup.array.length} items`;
      return null;

    case "people":
      return prop.people.length > 0
        ? prop.people.map((p) => ("name" in p ? p.name : "Unknown")).join(", ")
        : null;

    case "files":
      return prop.files.length > 0
        ? (prop.files
            .map((f) => {
              if (f.type === "external") return f.external.url;
              if (f.type === "file") return f.file.url;
              return null;
            })
            .filter(Boolean) as string[])
        : null;

    case "created_time":
      return prop.created_time;

    case "created_by":
      return "name" in prop.created_by ? prop.created_by.name : null;

    case "last_edited_time":
      return prop.last_edited_time;

    case "last_edited_by":
      return "name" in prop.last_edited_by ? prop.last_edited_by.name : null;

    case "unique_id":
      return prop.unique_id.prefix
        ? `${prop.unique_id.prefix}-${prop.unique_id.number}`
        : prop.unique_id.number;

    default:
      return null;
  }
}
