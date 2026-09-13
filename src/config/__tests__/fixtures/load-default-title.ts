import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "bun:test";
import * as sdk from "@notionhq/client";

const pageId = "11111111111111111111111111111111";
const databaseId = "22222222222222222222222222222222";
const paths: string[] = [];

// Keep SDK request handling and application retries; replace only HTTP transport.
mock.module("@notionhq/client", () => ({
  ...sdk,
  Client: class extends sdk.Client {
    constructor(options: ConstructorParameters<typeof sdk.Client>[0]) {
      super({
        ...options,
        logLevel: sdk.LogLevel.ERROR,
        fetch: async (url) => {
          const path = new URL(String(url)).pathname;
          paths.push(path);
          if (path === `/v1/pages/${databaseId}`) {
            return Response.json(
              { object: "error", code: "validation_error", message: "This ID is a database" },
              { status: 400 }
            );
          }
          if (path === `/v1/databases/${databaseId}`) {
            return Response.json({
              object: "database",
              id: databaseId,
              title: [{ plain_text: "Database source" }],
            });
          }
          assert.equal(path, `/v1/pages/${pageId}`);
          return Response.json({
            object: "page",
            id: pageId,
            url: `https://notion.so/${pageId}`,
            properties: { title: { type: "title", title: [{ plain_text: "Page source" }] } },
          });
        },
      });
    }
  },
}));

const { loadConfig } = await import("../../load.ts");
const dir = await mkdtemp(join(tmpdir(), "notion-default-title-"));
const timeout = setTimeout(() => {
  console.error("Default title resolution deadlocked with one request slot");
  process.exit(1);
}, 1500);
try {
  const configPath = join(dir, "config.json");
  await Bun.write(
    configPath,
    JSON.stringify({
      concurrency: 1,
      requestIntervalMs: 1,
      sources: [
        { id: pageId, output: "page" },
        { id: databaseId, output: "database" },
      ],
    })
  );
  const result = await loadConfig({ configPath, notionToken: "test-token" });
  assert.deepEqual(
    result.sources.map((source) => source.name),
    ["Page source", "Database source"]
  );
  assert.deepEqual(paths, [
    `/v1/pages/${pageId}`,
    `/v1/pages/${databaseId}`,
    `/v1/databases/${databaseId}`,
  ]);
} finally {
  clearTimeout(timeout);
  await rm(dir, { recursive: true, force: true });
}
