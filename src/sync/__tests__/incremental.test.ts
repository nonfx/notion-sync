/**
 * Tests for incremental sync: the planner that decides which pages to
 * re-fetch, and the writer's skip behavior for unchanged pages.
 *
 * The planner is pure (tree metadata + index + path/existence callbacks), so
 * it's tested directly. The writer tests run against a real temp dir to prove
 * skipped pages keep their bytes, reserve their filenames for sibling dedup,
 * and still appear in the results for index bookkeeping.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSync, lookupPageState } from "../engine.ts";
import type { SyncIndex } from "../index.ts";
import { writePageTree, computeLinkMap } from "../../markdown/writer.ts";
import type { PageNode } from "../../notion/tree.ts";

const T1 = "2026-08-01T10:00:00.000Z";
const T2 = "2026-08-02T12:34:56.000Z";

function node(id: string, title: string, lastEditedTime: string, children: PageNode[] = []): PageNode {
  return { id, title, lastEditedTime, children, blocks: null };
}

function indexWith(pages: SyncIndex["pages"]): SyncIndex {
  return { version: "1.0.0", rootPageId: "root", lastSync: T1, pages };
}

describe("planSync", () => {
  const pathFor = (paths: Record<string, string>) => (id: string) => paths[id];
  const allExist = () => true;

  it("skips a page whose lastEdited, title, and path all match", () => {
    const nodes = [node("aaaa", "Doc", T1)];
    const index = indexWith({ aaaa: { path: "doc.md", title: "Doc", lastEdited: T1 } });

    const plan = planSync(nodes, index, pathFor({ aaaa: "doc.md" }), allExist);

    expect(plan.unchangedIds.has("aaaa")).toBe(true);
    expect(plan.changedIds.size).toBe(0);
  });

  it("re-fetches a page whose lastEdited moved", () => {
    const nodes = [node("aaaa", "Doc", T2)];
    const index = indexWith({ aaaa: { path: "doc.md", title: "Doc", lastEdited: T1 } });

    const plan = planSync(nodes, index, pathFor({ aaaa: "doc.md" }), allExist);

    expect(plan.changedIds.has("aaaa")).toBe(true);
  });

  it("re-fetches a renamed page even when lastEdited matches", () => {
    const nodes = [node("aaaa", "Doc v2", T1)];
    const index = indexWith({ aaaa: { path: "doc.md", title: "Doc", lastEdited: T1 } });

    const plan = planSync(nodes, index, pathFor({ aaaa: "doc-v2.md" }), allExist);

    expect(plan.changedIds.has("aaaa")).toBe(true);
  });

  it("re-fetches a page whose computed path moved (renamed ancestor)", () => {
    const nodes = [node("aaaa", "Doc", T1)];
    const index = indexWith({ aaaa: { path: "old-parent/doc.md", title: "Doc", lastEdited: T1 } });

    const plan = planSync(nodes, index, pathFor({ aaaa: "new-parent/doc.md" }), allExist);

    expect(plan.changedIds.has("aaaa")).toBe(true);
  });

  it("re-fetches when the file is missing on disk", () => {
    const nodes = [node("aaaa", "Doc", T1)];
    const index = indexWith({ aaaa: { path: "doc.md", title: "Doc", lastEdited: T1 } });

    const plan = planSync(nodes, index, pathFor({ aaaa: "doc.md" }), () => false);

    expect(plan.changedIds.has("aaaa")).toBe(true);
  });

  it("counts pages missing from the index as new", () => {
    const nodes = [node("aaaa", "Doc", T1), node("bbbb", "New page", T1)];
    const index = indexWith({ aaaa: { path: "doc.md", title: "Doc", lastEdited: T1 } });

    const plan = planSync(nodes, index, pathFor({ aaaa: "doc.md", bbbb: "new-page.md" }), allExist);

    expect(plan.newCount).toBe(1);
    expect(plan.changedIds.has("bbbb")).toBe(true);
    expect(plan.unchangedIds.has("aaaa")).toBe(true);
  });

  it("matches index entries regardless of dash format", () => {
    const dashed = "2c3e4ea0-0265-8010-980c-d9e2fab0643e";
    const undashed = dashed.replace(/-/g, "");
    const nodes = [node(undashed, "Doc", T1)];
    const index = indexWith({ [dashed]: { path: "doc.md", title: "Doc", lastEdited: T1 } });

    const plan = planSync(nodes, index, () => "doc.md", allExist);

    expect(plan.unchangedIds.has(undashed)).toBe(true);
    expect(lookupPageState(index, undashed)?.path).toBe("doc.md");
  });

  it("re-fetches everything against a pre-incremental index (sync-time stamps)", () => {
    // Old indexes stamped lastEdited with the sync time, which matches no
    // page's real last_edited_time — one full re-fetch heals the index.
    const syncStamp = "2026-08-03T02:53:21.972Z";
    const nodes = [node("aaaa", "A", T1), node("bbbb", "B", T2)];
    const index = indexWith({
      aaaa: { path: "a.md", title: "A", lastEdited: syncStamp },
      bbbb: { path: "b.md", title: "B", lastEdited: syncStamp },
    });

    const plan = planSync(nodes, index, pathFor({ aaaa: "a.md", bbbb: "b.md" }), allExist);

    expect(plan.changedIds.size).toBe(2);
    expect(plan.unchangedIds.size).toBe(0);
  });
});

describe("writePageTree with skipIds", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "notion-rsync-incr-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("does not rewrite skipped pages but still records them in results", async () => {
    const tree = node("root", "Root", T1, [
      node("aaaa", "Changed", T2),
      node("bbbb", "Unchanged", T1),
    ]);

    // Pre-existing bytes for the unchanged page (sentinel content the writer
    // could never produce).
    await mkdir(join(dir, "root"), { recursive: true });
    const unchangedPath = join(dir, "root", "unchanged.md");
    await writeFile(unchangedPath, "SENTINEL — must survive the sync\n", "utf-8");
    const before = await stat(unchangedPath);

    const results = await writePageTree(tree, {
      outputDir: dir,
      skipIds: new Set(["bbbb"]),
    });

    // Skipped page: bytes untouched, still in results with written: false
    expect(await readFile(unchangedPath, "utf-8")).toContain("SENTINEL");
    const after = await stat(unchangedPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(results.get("bbbb")).toMatchObject({ path: "root/unchanged.md", written: false });

    // Changed sibling and root were written
    expect(results.get("aaaa")?.written).toBe(true);
    expect(results.get("root")?.written).toBe(true);
    expect((await readFile(join(dir, "root", "changed.md"), "utf-8")).length).toBeGreaterThan(0);
  });

  it("reserves skipped pages' filenames so a new sibling with the same title dedupes", async () => {
    // Two leaves with the same title: the skipped one holds "dupe.md", so the
    // new one must land on "dupe-1.md" — exactly as it would in a full sync.
    const tree = node("root", "Root", T1, [node("bbbb", "Dupe", T1), node("cccc", "Dupe", T2)]);

    const results = await writePageTree(tree, {
      outputDir: dir,
      skipIds: new Set(["bbbb"]),
    });

    expect(results.get("bbbb")?.path).toBe("root/dupe.md");
    expect(results.get("cccc")?.path).toBe("root/dupe-1.md");
    expect(results.get("cccc")?.written).toBe(true);
  });

  it("computeLinkMap matches the paths writePageTree produces", async () => {
    const tree = node("root", "Root", T1, [
      node("aaaa", "Alpha", T1, [node("bbbb", "Beta", T1)]),
      node("cccc", "Gamma", T1),
    ]);

    const linkMap = computeLinkMap(tree, dir);
    const results = await writePageTree(tree, { outputDir: dir });

    for (const [id, result] of results) {
      expect(linkMap.get(id)).toBe(result.path);
    }
  });
});
