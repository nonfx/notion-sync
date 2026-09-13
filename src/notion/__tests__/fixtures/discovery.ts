import assert from "node:assert/strict";
import { Client, LogLevel } from "@notionhq/client";
import { buildPageTree, buildDatabaseTree } from "../../tree.ts";
import { setRequestLimits } from "../../requests.ts";
import { classifySelector } from "../../../config/schema.ts";
import { setLogLevel } from "../../../utils/logger.ts";

setLogLevel("error");
setRequestLimits({ concurrency: 1, minIntervalMs: 1 });
const scenario = process.argv[2];
const calls: string[] = [];
const failure = new Error("Container unavailable");
const root = "11111111111111111111111111111111";
const database = "22222222222222222222222222222222";
const entry = "33333333333333333333333333333333";

function block(id: string, type: string, hasChildren = false): Record<string, unknown> {
  return { object: "block", id, type, has_children: hasChildren, [type]: { title: id } };
}
function page(id: string): Record<string, unknown> {
  return {
    object: "page",
    id,
    url: `https://notion.so/${id}`,
    last_edited_time: "2026-01-01T00:00:00Z",
    properties: {
      title: { type: "title", title: [{ plain_text: id === root ? "Root" : "Entry" }] },
    },
  };
}
function list(results: unknown[]): Response {
  return Response.json({ object: "list", results, has_more: false, next_cursor: null });
}
const client = new Client({
  auth: "test",
  logLevel: LogLevel.ERROR,
  fetch: async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path.startsWith("/v1/pages/")) return Response.json(page(path.split("/").at(-1)!));
    if (path === `/v1/databases/${root}` || path === `/v1/databases/${database}`) {
      return Response.json({
        object: "database",
        id: path.split("/").at(-1),
        last_edited_time: "2026-01-01T00:00:00Z",
        title: [{ plain_text: "Database" }],
      });
    }
    if (path === `/v1/databases/${root}/query`) return list([]);
    if (path === `/v1/databases/${database}/query`) return list([page(entry)]);
    if (path === `/v1/blocks/${root}/children`) {
      return list([
        ...(scenario === "duplicate" || scenario === "failure"
          ? [block(database, "child_database")]
          : []),
        block("toggle", "toggle", true),
      ]);
    }
    if (path === "/v1/blocks/toggle/children") {
      if (scenario === "failure") throw failure;
      return list([block("columns", "column_list", true)]);
    }
    if (path === "/v1/blocks/columns/children") return list([block("column", "column", true)]);
    if (path === "/v1/blocks/column/children")
      return list([block(database, "child_database", true)]);
    if (path === `/v1/blocks/${database}/children` || path === `/v1/blocks/${entry}/children`)
      return list([]);
    throw new Error(`Unexpected endpoint: ${path}`);
  },
});

if (scenario === "failure") {
  const error = await buildPageTree(client, root).then(
    () => null,
    (error: unknown) => error
  );
  assert.ok(error instanceof Error);
  assert.match(error.message, /toggle/);
  assert.ok(error.message.includes(root));
  assert.equal(error.cause, failure);
} else if (scenario === "pruned") {
  const tree = await buildPageTree(client, root, 0, 10, {
    selectors: { include: [], exclude: [classifySelector(root)], defaultExclude: [] },
  });
  assert.equal(tree.excluded, true);
  assert.deepEqual(tree.children, []);
  assert.deepEqual(calls, [`/v1/pages/${root}`]);
} else {
  const options =
    scenario === "database-excluded"
      ? {
          selectors: { include: [], exclude: [classifySelector(database)], defaultExclude: [] },
        }
      : {};
  const tree =
    scenario === "database-root"
      ? await buildDatabaseTree(client, root)
      : await buildPageTree(client, root, 0, scenario === "depth" ? 1 : 10, options);
  assert.ok(tree);
  assert.deepEqual(
    tree.children.map((child) => child.id),
    [database]
  );
  assert.equal(calls.filter((path) => path === `/v1/blocks/${root}/children`).length, 1);
  assert.equal(calls.filter((path) => path === `/v1/databases/${database}`).length, 1);
  if (scenario === "database-excluded") {
    assert.equal(tree.children[0]?.excluded, true);
    assert.deepEqual(tree.children[0]?.children, []);
    assert.ok(!calls.includes(`/v1/databases/${database}/query`));
    assert.ok(!calls.includes(`/v1/blocks/${database}/children`));
  } else {
    assert.equal(tree.children[0]?.children[0]?.id, entry);
    if (scenario === "depth") {
      assert.equal(tree.children[0]?.children[0]?.title, "[Max depth reached]");
      assert.ok(!calls.includes(`/v1/pages/${entry}`));
      assert.ok(!calls.includes(`/v1/blocks/${entry}/children`));
    } else {
      assert.equal(tree.children[0]?.children[0]?.title, "Entry");
    }
  }
}
