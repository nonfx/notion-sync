/**
 * Regression tests for tree selection, sibling scheduling, and scan failures.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
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

let beforeFetch: (id: string) => Promise<void> = async () => {};

const fetchPageMock = mock(async (_client: Client, pageId: string): Promise<MockPage> => {
  await beforeFetch(pageId);
  const page = pagesById.get(pageId);
  if (!page) {
    throw new Error(`Unknown page: ${pageId}`);
  }
  return page;
});

const fetchChildrenMock = mock(
  async (
    _client: Client,
    blockId: string
  ): Promise<{ pages: MockPage[]; databaseIds: string[] }> => {
    return childrenById.get(blockId) ?? { pages: [], databaseIds: [] };
  }
);

mock.module("../client.ts", () => ({
  fetchPage: fetchPageMock,
  fetchChildren: fetchChildrenMock,
  fetchDatabase: mock(async (_client: Client, id: string) => ({
    id,
    last_edited_time: "2026-01-01T00:00:00.000Z",
  })),
  fetchDatabasePages: mock(
    async (_client: Client, id: string) => childrenById.get(id)?.pages ?? []
  ),
  fetchBlocks: mock(async (_client: Client, id: string) => {
    await beforeFetch(id);
    return [];
  }),
  isLinkedDatabaseError: () => false,
  getPageTitle: (page: MockPage) => page.properties.title.title[0]?.plain_text ?? "Untitled",
  getDatabaseTitle: () => "Database",
  getPageProperties: () => ({}),
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

const {
  buildPageTree,
  buildDatabaseTree,
  fetchAllBlocks,
  fetchBlocksFiltered,
  setTreeConcurrency,
  resetTreeConcurrency,
} = await import("../tree.ts");

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

afterEach(() => {
  beforeFetch = async () => {};
  resetTreeConcurrency();
});

function node(
  id: string,
  children: import("../tree.ts").PageNode[] = []
): import("../tree.ts").PageNode {
  return { id, title: id, lastEditedTime: "2026-01-01T00:00:00.000Z", blocks: null, children };
}

const scanClient = {
  blocks: { children: { list: async () => ({ results: [], has_more: false, next_cursor: null }) } },
} as unknown as Client;

describe("tree sibling concurrency", () => {
  for (const operation of [
    "buildPageTree",
    "buildDatabaseTree",
    "fetchAllBlocks",
    "fetchBlocksFiltered",
  ] as const) {
    it(`${operation} bounds active siblings and preserves input order`, async () => {
      pagesById.clear();
      childrenById.clear();
      setTreeConcurrency(2);
      const ids = ["first", "second", "third", "fourth"];
      const children = ids.map((id) => makePage(id, id, "2026-01-01T00:00:00.000Z"));
      for (const page of children) pagesById.set(page.id, page);
      pagesById.set("root", makePage("root", "Root", "2026-01-01T00:00:00.000Z"));
      childrenById.set("root", { pages: children, databaseIds: [] });
      const releases = new Map<string, () => void>();
      const started: string[] = [];
      let active = 0;
      let peak = 0;
      beforeFetch = async (id) => {
        if (id === "root") return;
        started.push(id);
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.set(id, resolve));
        active--;
      };
      const tree = node(
        "root",
        ids.map((id) => node(id))
      );
      // Database entries and direct child pages are separate sources.
      if (operation === "buildDatabaseTree") {
        fetchChildrenMock.mockImplementation(async () => ({ pages: [], databaseIds: [] }));
      }
      const pending =
        operation === "buildPageTree"
          ? buildPageTree(scanClient, "root")
          : operation === "buildDatabaseTree"
            ? buildDatabaseTree(scanClient, "root")
            : operation === "fetchAllBlocks"
              ? fetchAllBlocks(scanClient, tree)
              : fetchBlocksFiltered(scanClient, tree, new Set(ids));
      try {
        await Bun.sleep(0);
        expect(started).toEqual(["first", "second"]);
        releases.get("second")!();
        await Bun.sleep(0);
        expect(started).toEqual(["first", "second", "third"]);
        releases.get("third")!();
        await Bun.sleep(0);
        releases.get("fourth")!();
        await Bun.sleep(0);
        releases.get("first")!();
        const result = await pending;
        expect(peak).toBe(2);
        expect(result?.children.map((child) => child.id)).toEqual(ids);
      } finally {
        beforeFetch = async () => {};
        for (const release of releases.values()) release();
        await pending;
        fetchChildrenMock.mockImplementation(
          async (_client, id) => childrenById.get(id) ?? { pages: [], databaseIds: [] }
        );
      }
    });
  }
});

it("keeps sibling order when the second page finishes first", async () => {
  const releases = new Map<string, () => void>();
  beforeFetch = async (id) => {
    await new Promise<void>((resolve) => releases.set(id, resolve));
  };
  const tree = { ...node("root", [node("first"), node("second")]), isDatabase: true };
  const pending = fetchAllBlocks(fakeClient, tree);
  try {
    await Bun.sleep(0);
    releases.get("second")!();
    await Bun.sleep(0);
    releases.get("first")!();
    expect((await pending).children.map((child) => child.id)).toEqual(["first", "second"]);
  } finally {
    for (const release of releases.values()) release();
    await pending;
  }
});

it("propagates a sibling fetch failure", async () => {
  const failure = new Error("Page content unavailable");
  beforeFetch = async (id) => {
    if (id === "broken") throw failure;
  };
  const tree = { ...node("root", [node("healthy"), node("broken")]), isDatabase: true };
  await expect(fetchAllBlocks(fakeClient, tree)).rejects.toBe(failure);
});

it("fetches children when positive fractional concurrency rounds to one worker", async () => {
  setTreeConcurrency(0.5);
  const tree = { ...node("root", [node("first"), node("second")]), isDatabase: true };
  const result = await fetchAllBlocks(fakeClient, tree);
  expect(result.children.map((child) => child.id)).toEqual(["first", "second"]);
  expect(result.children.every((child) => Array.isArray(child.blocks))).toBe(true);
});
