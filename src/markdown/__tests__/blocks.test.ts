/**
 * Tests for block to markdown conversion
 */

import { describe, it, expect } from "bun:test";
import { blockToMarkdown, blocksToMarkdown, type RenderContext } from "../blocks.ts";
import {
  paragraphBlock,
  paragraphWithFormatting,
  paragraphWithLink,
  paragraphWithPageMention,
  heading1Block,
  heading2Block,
  heading3Block,
  bulletedListItems,
  numberedListItems,
  todoItems,
  codeBlock,
  codeBlockWithCaption,
  quoteBlock,
  calloutBlock,
  dividerBlock,
  imageBlock,
  bookmarkBlock,
  toggleBlock,
  tableBlock,
  childPageBlock,
  childDatabaseBlock,
  equationBlock,
  mixedContentBlocks,
} from "./fixtures.ts";

describe("blockToMarkdown", () => {
  describe("paragraphs", () => {
    it("converts simple paragraph", () => {
      const result = blockToMarkdown(paragraphBlock);
      expect(result).toBe("This is a simple paragraph.\n");
    });

    it("converts paragraph with formatting", () => {
      const result = blockToMarkdown(paragraphWithFormatting);
      expect(result).toBe(
        "This has **bold**, *italic*, ~~strikethrough~~, and `code` formatting.\n"
      );
    });

    it("converts paragraph with external link", () => {
      const result = blockToMarkdown(paragraphWithLink);
      expect(result).toBe(
        "Check out [this link](https://example.com) for more info.\n"
      );
    });

    it("converts paragraph with page mention (notion:// URL)", () => {
      const result = blockToMarkdown(paragraphWithPageMention);
      expect(result).toBe(
        "See the [Statement](notion://2c3e4ea0-0265-80c8-8670-c7f63e97b0e3) page for details.\n"
      );
    });
  });

  describe("headings", () => {
    it("converts heading 1", () => {
      const result = blockToMarkdown(heading1Block);
      expect(result).toBe("# Main Heading\n");
    });

    it("converts heading 2", () => {
      const result = blockToMarkdown(heading2Block);
      expect(result).toBe("## Section Heading\n");
    });

    it("converts heading 3", () => {
      const result = blockToMarkdown(heading3Block);
      expect(result).toBe("### Subsection Heading\n");
    });
  });

  describe("lists", () => {
    it("converts bulleted list item", () => {
      const result = blockToMarkdown(bulletedListItems[0]!);
      expect(result).toBe("- First item\n");
    });

    it("converts numbered list item", () => {
      const result = blockToMarkdown(numberedListItems[0]!);
      expect(result).toBe("1. Open Audit tab\n");
    });

    it("converts unchecked todo", () => {
      const result = blockToMarkdown(todoItems[0]!);
      expect(result).toBe("- [ ] Unchecked task\n");
    });

    it("converts checked todo", () => {
      const result = blockToMarkdown(todoItems[1]!);
      expect(result).toBe("- [x] Completed task\n");
    });
  });

  describe("code blocks", () => {
    it("converts code block with language", () => {
      const result = blockToMarkdown(codeBlock);
      expect(result).toBe(
        '```typescript\nfunction hello() {\n  console.log("Hello, world!");\n}\n```\n'
      );
    });

    it("converts code block with caption", () => {
      const result = blockToMarkdown(codeBlockWithCaption);
      expect(result).toBe("```bash\nnpm install notion-rsync\n```\n*Install the package*\n");
    });
  });

  describe("quotes and callouts", () => {
    it("converts quote block", () => {
      const result = blockToMarkdown(quoteBlock);
      expect(result).toBe("> This is a quote block.\n");
    });

    it("converts callout with emoji", () => {
      const result = blockToMarkdown(calloutBlock);
      expect(result).toBe("> 💡 Important note here!\n");
    });
  });

  describe("other blocks", () => {
    it("converts divider", () => {
      const result = blockToMarkdown(dividerBlock);
      expect(result).toBe("---\n");
    });

    it("converts image with caption", () => {
      const result = blockToMarkdown(imageBlock);
      expect(result).toBe("![Example image caption](https://example.com/image.png)\n");
    });

    it("converts bookmark with caption", () => {
      const result = blockToMarkdown(bookmarkBlock);
      expect(result).toBe("[Example repository](https://github.com/example/repo)\n");
    });

    it("converts toggle with children", () => {
      const result = blockToMarkdown(toggleBlock);
      expect(result).toContain("<details>");
      expect(result).toContain("<summary>Click to expand</summary>");
      expect(result).toContain("This is a simple paragraph.");
      expect(result).toContain("</details>");
    });

    it("converts equation block", () => {
      const result = blockToMarkdown(equationBlock);
      expect(result).toBe("$$\nE = mc^2\n$$\n");
    });

    it("converts child page reference", () => {
      const result = blockToMarkdown(childPageBlock);
      expect(result).toMatch(/\[Child Page Title\]\(notion:\/\/[a-z0-9-]+\)/);
    });

    it("converts child database reference (without context)", () => {
      const result = blockToMarkdown(childDatabaseBlock);
      // Without context, shows title and link
      expect(result).toContain("**My Database**");
      expect(result).toMatch(/\[View database\]\(notion:\/\/[a-z0-9-]+\)/);
    });

    it("converts child database with context as table", () => {
      // Create context with database entries
      const context: RenderContext = {
        databases: new Map([
          [childDatabaseBlock.id, [
            { id: "page-1", title: "First Entry", properties: { Status: "Active", Priority: "High" } },
            { id: "page-2", title: "Second Entry", properties: { Status: "Done", Priority: "Low" } },
          ]],
        ]),
      };
      
      const result = blockToMarkdown(childDatabaseBlock, 0, context);
      
      // Should render as table
      expect(result).toContain("**My Database**");
      expect(result).toContain("| Page | Status | Priority |");
      expect(result).toContain("| --- | --- | --- |");
      expect(result).toContain("[First Entry](notion://page-1)");
      expect(result).toContain("Active");
      expect(result).toContain("[Second Entry](notion://page-2)");
      expect(result).toContain("Done");
    });
  });

  describe("tables", () => {
    it("converts table with headers", () => {
      const result = blockToMarkdown(tableBlock);
      expect(result).toContain("| Header 1 | Header 2 | Header 3 |");
      expect(result).toContain("| --- | --- | --- |");
      expect(result).toContain("| Cell 1 | Cell 2 | Cell 3 |");
    });
  });
});

