/**
 * Integration tests for date-filter wiring in tree building.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { Client } from "@notionhq/client";
import type { EffectiveSelectors } from "../../config/load.ts";

const PARENT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CHILD_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

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

mock.module("../client.ts", () => ({
  fetchPage: fetchPageMock,
  fetchChildren: fetchChildrenMock,
  fetchDatabase: mock(async () => {
    throw new Error("fetchDatabase not used in these tests");
  }),
  fetchDatabasePages: mock(async () => []),
  isLinkedDatabaseError: () => false,
  getPageTitle: (page: MockPage) => page.properties.title.title[0]?.plain_text ?? "Untitled",
  getDatabaseTitle: () => "Database",
  getPageProperties: () => ({}),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

const { buildPageTree, resetTreeConcurrency } = await import("../tree.ts");

const fakeClient = {} as Client;

function dateSelectors(dateFilter: EffectiveSelectors["dateFilter"]): EffectiveSelectors {
  return {
    include: [],
    exclude: [],
    defaultExclude: [],
    dateFilter,
  };
}

describe("buildPageTree date filter integration", () => {
  beforeEach(() => {
    pagesById.clear();
    childrenById.clear();
    fetchPageMock.mockClear();
    fetchChildrenMock.mockClear();
    resetTreeConcurrency();
  });

  it("marks a date-excluded parent excluded but still fetches in-range children", async () => {
    const parent = makePage(PARENT_ID, "Old Parent", "2020-01-01T00:00:00.000Z");
    const child = makePage(CHILD_ID, "Recent Child", "2026-06-15T00:00:00.000Z");
    pagesById.set(PARENT_ID, parent);
    pagesById.set(CHILD_ID, child);
    childrenById.set(PARENT_ID, { pages: [child], databaseIds: [] });

    const tree = await buildPageTree(fakeClient, PARENT_ID, 0, 10, {
      selectors: dateSelectors({ after: "2026-01-01" }),
    });

    expect(tree.excluded).toBe(true);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.excluded).toBe(false);
    expect(tree.children[0]?.title).toBe("Recent Child");
    expect(fetchChildrenMock).toHaveBeenCalledWith(fakeClient, PARENT_ID);
  });

  it("marks a date-excluded childless leaf excluded without selector prune", async () => {
    const leaf = makePage(PARENT_ID, "Old Leaf", "2020-01-01T00:00:00.000Z");
    pagesById.set(PARENT_ID, leaf);
    childrenById.set(PARENT_ID, { pages: [], databaseIds: [] });

    const tree = await buildPageTree(fakeClient, PARENT_ID, 0, 10, {
      selectors: dateSelectors({ after: "2026-01-01" }),
    });

    expect(tree.excluded).toBe(true);
    expect(tree.children).toHaveLength(0);
    expect(fetchChildrenMock).toHaveBeenCalledWith(fakeClient, PARENT_ID);
  });
});
