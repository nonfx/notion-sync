/**
 * Tests for markdown -> Notion block request parsing.
 */

import { describe, it, expect } from "bun:test";
import { parseMarkdownBlocks, type BlockRequest } from "../parser.ts";

function types(blocks: BlockRequest[]): string[] {
  return blocks.map((b) => b.type);
}

describe("parseMarkdownBlocks", () => {
  it("parses headings (clamping to 1-3)", () => {
    const blocks = parseMarkdownBlocks("# One\n\n## Two\n\n### Three\n\n#### Four");
    expect(types(blocks)).toEqual(["heading_1", "heading_2", "heading_3", "heading_3"]);
    expect((blocks[0]!["heading_1"] as { rich_text: unknown[] }).rich_text).toEqual([
      { type: "text", text: { content: "One" } },
    ]);
  });

  it("parses a paragraph", () => {
    const blocks = parseMarkdownBlocks("Just a paragraph.");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("paragraph");
  });

  it("parses a bulleted list", () => {
    const blocks = parseMarkdownBlocks("- one\n- two\n- three");
    expect(types(blocks)).toEqual([
      "bulleted_list_item",
      "bulleted_list_item",
      "bulleted_list_item",
    ]);
  });

  it("parses a numbered list", () => {
    const blocks = parseMarkdownBlocks("1. one\n2. two");
    expect(types(blocks)).toEqual(["numbered_list_item", "numbered_list_item"]);
  });

  it("parses to-do items with checked state", () => {
    const blocks = parseMarkdownBlocks("- [ ] todo\n- [x] done");
    expect(types(blocks)).toEqual(["to_do", "to_do"]);
    expect((blocks[0]!["to_do"] as { checked: boolean }).checked).toBe(false);
    expect((blocks[1]!["to_do"] as { checked: boolean }).checked).toBe(true);
  });

  it("parses nested list items as children", () => {
    const blocks = parseMarkdownBlocks("- parent\n  - child\n  - child2");
    expect(blocks).toHaveLength(1);
    const parent = blocks[0]!;
    expect(parent.type).toBe("bulleted_list_item");
    expect(parent.children).toHaveLength(2);
    expect(parent.children![0]!.type).toBe("bulleted_list_item");
  });

  it("parses a fenced code block with language", () => {
    const blocks = parseMarkdownBlocks("```ts\nconst x = 1;\n```");
    expect(blocks).toHaveLength(1);
    const code = blocks[0]!["code"] as {
      language: string;
      rich_text: Array<{ text: { content: string } }>;
    };
    expect(code.language).toBe("typescript");
    expect(code.rich_text[0]!.text.content).toBe("const x = 1;");
  });

  it("falls back to 'plain text' for unknown code languages", () => {
    const blocks = parseMarkdownBlocks("```madeuplang\nx\n```");
    const code = blocks[0]!["code"] as { language: string };
    expect(code.language).toBe("plain text");
  });

  it("parses a blockquote", () => {
    const blocks = parseMarkdownBlocks("> quoted line");
    expect(blocks[0]!.type).toBe("quote");
  });

  it("parses a divider", () => {
    const blocks = parseMarkdownBlocks("---");
    expect(blocks[0]!.type).toBe("divider");
  });

  it("parses a GFM table", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toHaveLength(1);
    const table = blocks[0]!["table"] as {
      table_width: number;
      children: Array<{ table_row: { cells: unknown[][] } }>;
    };
    expect(table.table_width).toBe(2);
    expect(table.children).toHaveLength(2);
    expect(table.children[0]!.table_row.cells).toHaveLength(2);
  });

  it("parses an external image", () => {
    const blocks = parseMarkdownBlocks("![alt](https://example.com/i.png)");
    expect(blocks[0]!.type).toBe("image");
    expect(blocks[0]!["image"]).toEqual({
      type: "external",
      external: { url: "https://example.com/i.png" },
    });
  });

  it("parses a <details> toggle with children", () => {
    const md = "<details>\n<summary>More</summary>\n\nHidden text.\n\n</details>";
    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("toggle");
    expect(blocks[0]!.children![0]!.type).toBe("paragraph");
  });

  it("skips the generated-file header comment", () => {
    const md = "<!--\n  Auto-generated. Do not edit.\n-->\n\n# Title";
    const blocks = parseMarkdownBlocks(md);
    expect(types(blocks)).toEqual(["heading_1"]);
  });

  it("skips notion-unsupported placeholders", () => {
    const md =
      '<div class="notion-unsupported" data-block-type="ai_block">\n  <em>x</em>\n</div>\n\nReal text.';
    const blocks = parseMarkdownBlocks(md);
    expect(types(blocks)).toEqual(["paragraph"]);
  });

  it("separates blocks across blank lines", () => {
    const blocks = parseMarkdownBlocks("para one\n\npara two");
    expect(types(blocks)).toEqual(["paragraph", "paragraph"]);
  });
});
