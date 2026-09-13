import assert from "node:assert/strict";
import { Client, LogLevel } from "@notionhq/client";
import { fetchBlocks, fetchDatabasePages, fetchPage } from "../../client.ts";
import { setRequestLimits, setRetryAttempts, withRetry } from "../../requests.ts";
import { fetchAllBlocks, fetchBlocksFiltered, type PageNode } from "../../tree.ts";
import { createNotionWriter } from "../../writer.ts";
import { setLogLevel } from "../../../utils/logger.ts";

setLogLevel("error");

function list(results: unknown[] = [], next: string | null = null): Response {
  return Response.json({ object: "list", results, has_more: next !== null, next_cursor: next });
}

function page(id: string): Record<string, unknown> {
  return {
    object: "page",
    id,
    url: `https://notion.so/${id}`,
    properties: {},
    last_edited_time: "2026-01-01T00:00:00.000Z",
  };
}

function node(id: string, children?: PageNode[]): PageNode {
  return {
    id,
    title: id,
    lastEditedTime: "2026-01-01T00:00:00.000Z",
    blocks: null,
    children: children ?? [],
    isDatabase: children !== undefined,
  };
}

function assertSpacing(starts: number[], interval: number): void {
  for (let i = 1; i < starts.length; i++) {
    assert.ok(
      starts[i]! - starts[i - 1]! >= interval - 1,
      `request gap ${starts[i]! - starts[i - 1]!}ms is below ${interval}ms`
    );
  }
}

