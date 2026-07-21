/**
 * Tests for single-source sync index bootstrap used by multi-source orchestration.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSyncIndex } from "../engine.ts";
import { loadIndex } from "../index.ts";

const ROOT_PAGE_ID = "d95e4b1bba544a1794a68c9005e4fa0a";

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
