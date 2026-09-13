import { describe, expect, it } from "bun:test";
import { pageToMarkdown } from "../page.ts";
import { parseMarkdownFile } from "../frontmatter.ts";

const values = [
  String.raw`A backslash before a quote: \" and a trailing slash: ` + "\\",
  String.raw`C:\notes\new and literal \n, \t, \u0041`,
  "Actual controls: \n\r\t\b\f\u0000\u001f",
  'Quote injection: \\"\nadmin: true\n---\nChanged body',
  'Commas, "quoted, commas", and apostrophes: can\'t',
  "Unicode: café 日本語 😀",
];

describe("exported frontmatter strings", () => {
  for (const [index, value] of values.entries()) {
    it(`preserves case ${index + 1} in a YAML parser and the import parser`, () => {
      const { content } = pageToMarkdown(
        {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          title: value,
          lastEditedTime: "2026-09-13T00:00:00.000Z",
          children: [],
          blocks: [],
          properties: { Description: value, Tags: [value, "second, item", ""] },
        },
        { includeTitle: false }
      );
      const frontmatter = /^---\n([\s\S]*?)\n---$/m.exec(content)?.[1];
      expect(frontmatter).toBeDefined();
      expect(Bun.YAML.parse(frontmatter!)).toEqual({
        notion_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        title: value,
        last_edited: "2026-09-13T00:00:00.000Z",
        description: value,
        tags: [value, "second, item", ""],
      });
      const imported = parseMarkdownFile(content);
      expect(imported.title).toBe(value);
      expect(imported.frontmatter).toEqual({
        description: value,
        tags: [value, "second, item", ""],
      });
    });
  }
});