const scenario = process.argv[2];
if (scenario === "global") {
  setRequestLimits({ concurrency: 2, minIntervalMs: 8 });
  let active = 0;
  let peak = 0;
  const starts: number[] = [];
  const client = new Client({
    auth: "test",
    logLevel: LogLevel.ERROR,
    fetch: async (_url, init) => {
      starts.push(performance.now());
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(25);
      active--;
      return init?.method === "POST" ? Response.json(page("created")) : list();
    },
  });
  const groups = node("root", [
    node("group-a", [node("a1"), node("a2"), node("a3")]),
    node("group-b", [node("b1"), node("b2"), node("b3")]),
  ]);
  const filtered = node("filtered", [node("selected"), node("skipped")]);
  const [result, selected, created] = await Promise.all([
    fetchAllBlocks(client, groups),
    fetchBlocksFiltered(client, filtered, new Set(["selected"])),
    createNotionWriter(client).createPage({ id: "parent", type: "page" }, "New page"),
  ]);
  assert.equal(peak, 2);
  assert.equal(starts.length, 8);
  assertSpacing(starts, 8);
  assert.deepEqual(
    result.children.flatMap((group) => group.children.map((child) => child.id)),
    ["a1", "a2", "a3", "b1", "b2", "b3"]
  );
  assert.deepEqual(selected.children[0]?.blocks, []);
  assert.equal(selected.children[1]?.blocks, null);
  assert.equal(created, "created");
} else if (scenario === "pagination" || scenario === "database-pagination") {
  setRequestLimits({ concurrency: 1, minIntervalMs: 12 });
  const starts: number[] = [];
  const cursors: Array<string | null> = [];
  const client = new Client({
    auth: "test",
    logLevel: LogLevel.ERROR,
    fetch: async (url, init) => {
      starts.push(performance.now());
      const cursor =
        scenario === "pagination"
          ? new URL(String(url)).searchParams.get("start_cursor")
          : ((JSON.parse(String(init?.body)) as { start_cursor?: string }).start_cursor ?? null);
      cursors.push(cursor);
      const id = cursor === null ? "first" : "second";
      const item =
        scenario === "pagination"
          ? {
              object: "block",
              id,
              type: "paragraph",
              has_children: false,
              paragraph: { rich_text: [] },
            }
          : page(id);
      return list([item], cursor === null ? "next-page" : null);
    },
  });
  const results =
    scenario === "pagination"
      ? await fetchBlocks(client, "root")
      : await fetchDatabasePages(client, "root");
  assert.deepEqual(
    results.map((item) => item.id),
    ["first", "second"]
  );
  assert.deepEqual(cursors, [null, "next-page"]);
  assertSpacing(starts, 12);
} else if (scenario === "retry" || scenario === "exhaustion" || scenario === "failure") {
  setRequestLimits({ concurrency: 1, minIntervalMs: 8 });
  setRetryAttempts(scenario === "retry" ? 1 : 0);
  const starts: number[] = [];
  const paths: string[] = [];
  let failed = false;
  const client = new Client({
    auth: "test",
    logLevel: LogLevel.ERROR,
    fetch: async (url) => {
      starts.push(performance.now());
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path.endsWith("/broken") && !failed) {
        failed = true;
        return Response.json(
          {
            object: "error",
            code: scenario === "failure" ? "restricted_resource" : "rate_limited",
            message: "request failed",
          },
          {
            status: scenario === "failure" ? 403 : 429,
            headers: { "retry-after": "0.04" },
          }
        );
      }
      return Response.json(page("healthy"));
    },
  });
  const failedRequest = fetchPage(client, "broken").then(
    (value) => value,
    (error: unknown) => error
  );
  const queuedWrite = createNotionWriter(client).createPage(
    { id: "parent", type: "page" },
    "New page"
  );
  const [result, created] = await Promise.all([failedRequest, queuedWrite]);
  assert.equal(created, "healthy");
  if (scenario === "retry") {
    assert.deepEqual(paths, ["/v1/pages/broken", "/v1/pages", "/v1/pages/broken"]);
    assert.equal((result as { id: string }).id, "healthy");
  } else {
    assert.deepEqual(paths, ["/v1/pages/broken", "/v1/pages"]);
    assert.ok(result instanceof Error);
  }
  assertSpacing(starts, 8);
  if (scenario !== "failure")
    assert.ok(starts[1]! - starts[0]! >= 39, "queued writer ignored Retry-After");
} else if (scenario === "synchronous-start") {
  setRequestLimits({ concurrency: 2, minIntervalMs: 20 });
  const starts: number[] = [];
  const first = withRetry(async () => {
    starts.push(performance.now());
  });
  const until = performance.now() + 30;
  while (performance.now() < until) {
    /* Block the event loop between submissions. */
  }
  const second = withRetry(async () => {
    starts.push(performance.now());
  });
  await Promise.all([first, second]);
  assertSpacing(starts, 20);
} else if (scenario === "pagination-retry") {
  setRequestLimits({ concurrency: 1, minIntervalMs: 8 });
  const cursors: Array<string | null> = [];
  let failed = false;
  const client = new Client({
    auth: "test",
    logLevel: LogLevel.ERROR,
    fetch: async (url) => {
      const cursor = new URL(String(url)).searchParams.get("start_cursor");
      cursors.push(cursor);
      if (cursor !== null && !failed) {
        failed = true;
        return Response.json(
          { object: "error", code: "rate_limited", message: "rate limited" },
          {
            status: 429,
            headers: { "retry-after": "0.01" },
          }
        );
      }
      return list(
        [
          {
            object: "block",
            id: cursor === null ? "first" : "second",
            type: "paragraph",
            has_children: false,
          },
        ],
        cursor === null ? "next-page" : null
      );
    },
  });
  const blocks = await fetchBlocks(client, "root");
  assert.deepEqual(cursors, [null, "next-page", "next-page"]);
  assert.deepEqual(
    blocks.map((block) => block.id),
    ["first", "second"]
  );
} else if (scenario === "default-spacing") {
  const starts: number[] = [];
  await Promise.all(
    [1, 2].map(() =>
      withRetry(async () => {
        starts.push(performance.now());
      })
    )
  );
  assertSpacing(starts, 334);
} else {
  throw new Error(`Unknown scenario: ${scenario}`);
}
