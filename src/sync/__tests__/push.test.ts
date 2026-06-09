/**
 * End-to-end tests for the push engine (markdown -> Notion).
 *
 * These cover the two bidirectional-sync scenarios the feature targets:
 *   1. Brand-new folder: a hand-authored tree with internal links is uploaded,
 *      creating pages that mirror the folder hierarchy with links resolved to
 *      Notion page mentions.
 *   2. Round-trip: a previously-synced tree (files carry notion_id frontmatter)
 *      updates the existing pages in place instead of creating duplicates.
 *
 * The Notion API is replaced with an in-memory fake writer so the engine's
 * orchestration, hierarchy, content conversion, and link resolution can be
 * verified without a network or token.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { push } from "../push.ts";
import type { NotionWriter, PageParent } from "../../notion/writer.ts";
import type { BlockRequest } from "../../markdown/parser.ts";

interface FakePage {
  id: string;
  title: string;
  parentId: string;
  blocks: BlockRequest[];
}

class FakeNotion implements NotionWriter {
  pages = new Map<string, FakePage>();
  createOrder: string[] = [];
  private counter = 0;

  // Pre-seed an existing page (for the round-trip scenario).
  seed(id: string, title: string, parentId = "", blocks: BlockRequest[] = []): void {
    this.pages.set(id, { id, title, parentId, blocks });
  }

  async createPage(parent: PageParent, title: string): Promise<string> {
    const id = `id-${++this.counter}`;
    this.pages.set(id, { id, title, parentId: parent.id, blocks: [] });
    this.createOrder.push(id);
    return id;
  }

  async setTitle(pageId: string, title: string): Promise<void> {
    const page = this.pages.get(pageId);
    if (page) page.title = title;
  }

  async clearBlocks(pageId: string): Promise<void> {
    const page = this.pages.get(pageId);
    if (page) page.blocks = [];
  }

  async appendBlocks(parentBlockId: string, blocks: BlockRequest[]): Promise<void> {
    const page = this.pages.get(parentBlockId);
    if (page) page.blocks.push(...blocks);
  }

  page(title: string): FakePage {
    for (const page of this.pages.values()) {
      if (page.title === title) return page;
    }
    throw new Error(`No page titled "${title}"`);
  }
}

/** Collect every page-mention id referenced in a page's block rich text. */
function mentionIds(blocks: BlockRequest[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    const payload = block[block.type] as { rich_text?: Array<Record<string, unknown>> } | undefined;
    for (const rt of payload?.rich_text ?? []) {
      if (rt["type"] === "mention") {
        const mention = rt["mention"] as { page: { id: string } };
        ids.push(mention.page.id);
      }
    }
    if (block.children) ids.push(...mentionIds(block.children));
  }
  return ids;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "notion-push-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("push - brand-new folder", () => {
  beforeEach(async () => {
    // root/index.md (Home) -> guide.md (Guide), concepts/ (Concepts) -> clause.md (Clause)
    await writeFile(
      join(dir, "index.md"),
      "# Home\n\nWelcome. See the [Guide](./guide.md) and the [Clause](./concepts/clause.md).\n"
    );
    await writeFile(join(dir, "guide.md"), "# Guide\n\nHow to use the thing.\n");
    await mkdir(join(dir, "concepts"));
    await writeFile(join(dir, "concepts", "index.md"), "# Concepts\n\nKey ideas.\n");
    await writeFile(
      join(dir, "concepts", "clause.md"),
      "# Clause\n\nA clause references the [Guide](../guide.md).\n"
    );
  });

  it("creates a page per file mirroring the folder hierarchy", async () => {
    const fake = new FakeNotion();
    const result = await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });

    expect(result.created).toBe(4);
    expect(result.updated).toBe(0);
    expect(fake.pages.size).toBe(4);

    const home = fake.page("Home");
    const guide = fake.page("Guide");
    const concepts = fake.page("Concepts");
    const clause = fake.page("Clause");

    // Hierarchy: Home under the target parent; the rest under their dir page.
    expect(home.parentId).toBe("root-parent");
    expect(guide.parentId).toBe(home.id);
    expect(concepts.parentId).toBe(home.id);
    expect(clause.parentId).toBe(concepts.id);
  });

  it("converts markdown content into Notion blocks", async () => {
    const fake = new FakeNotion();
    await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });

    const guide = fake.page("Guide");
    // The leading H1 (title) is not duplicated as a block; only the body remains.
    expect(guide.blocks).toHaveLength(1);
    expect(guide.blocks[0]!.type).toBe("paragraph");
  });

  it("resolves internal links to Notion page mentions", async () => {
    const fake = new FakeNotion();
    await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });

    const guide = fake.page("Guide");
    const clause = fake.page("Clause");

    // Home links to Guide and Clause.
    expect(mentionIds(fake.page("Home").blocks).sort()).toEqual([clause.id, guide.id].sort());
    // Clause links back to Guide.
    expect(mentionIds(clause.blocks)).toEqual([guide.id]);
  });

  it("writes a sync index recording every page", async () => {
    const fake = new FakeNotion();
    await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });

    const raw = await readFile(join(dir, ".notion-rsync", "index.json"), "utf-8");
    const index = JSON.parse(raw) as {
      rootPageId: string;
      pages: Record<string, { path: string }>;
    };
    expect(index.rootPageId).toBe("root-parent");
    expect(Object.keys(index.pages)).toHaveLength(4);
    const paths = Object.values(index.pages)
      .map((p) => p.path)
      .sort();
    expect(paths).toEqual(["concepts/clause.md", "concepts/index.md", "guide.md", "index.md"]);
  });

  it("errors when no target parent is available for new pages", async () => {
    const fake = new FakeNotion();
    await expect(push({ outputDir: dir, writer: fake })).rejects.toThrow(/target Notion parent/);
  });
});

