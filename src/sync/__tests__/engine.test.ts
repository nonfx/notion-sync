/**
 * Tests for sync engine: index bootstrap and stale cleanup on date filter changes.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@notionhq/client";
import type { EffectiveSelectors } from "../../config/load.ts";
import { loadIndex } from "../index.ts";

const ROOT_PAGE_ID = "d95e4b1bba544a1794a68c9005e4fa0a";
const SYNC_ROOT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STALE_LEAF_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

interface MockPage {
  id: string;
  last_edited_time: string;
  properties: {
    title: {
      type: "title";
      title: Array<{ plain_text: string }>;
    };
  };
}

/** Build a minimal Notion page stub for mocked fetchPage responses. */
function makePage(id: string, title: string, lastEditedTime: string): MockPage {
  return {
    id,
    last_edited_time: lastEditedTime,
    properties: {
      title: {
        type: "title",
        title: [{ plain_text: title }],
      },
    },
  };
}

const pagesById = new Map<string, MockPage>();
const childrenById = new Map<string, { pages: MockPage[]; databaseIds: string[] }>();

const fetchPageMock = mock(async (_client: Client, pageId: string): Promise<MockPage> => {
  const page = pagesById.get(pageId);
  if (!page) {
    throw new Error(`Unknown page: ${pageId}`);
  }
  return page;
});

const fetchChildrenMock = mock(
  async (_client: Client, blockId: string): Promise<{ pages: MockPage[]; databaseIds: string[] }> => {
    return childrenById.get(blockId) ?? { pages: [], databaseIds: [] };
  }
);

const fetchBlocksMock = mock(async () => []);

const fakeClient = {} as Client;

mock.module("../../notion/client.ts", () => ({
  fetchPage: fetchPageMock,
  fetchChildren: fetchChildrenMock,
  fetchBlocks: fetchBlocksMock,
  fetchDatabase: mock(async () => {
    throw new Error("fetchDatabase not used in these tests");
  }),
  fetchDatabasePages: mock(async () => []),
  isLinkedDatabaseError: () => false,
  getPageTitle: (page: MockPage) => page.properties.title.title[0]?.plain_text ?? "Untitled",
  getDatabaseTitle: () => "Database",
  getPageProperties: () => ({}),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
  createNotionClient: () => fakeClient,
}));

const { sync, ensureSyncIndex } = await import("../engine.ts");
const { resetTreeConcurrency } = await import("../../notion/tree.ts");

/** Build EffectiveSelectors with only a dateFilter set. */
function dateSelectors(dateFilter: EffectiveSelectors["dateFilter"]): EffectiveSelectors {
  return {
    include: [],
    exclude: [],
    defaultExclude: [],
    dateFilter,
  };
}

/** Assert a file exists at the given path. */
async function expectFileExists(filePath: string): Promise<void> {
  await access(filePath);
}

describe("ensureSyncIndex", () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), "notion-rsync-engine-"));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("creates a new index when none exists", async () => {
    const index = await ensureSyncIndex(outputDir, ROOT_PAGE_ID);

    expect(index.rootPageId).toBe(ROOT_PAGE_ID);
    expect(index.lastSync).toBeNull();

    const loaded = await loadIndex(outputDir);
    expect(loaded?.rootPageId).toBe(ROOT_PAGE_ID);
  });

  it("returns the existing index when rootPageId matches", async () => {
    await ensureSyncIndex(outputDir, ROOT_PAGE_ID);
    const index = await ensureSyncIndex(outputDir, ROOT_PAGE_ID);

    expect(index.rootPageId).toBe(ROOT_PAGE_ID);
  });

  it("throws when an existing index rootPageId differs from config", async () => {
    await ensureSyncIndex(outputDir, ROOT_PAGE_ID);

    await expect(ensureSyncIndex(outputDir, "2df24584254b804094d3dfb56506b0be")).rejects.toThrow(
      "Index rootPageId mismatch"
    );
  });
});

describe("sync date filter stale cleanup", () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), "notion-rsync-engine-stale-"));
    pagesById.clear();
    childrenById.clear();
    fetchPageMock.mockClear();
    fetchChildrenMock.mockClear();
    fetchBlocksMock.mockClear();
    resetTreeConcurrency();

    const root = makePage(SYNC_ROOT_ID, "Root", "2026-07-01T00:00:00.000Z");
    const leaf = makePage(STALE_LEAF_ID, "Stale Leaf", "2026-06-15T00:00:00.000Z");
    pagesById.set(SYNC_ROOT_ID, root);
    pagesById.set(STALE_LEAF_ID, leaf);
    childrenById.set(SYNC_ROOT_ID, { pages: [leaf], databaseIds: [] });
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("removes a page file when it falls out of date filter scope via findStalePages", async () => {
    await sync({
      outputDir,
      notionToken: "fake-token",
      dryRun: false,
      rootPageId: SYNC_ROOT_ID,
      selectors: dateSelectors({ after: "2026-01-01" }),
    });

    const indexAfterFirst = await loadIndex(outputDir);
    const leafState = indexAfterFirst?.pages[STALE_LEAF_ID];
    expect(leafState).toBeDefined();

    const staleFilePath = join(outputDir, leafState!.path);
    await expectFileExists(staleFilePath);

    await sync({
      outputDir,
      notionToken: "fake-token",
      dryRun: false,
      rootPageId: SYNC_ROOT_ID,
      selectors: dateSelectors({ after: "2026-06-20" }),
    });

    await expect(readFile(staleFilePath)).rejects.toThrow();

    const indexAfterSecond = await loadIndex(outputDir);
    expect(indexAfterSecond?.pages[STALE_LEAF_ID]).toBeUndefined();
    expect(indexAfterSecond?.pages[SYNC_ROOT_ID]).toBeDefined();
  });
});
