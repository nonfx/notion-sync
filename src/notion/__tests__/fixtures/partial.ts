import assert from "node:assert/strict";
import { mock } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import * as sdk from "@notionhq/client";

const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const paths: string[] = [];
const transport = async (url: string) => {
  const path = new URL(url).pathname;
  paths.push(path);
  if (path.includes("/pages/")) {
    return Response.json({
      object: "page",
      id,
      url: `https://notion.so/${id}`,
      last_edited_time: "2026-01-01T00:00:00.000Z",
      properties: {
        title: { type: "title", title: [{ plain_text: "Saved page" }] },
      },
    });
  }
  return Response.json({ object: "list", results: [], has_more: false, next_cursor: null });
};
const RealClient = sdk.Client;
class TestClient extends RealClient {
  constructor(options: ConstructorParameters<typeof RealClient>[0]) {
    super({ ...options, fetch: transport });
  }
}
mock.module("@notionhq/client", () => ({ ...sdk, Client: TestClient }));

const { partialSync } = await import("../../../sync/partial.ts");
const { createEmptyIndex, writeIndex, loadIndex, INDEX_DIR } =
  await import("../../../sync/index.ts");
const { setRequestLimits } = await import("../../requests.ts");
const { setLogLevel } = await import("../../../utils/logger.ts");
setLogLevel("error");
setRequestLimits({ concurrency: 1, minIntervalMs: 0 });
await mkdir(".tmp", { recursive: true });
const outputDir = await mkdtemp(join(".tmp", "partial-request-test-"));
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  await mkdir(join(outputDir, INDEX_DIR));
  await writeIndex(outputDir, createEmptyIndex(id));
  await Promise.race([
    partialSync({ outputDir, notionToken: "test", pageIds: [id], dryRun: false }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Partial sync deadlocked with concurrency 1")),
        1000
      );
    }),
  ]);
  assert.deepEqual(paths, [`/v1/pages/${id}`, `/v1/blocks/${id}/children`]);
  const index = await loadIndex(outputDir);
  assert.equal(index?.pages[id]?.title, "Saved page");
  assert.ok(await Bun.file(join(outputDir, "saved-page.md")).exists());
} finally {
  clearTimeout(timer);
  await rm(outputDir, { recursive: true, force: true });
}