describe("push - round-trip (existing pages)", () => {
  const HOME_ID = "11111111-1111-1111-1111-111111111111";
  const GUIDE_ID = "22222222-2222-2222-2222-222222222222";

  beforeEach(async () => {
    await writeFile(
      join(dir, "index.md"),
      `---
notion_id: ${HOME_ID}
title: "Home"
---

# Home

Updated welcome. See the [Guide](./guide.md).
`
    );
    await writeFile(
      join(dir, "guide.md"),
      `---
notion_id: ${GUIDE_ID}
title: "Guide"
---

# Guide

Updated guide body.
`
    );
  });

  it("updates existing pages in place instead of creating new ones", async () => {
    const fake = new FakeNotion();
    fake.seed(HOME_ID, "Home", "workspace", [
      { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "old" } }] } },
    ]);
    fake.seed(GUIDE_ID, "Guide", HOME_ID);

    const result = await push({ outputDir: dir, parentPageId: "workspace", writer: fake });

    expect(result.created).toBe(0);
    expect(result.updated).toBe(2);
    expect(fake.pages.size).toBe(2); // no duplicates created

    // Old content was replaced.
    const home = fake.pages.get(HOME_ID)!;
    expect(home.blocks).toHaveLength(1);
    const para = home.blocks[0]!["paragraph"] as { rich_text: Array<Record<string, unknown>> };
    expect(para.rich_text.some((rt) => rt["type"] === "mention")).toBe(true);
  });

  it("resolves links using ids from frontmatter", async () => {
    const fake = new FakeNotion();
    fake.seed(HOME_ID, "Home", "workspace");
    fake.seed(GUIDE_ID, "Guide", HOME_ID);

    await push({ outputDir: dir, parentPageId: "workspace", writer: fake });

    expect(mentionIds(fake.pages.get(HOME_ID)!.blocks)).toEqual([GUIDE_ID]);
  });
});

describe("push - dry run", () => {
  it("makes no changes and writes no index", async () => {
    await writeFile(join(dir, "index.md"), "# Home\n\nHi.\n");
    const fake = new FakeNotion();

    const result = await push({
      outputDir: dir,
      parentPageId: "root-parent",
      writer: fake,
      dryRun: true,
    });

    expect(result.created).toBe(1);
    expect(fake.pages.size).toBe(0);
    await expect(readFile(join(dir, ".notion-rsync", "index.json"), "utf-8")).rejects.toThrow();
  });
});

describe("push - idempotency (notion_id write-back)", () => {
  beforeEach(async () => {
    await writeFile(join(dir, "index.md"), "# Home\n\nWelcome. See the [Guide](./guide.md).\n");
    await writeFile(join(dir, "guide.md"), "# Guide\n\nHow to use the thing.\n");
  });

  it("stamps notion_id into newly-created files", async () => {
    const fake = new FakeNotion();
    await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });

    const home = await readFile(join(dir, "index.md"), "utf-8");
    const guide = await readFile(join(dir, "guide.md"), "utf-8");

    expect(home).toContain(`notion_id: ${fake.page("Home").id}`);
    expect(guide).toContain(`notion_id: ${fake.page("Guide").id}`);
    // Body content is preserved.
    expect(home).toContain("Welcome.");
  });

  it("re-pushing updates in place — no duplicates", async () => {
    const fake = new FakeNotion();
    const first = await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });
    expect(first.created).toBe(2);

    // Second push reads the stamped notion_id frontmatter and updates.
    const second = await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);
    expect(fake.pages.size).toBe(2); // still just the two original pages
  });

  it("stays idempotent via the sync index even if frontmatter is stripped", async () => {
    const fake = new FakeNotion();
    await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });

    // Simulate a user removing frontmatter from a file.
    await writeFile(join(dir, "guide.md"), "# Guide\n\nEdited, no frontmatter.\n");

    const second = await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });
    expect(second.created).toBe(0); // index path→id lookup prevents a duplicate
    expect(fake.pages.size).toBe(2);
  });

  it("materializes an index.md for a folder without one", async () => {
    await mkdir(join(dir, "extras"));
    await writeFile(join(dir, "extras", "note.md"), "# Note\n\nA note.\n");

    const fake = new FakeNotion();
    await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });

    const created = await readFile(join(dir, "extras", "index.md"), "utf-8");
    expect(created).toContain(`notion_id: ${fake.page("Extras").id}`);

    // And a re-push is idempotent now that the index.md exists.
    const second = await push({ outputDir: dir, parentPageId: "root-parent", writer: fake });
    expect(second.created).toBe(0);
  });
});
