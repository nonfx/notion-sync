/**
 * Notion write operations.
 *
 * Defines a minimal `NotionWriter` interface (so the push engine can be tested
 * against an in-memory fake) plus a real implementation backed by the Notion
 * API. Handles batching (max 100 children per append) and deep nesting (the API
 * only accepts ~2 levels of nesting inline, so deeper children are appended
 * recursively).
 */

import type { Client } from "@notionhq/client";
import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints";
import type { BlockRequest } from "../markdown/parser.ts";
import { withRetry } from "./client.ts";

export interface PageParent {
  id: string;
  type: "page" | "database";
}

export interface NotionWriter {
  /** Create an (empty) page under the given parent. Returns the new page id. */
  createPage(parent: PageParent, title: string): Promise<string>;
  /** Update a page's title. */
  setTitle(pageId: string, title: string): Promise<void>;
  /** Remove all existing child blocks of a page. */
  clearBlocks(pageId: string): Promise<void>;
  /** Append blocks (with nested children) to a page or block. */
  appendBlocks(parentBlockId: string, blocks: BlockRequest[]): Promise<void>;
}

const MAX_CHILDREN_PER_APPEND = 100;

/**
 * Block types whose children must be supplied inline in the same request
 * (they can't be appended afterward). For everything else we append children
 * recursively to support arbitrary nesting depth.
 */
const INLINE_CHILDREN_TYPES = new Set(["table", "column_list", "column"]);

function titleProperty(title: string): { title: { title: Array<{ text: { content: string } }> } } {
  return { title: { title: [{ text: { content: title } }] } };
}

/**
 * Create the real Notion-API-backed writer.
 */
export function createNotionWriter(client: Client): NotionWriter {
  return {
    async createPage(parent: PageParent, title: string): Promise<string> {
      const parentRef =
        parent.type === "database" ? { database_id: parent.id } : { page_id: parent.id };

      const response = await withRetry(() =>
        client.pages.create({
          parent: parentRef,
          properties: titleProperty(title),
        })
      );
      return response.id;
    },

    async setTitle(pageId: string, title: string): Promise<void> {
      await withRetry(() =>
        client.pages.update({
          page_id: pageId,
          properties: titleProperty(title),
        })
      );
    },

    async clearBlocks(pageId: string): Promise<void> {
      const existing = await withRetry(() => client.blocks.children.list({ block_id: pageId }));
      for (const block of existing.results) {
        // Never delete subpages/subdatabases — that would archive the child
        // pages we're trying to sync. Only clear content blocks.
        const type = "type" in block ? (block as { type: string }).type : "";
        if (type === "child_page" || type === "child_database") continue;
        await withRetry(() => client.blocks.delete({ block_id: block.id }));
      }
    },

    async appendBlocks(parentBlockId: string, blocks: BlockRequest[]): Promise<void> {
      await appendRecursive(client, parentBlockId, blocks);
    },
  };
}

async function appendRecursive(
  client: Client,
  parentBlockId: string,
  blocks: BlockRequest[]
): Promise<void> {
  if (blocks.length === 0) return;

  // Separate out deep children we'll append after, keeping inline-only children.
  const deferred: Array<{ index: number; children: BlockRequest[] }> = [];
  const requestBlocks = blocks.map((block, index) => {
    const { children, ...rest } = block;
    if (children && children.length > 0 && !INLINE_CHILDREN_TYPES.has(block.type)) {
      deferred.push({ index, children });
      return rest;
    }
    return block;
  });

  // Append in batches of 100, collecting the created block ids in order.
  const createdIds: string[] = [];
  for (let i = 0; i < requestBlocks.length; i += MAX_CHILDREN_PER_APPEND) {
    const batch = requestBlocks.slice(i, i + MAX_CHILDREN_PER_APPEND);
    const response = await withRetry(() =>
      client.blocks.children.append({
        block_id: parentBlockId,
        children: batch as unknown as BlockObjectRequest[],
      })
    );
    for (const result of response.results) {
      createdIds.push(result.id);
    }
  }

  // Append deferred children under their now-created parent blocks.
  // If a parent id is missing the append silently dropped a block, so fail
  // loudly rather than losing the children.
  for (const { index, children } of deferred) {
    const childParentId = createdIds[index];
    if (!childParentId) {
      throw new Error(
        `Notion append returned ${createdIds.length} of ${requestBlocks.length} blocks; ` +
          `cannot attach ${children.length} child block(s) to missing parent at index ${index}.`
      );
    }
    await appendRecursive(client, childParentId, children);
  }
}
