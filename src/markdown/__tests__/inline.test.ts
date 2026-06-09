/**
 * Tests for inline markdown -> Notion rich text request parsing.
 */

import { describe, it, expect } from "bun:test";
import { parseInline, normalizeNotionId } from "../inline.ts";

describe("parseInline", () => {
  it("parses plain text", () => {
    expect(parseInline("Hello, world!")).toEqual([
      { type: "text", text: { content: "Hello, world!" } },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseInline("")).toEqual([]);
  });

  it("parses bold", () => {
    expect(parseInline("**bold**")).toEqual([
      { type: "text", text: { content: "bold" }, annotations: { bold: true } },
    ]);
  });

  it("parses italic", () => {
    expect(parseInline("*italic*")).toEqual([
      { type: "text", text: { content: "italic" }, annotations: { italic: true } },
    ]);
  });

  it("parses strikethrough", () => {
    expect(parseInline("~~gone~~")).toEqual([
      { type: "text", text: { content: "gone" }, annotations: { strikethrough: true } },
    ]);
  });

  it("parses inline code (literal, no nested parsing)", () => {
    expect(parseInline("`a*b*c`")).toEqual([
      { type: "text", text: { content: "a*b*c" }, annotations: { code: true } },
    ]);
  });

  it("parses nested bold+italic", () => {
    expect(parseInline("***both***")).toEqual([
      { type: "text", text: { content: "both" }, annotations: { bold: true, italic: true } },
    ]);
  });

  it("parses a link", () => {
    expect(parseInline("[click](https://example.com)")).toEqual([
      { type: "text", text: { content: "click", link: { url: "https://example.com" } } },
    ]);
  });

  it("parses a bold link", () => {
    expect(parseInline("[**bold link**](https://example.com)")).toEqual([
      {
        type: "text",
        text: { content: "bold link", link: { url: "https://example.com" } },
        annotations: { bold: true },
      },
    ]);
  });

  it("parses a notion:// link into a page mention", () => {
    const result = parseInline("[Statement](notion://2c3e4ea0-0265-80c8-8670-c7f63e97b0e3)");
    expect(result).toEqual([
      { type: "mention", mention: { page: { id: "2c3e4ea0-0265-80c8-8670-c7f63e97b0e3" } } },
    ]);
  });

  it("adds dashes to a bare notion id in a mention", () => {
    const result = parseInline("[Statement](notion://2c3e4ea0026580c88670c7f63e97b0e3)");
    expect(result).toEqual([
      { type: "mention", mention: { page: { id: "2c3e4ea0-0265-80c8-8670-c7f63e97b0e3" } } },
    ]);
  });

  it("drops an anchor from a notion mention id (pages can't target anchors)", () => {
    const result = parseInline(
      "[Availability](notion://37ae4ea0-0265-81eb-b897-fe059e91cc52#availability-context)"
    );
    expect(result).toEqual([
      { type: "mention", mention: { page: { id: "37ae4ea0-0265-81eb-b897-fe059e91cc52" } } },
    ]);
  });

  it("drops an unresolved relative link but keeps the text", () => {
    expect(parseInline("[Guide](./guide.md)")).toEqual([
      { type: "text", text: { content: "Guide" } },
    ]);
  });

  it("drops a bare anchor link but keeps the text", () => {
    expect(parseInline("[Section](#section)")).toEqual([
      { type: "text", text: { content: "Section" } },
    ]);
  });

  it("keeps a mailto: link", () => {
    expect(parseInline("[Email](mailto:a@b.com)")).toEqual([
      { type: "text", text: { content: "Email", link: { url: "mailto:a@b.com" } } },
    ]);
  });

  it("parses inline equation", () => {
    expect(parseInline("$E = mc^2$")).toEqual([
      { type: "equation", equation: { expression: "E = mc^2" } },
    ]);
  });

  it("parses mixed content", () => {
    const result = parseInline("Check out [**this**](https://x.io) for *more* info.");
    expect(result).toEqual([
      { type: "text", text: { content: "Check out " } },
      {
        type: "text",
        text: { content: "this", link: { url: "https://x.io" } },
        annotations: { bold: true },
      },
      { type: "text", text: { content: " for " } },
      { type: "text", text: { content: "more" }, annotations: { italic: true } },
      { type: "text", text: { content: " info." } },
    ]);
  });

  it("treats an unterminated marker as literal text", () => {
    expect(parseInline("a * b")).toEqual([{ type: "text", text: { content: "a * b" } }]);
  });
});

describe("normalizeNotionId", () => {
  it("adds dashes to a bare 32-char id", () => {
    expect(normalizeNotionId("2c3e4ea0026580c88670c7f63e97b0e3")).toBe(
      "2c3e4ea0-0265-80c8-8670-c7f63e97b0e3"
    );
  });

  it("leaves an already-dashed id unchanged", () => {
    expect(normalizeNotionId("2c3e4ea0-0265-80c8-8670-c7f63e97b0e3")).toBe(
      "2c3e4ea0-0265-80c8-8670-c7f63e97b0e3"
    );
  });
});