describe("blocksToMarkdown", () => {
  it("joins list items without extra blank lines", () => {
    const result = blocksToMarkdown(numberedListItems);
    const lines = result.split("\n").filter((line) => line.trim() !== "");
    
    expect(lines).toEqual([
      "1. Open Audit tab",
      "1. Click \"New Audit\"",
      "1. Enter: name, description, and other fields",
    ]);
  });

  it("joins bulleted list items without extra blank lines", () => {
    const result = blocksToMarkdown(bulletedListItems);
    const lines = result.split("\n").filter((line) => line.trim() !== "");
    
    expect(lines).toEqual([
      "- First item",
      "- Second item",
      "- Third item",
    ]);
  });

  it("adds blank lines between different block types", () => {
    const blocks = [heading1Block, paragraphBlock];
    const result = blocksToMarkdown(blocks);
    
    // Should have blank line between heading and paragraph
    expect(result).toBe("# Main Heading\n\nThis is a simple paragraph.\n");
  });

  it("handles mixed content correctly", () => {
    const result = blocksToMarkdown(mixedContentBlocks);
    
    // Check structure: headings, lists, paragraphs are separated properly
    expect(result).toContain("# Main Heading");
    expect(result).toContain("## Section Heading");
    expect(result).toContain("- First item");
    expect(result).toContain("- Second item");
    expect(result).toContain("- Third item");
    expect(result).toContain("---");
    
    // Lists should NOT have blank lines between items
    const listSection = result.match(/- First item[\s\S]*- Third item/);
    expect(listSection).toBeTruthy();
    const listContent = listSection![0];
    // Count lines between list items (should be consecutive)
    const listLines = listContent.split("\n").filter((l) => l.startsWith("- "));
    expect(listLines.length).toBe(3);
  });

  it("returns empty string for null/empty blocks", () => {
    expect(blocksToMarkdown(null)).toBe("");
    expect(blocksToMarkdown(undefined)).toBe("");
    expect(blocksToMarkdown([])).toBe("");
  });
});
