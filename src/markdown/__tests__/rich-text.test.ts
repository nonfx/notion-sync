/**
 * Tests for rich text to markdown conversion
 */

import { describe, it, expect } from "bun:test";
import { richTextToMarkdown, richTextToPlain } from "../rich-text.ts";
import type { RichText } from "../rich-text.ts";

// Helper to create rich text items
function text(
  content: string,
  options: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
    link?: string;
  } = {}
): RichText {
  return {
    type: "text",
    text: {
      content,
      link: options.link ? { url: options.link } : null,
    },
    annotations: {
      bold: options.bold ?? false,
      italic: options.italic ?? false,
      strikethrough: options.strikethrough ?? false,
      underline: false,
      code: options.code ?? false,
      color: "default",
    },
    plain_text: content,
    href: options.link ?? null,
  };
}

function pageMention(pageId: string, plainText: string): RichText {
  return {
    type: "mention",
    mention: { type: "page", page: { id: pageId } },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default",
    },
    plain_text: plainText,
    href: `https://notion.so/${pageId}`,
  } as unknown as RichText;
}

function userMention(plainText: string): RichText {
  return {
    type: "mention",
    mention: {
      type: "user",
      user: { id: "user-1", object: "user" },
    },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default",
    },
    plain_text: plainText,
    href: null,
  } as unknown as RichText;
}

function dateMention(start: string, end: string | null, plainText: string): RichText {
  return {
    type: "mention",
    mention: {
      type: "date",
      date: { start, end, time_zone: null },
    },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default",
    },
    plain_text: plainText,
    href: null,
  } as unknown as RichText;
}

function equation(expression: string): RichText {
  return {
    type: "equation",
    equation: { expression },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default",
    },
    plain_text: expression,
    href: null,
  };
}

describe("richTextToMarkdown", () => {
  describe("plain text", () => {
    it("converts plain text", () => {
      const result = richTextToMarkdown([text("Hello, world!")]);
      expect(result).toBe("Hello, world!");
    });

    it("handles empty array", () => {
      const result = richTextToMarkdown([]);
      expect(result).toBe("");
    });

    it("concatenates multiple text items", () => {
      const result = richTextToMarkdown([text("Hello, "), text("world!")]);
      expect(result).toBe("Hello, world!");
    });
  });

  describe("formatting", () => {
    it("converts bold text", () => {
      const result = richTextToMarkdown([text("bold", { bold: true })]);
      expect(result).toBe("**bold**");
    });

    it("converts italic text", () => {
      const result = richTextToMarkdown([text("italic", { italic: true })]);
      expect(result).toBe("*italic*");
    });

    it("converts strikethrough text", () => {
      const result = richTextToMarkdown([text("deleted", { strikethrough: true })]);
      expect(result).toBe("~~deleted~~");
    });

    it("converts inline code", () => {
      const result = richTextToMarkdown([text("code", { code: true })]);
      expect(result).toBe("`code`");
    });

    it("combines multiple annotations", () => {
      const result = richTextToMarkdown([text("bold and italic", { bold: true, italic: true })]);
      expect(result).toBe("***bold and italic***");
    });

    it("handles code with bold (code takes precedence)", () => {
      // Code is applied first, then bold wraps it
      const result = richTextToMarkdown([text("code", { code: true, bold: true })]);
      expect(result).toBe("**`code`**");
    });
  });

  describe("links", () => {
    it("converts text with link", () => {
      const result = richTextToMarkdown([text("click here", { link: "https://example.com" })]);
      expect(result).toBe("[click here](https://example.com)");
    });

    it("converts link with formatting", () => {
      const result = richTextToMarkdown([
        text("bold link", { link: "https://example.com", bold: true }),
      ]);
      expect(result).toBe("[**bold link**](https://example.com)");
    });
  });

  describe("mentions", () => {
    it("converts page mention to notion:// URL", () => {
      const result = richTextToMarkdown([pageMention("abc123-def456", "Linked Page")]);
      expect(result).toBe("[Linked Page](notion://abc123-def456)");
    });

    it("converts user mention with @", () => {
      const result = richTextToMarkdown([userMention("John Doe")]);
      expect(result).toBe("@John Doe");
    });

    it("converts date mention (single date)", () => {
      const result = richTextToMarkdown([dateMention("2024-01-15", null, "January 15, 2024")]);
      expect(result).toBe("2024-01-15");
    });

    it("converts date mention (date range)", () => {
      const result = richTextToMarkdown([
        dateMention("2024-01-15", "2024-01-20", "January 15-20, 2024"),
      ]);
      expect(result).toBe("2024-01-15 → 2024-01-20");
    });
  });

  describe("equations", () => {
    it("converts inline equation", () => {
      const result = richTextToMarkdown([equation("E = mc^2")]);
      expect(result).toBe("$E = mc^2$");
    });
  });

  describe("complex content", () => {
    it("handles mixed content", () => {
      const result = richTextToMarkdown([
        text("Check out "),
        text("this article", { link: "https://example.com", bold: true }),
        text(" for "),
        text("more info", { italic: true }),
        text("."),
      ]);
      expect(result).toBe("Check out [**this article**](https://example.com) for *more info*.");
    });
  });
});

describe("richTextToPlain", () => {
  it("extracts plain text without formatting", () => {
    const result = richTextToPlain([text("Hello, "), text("world", { bold: true }), text("!")]);
    expect(result).toBe("Hello, world!");
  });

  it("handles empty array", () => {
    const result = richTextToPlain([]);
    expect(result).toBe("");
  });
});
