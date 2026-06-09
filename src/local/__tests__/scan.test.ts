/**
 * Tests for scanning a local markdown directory into a page tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanDirectory, flattenNodes, type LocalNode } from "../scan.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notion-scan-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function find(nodes: LocalNode[], title: string): LocalNode | undefined {
  return flattenNodes(nodes).find((n) => n.title === title);
}

describe("scanDirectory", () => {
  it("scans a root index.md as the single root page with children", async () => {
    await writeFile(join(dir, "index.md"), "# Home\n\nWelcome.\n");
    await writeFile(join(dir, "guide.md"), "# Guide\n\nGuide body.\n");

    const nodes = await scanDirectory(dir);
    expect(nodes).toHaveLength(1);
    const root = nodes[0]!;
    expect(root.title).toBe("Home");
    expect(root.relPath).toBe("index.md");
    expect(root.children).toHaveLength(1);
    expect(root.children[0]!.title).toBe("Guide");
    expect(root.children[0]!.relPath).toBe("guide.md");
  });

  it("treats a subdirectory's index.md as the directory's page", async () => {
    await writeFile(join(dir, "index.md"), "# Home\n");
    await mkdir(join(dir, "concepts"));
    await writeFile(join(dir, "concepts", "index.md"), "# Concepts\n");
    await writeFile(join(dir, "concepts", "clause.md"), "# Clause\n");

    const nodes = await scanDirectory(dir);
    const concepts = find(nodes, "Concepts")!;
    expect(concepts.relPath).toBe("concepts/index.md");
    expect(concepts.children.map((c) => c.title)).toEqual(["Clause"]);
  });

  it("synthesizes a page for a directory without index.md", async () => {
    await mkdir(join(dir, "my-folder"));
    await writeFile(join(dir, "my-folder", "note.md"), "# Note\n");

    const nodes = await scanDirectory(dir);
    expect(nodes).toHaveLength(1);
    const folder = nodes[0]!;
    expect(folder.title).toBe("My Folder");
    expect(folder.filePath).toBeNull();
    expect(folder.children.map((c) => c.title)).toEqual(["Note"]);
  });

  it("reads notion_id from frontmatter", async () => {
    await writeFile(
      join(dir, "page.md"),
      `---
notion_id: abc-123
title: "Page"
---

Body.
`
    );
    const nodes = await scanDirectory(dir);
    expect(nodes[0]!.notionId).toBe("abc-123");
  });

  it("ignores the .notion-rsync directory", async () => {
    await writeFile(join(dir, "index.md"), "# Home\n");
    await mkdir(join(dir, ".notion-rsync"));
    await writeFile(join(dir, ".notion-rsync", "index.json"), "{}");

    const nodes = await scanDirectory(dir);
    expect(flattenNodes(nodes)).toHaveLength(1);
  });
});
