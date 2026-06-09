/**
 * Parse markdown into Notion block request objects.
 *
 * This is the reverse of `blocks.ts` (which renders Notion blocks to markdown).
 * It focuses on the constructs this tool emits when syncing Notion → markdown,
 * plus the common subset of hand-authored markdown, so that a markdown tree can
 * be pushed back up to Notion.
 *
 * Block types supported: headings (1-3), paragraphs, bulleted/numbered lists,
 * to-do items (with nesting), code blocks, blockquotes, dividers, tables,
 * images, and toggles (<details>). Unsupported HTML (e.g. notion-unsupported
 * placeholders) is skipped so it round-trips without crashing.
 */

import { parseInline, type RichTextRequest } from "./inline.ts";

/**
 * A Notion block in *request* format. Intentionally permissive — we cast to
 * the SDK's `BlockObjectRequest` at the API boundary.
 */
export interface BlockRequest {
  object?: "block";
  type: string;
  children?: BlockRequest[];
  // The per-type payload (e.g. `paragraph`, `heading_1`) lives under a dynamic
  // key. Typed as unknown; constructed via helpers below.
  [key: string]: unknown;
}

const VALID_LANGUAGES = new Set([
  "abap",
  "agda",
  "arduino",
  "ascii art",
  "assembly",
  "bash",
  "basic",
  "bnf",
  "c",
  "c#",
  "c++",
  "clojure",
  "coffeescript",
  "coq",
  "css",
  "dart",
  "dhall",
  "diff",
  "docker",
  "ebnf",
  "elixir",
  "elm",
  "erlang",
  "f#",
  "flow",
  "fortran",
  "gherkin",
  "glsl",
  "go",
  "graphql",
  "groovy",
  "haskell",
  "hcl",
  "html",
  "idris",
  "java",
  "javascript",
  "json",
  "julia",
  "kotlin",
  "latex",
  "less",
  "lisp",
  "livescript",
  "llvm ir",
  "lua",
  "makefile",
  "markdown",
  "markup",
  "matlab",
  "mathematica",
  "mermaid",
  "nix",
  "notion formula",
  "objective-c",
  "ocaml",
  "pascal",
  "perl",
  "php",
  "plain text",
  "powershell",
  "prolog",
  "protobuf",
  "purescript",
  "python",
  "r",
  "racket",
  "reason",
  "ruby",
  "rust",
  "sass",
  "scala",
  "scheme",
  "scss",
  "shell",
  "smalltalk",
  "solidity",
  "sql",
  "swift",
  "toml",
  "typescript",
  "vb.net",
  "verilog",
  "vhdl",
  "visual basic",
  "webassembly",
  "xml",
  "yaml",
  "java/c/c++/c#",
]);

function normalizeLanguage(lang: string): string {
  const lower = lang.trim().toLowerCase();
  if (!lower) return "plain text";
  if (VALID_LANGUAGES.has(lower)) return lower;
  // Common aliases the renderer might emit.
  const aliases: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    sh: "shell",
    yml: "yaml",
    text: "plain text",
    plaintext: "plain text",
  };
  return aliases[lower] ?? "plain text";
}

function paragraph(richText: RichTextRequest[]): BlockRequest {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText } };
}

function indentOf(line: string): number {
  const match = /^(\s*)/.exec(line);
  return match ? match[1]!.replace(/\t/g, "  ").length : 0;
}

const LIST_RE = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;

function isListLine(line: string): boolean {
  return LIST_RE.test(line);
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?$/.test(t);
}

/** Does this line begin a non-paragraph block? Used to terminate paragraphs. */
function isBlockBoundary(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  if (t.startsWith("```")) return true;
  if (t.startsWith(">")) return true;
  if (t.startsWith("#") && /^#{1,6}\s+/.test(t)) return true;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return true;
  if (isListLine(line)) return true;
  if (t.startsWith("<details>") || t.startsWith("<!--")) return true;
  if (t.startsWith('<div class="notion-unsupported"')) return true;
  return false;
}

/**
 * Parse a markdown document body into Notion block requests.
 */
export function parseMarkdownBlocks(markdown: string): BlockRequest[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  return parseBlocks(lines);
}

function parseBlocks(lines: string[]): BlockRequest[] {
  const blocks: BlockRequest[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    // HTML comments (e.g. the generated-file header).
    if (trimmed.startsWith("<!--")) {
      while (i < lines.length && !lines[i]!.includes("-->")) i++;
      i++;
      continue;
    }

    // Unsupported-block placeholders cannot be recreated — skip them.
    if (trimmed.startsWith('<div class="notion-unsupported"')) {
      while (i < lines.length && !lines[i]!.includes("</div>")) i++;
      i++;
      continue;
    }

    // Toggle (<details>).
    if (trimmed.startsWith("<details>")) {
      const result = parseDetails(lines, i);
      blocks.push(result.block);
      i = result.next;
      continue;
    }

    // Fenced code block.
    if (trimmed.startsWith("```")) {
      const result = parseCode(lines, i);
      blocks.push(result.block);
      i = result.next;
      continue;
    }

    // Divider.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      i++;
      continue;
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(heading[1]!.length, 3);
      const type = `heading_${level}`;
      blocks.push({
        object: "block",
        type,
        [type]: { rich_text: parseInline(heading[2]!.trim()) },
      });
      i++;
      continue;
    }

    // Blockquote (consecutive `>` lines).
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) {
        quoteLines.push(lines[i]!.trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({
        object: "block",
        type: "quote",
        quote: { rich_text: parseInline(quoteLines.join("\n")) },
      });
      continue;
    }

    // GFM table (header row followed by a separator row).
    if (trimmed.startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      const result = parseTable(lines, i);
      blocks.push(result.block);
      i = result.next;
      continue;
    }

    // Lists (with nested children by indentation).
    if (isListLine(line)) {
      const result = parseList(lines, i, indentOf(line));
      blocks.push(...result.blocks);
      i = result.next;
      continue;
    }

    // Standalone image.
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (image) {
      const url = image[2]!;
      if (!url.startsWith("notion://") && /^https?:\/\//.test(url)) {
        blocks.push({
          object: "block",
          type: "image",
          image: { type: "external", external: { url } },
        });
        i++;
        continue;
      }
      // Notion-hosted or relative image — can't re-upload; keep as a paragraph.
    }

    // Paragraph: gather consecutive plain lines.
    const paraLines: string[] = [trimmed];
    i++;
    while (i < lines.length && !isBlockBoundary(lines[i]!)) {
      paraLines.push(lines[i]!.trim());
      i++;
    }
    blocks.push(paragraph(parseInline(paraLines.join("\n"))));
  }

  return blocks;
}

function parseListItem(line: string): BlockRequest {
  const match = LIST_RE.exec(line)!;
  const numbered = match[3] !== undefined;
  const content = match[4] ?? "";

  const todo = /^\[([ xX])\]\s+(.*)$/.exec(content);
  if (!numbered && todo) {
    return {
      object: "block",
      type: "to_do",
      to_do: {
        rich_text: parseInline(todo[2]!),
        checked: todo[1]!.toLowerCase() === "x",
      },
    };
  }

  const type = numbered ? "numbered_list_item" : "bulleted_list_item";
  return {
    object: "block",
    type,
    [type]: { rich_text: parseInline(content) },
  };
}

function parseList(
  lines: string[],
  start: number,
  baseIndent: number
): { blocks: BlockRequest[]; next: number } {
  const blocks: BlockRequest[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "" || !isListLine(line)) break;

    const indent = indentOf(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) break; // belongs to a parent item's children

    const item = parseListItem(line);
    i++;

    // Gather indented continuation lines as this item's children.
    const childLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && indentOf(lines[i]!) > baseIndent) {
      childLines.push(lines[i]!);
      i++;
    }

    if (childLines.length > 0) {
      const childMinIndent = Math.min(...childLines.map(indentOf));
      const dedented = childLines.map((l) => l.slice(childMinIndent));
      const childBlocks = parseBlocks(dedented);
      if (childBlocks.length > 0) item.children = childBlocks;
    }

    blocks.push(item);
  }

  return { blocks, next: i };
}

function parseCode(lines: string[], start: number): { block: BlockRequest; next: number } {
  const fence = lines[start]!.trim();
  const language = normalizeLanguage(fence.replace(/^```/, ""));
  const codeLines: string[] = [];

  let i = start + 1;
  while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
    codeLines.push(lines[i]!);
    i++;
  }
  i++; // consume closing fence

  // An italic-only line immediately after a code block is treated as its
  // caption (this is how the renderer emits code captions).
  let caption: RichTextRequest[] | undefined;
  if (i < lines.length) {
    const captionMatch = /^\*([^*].*?)\*$/.exec(lines[i]!.trim());
    if (captionMatch) {
      caption = parseInline(captionMatch[1]!);
      i++;
    }
  }

  const code: { rich_text: RichTextRequest[]; language: string; caption?: RichTextRequest[] } = {
    rich_text: [{ type: "text", text: { content: codeLines.join("\n") } }],
    language,
  };
  if (caption) code.caption = caption;

  return { block: { object: "block", type: "code", code }, next: i };
}

function parseTable(lines: string[], start: number): { block: BlockRequest; next: number } {
  const rows: RichTextRequest[][][] = [];
  let i = start;

  const parseRow = (line: string): RichTextRequest[][] => {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((cell) => parseInline(cell.trim()));
  };

  // Header row.
  rows.push(parseRow(lines[i]!));
  i++;
  // Separator row.
  i++;
  // Data rows.
  while (i < lines.length && lines[i]!.trim().startsWith("|")) {
    rows.push(parseRow(lines[i]!));
    i++;
  }

  const width = Math.max(...rows.map((r) => r.length));
  // Pad rows to a uniform width (Notion requires equal-width rows).
  const children = rows.map((cells) => {
    const padded = [...cells];
    while (padded.length < width) padded.push([]);
    return { object: "block", type: "table_row", table_row: { cells: padded } };
  });

  const block: BlockRequest = {
    object: "block",
    type: "table",
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children,
    },
  };

  return { block, next: i };
}

function parseDetails(lines: string[], start: number): { block: BlockRequest; next: number } {
  // Collect lines until the matching </details>.
  const inner: string[] = [];
  let summary = "";
  let i = start;

  // The opening line may contain the summary inline.
  const firstLine = lines[i]!.trim();
  const inlineSummary = /<summary>(.*?)<\/summary>/.exec(firstLine);
  if (inlineSummary) summary = inlineSummary[1]!;
  i++;

  while (i < lines.length && !lines[i]!.trim().startsWith("</details>")) {
    const line = lines[i]!;
    const summaryMatch = /<summary>(.*?)<\/summary>/.exec(line.trim());
    if (!summary && summaryMatch) {
      summary = summaryMatch[1]!;
    } else if (!line.trim().startsWith("<summary>")) {
      inner.push(line);
    }
    i++;
  }
  i++; // consume </details>

  const children = parseBlocks(inner);
  const block: BlockRequest = {
    object: "block",
    type: "toggle",
    toggle: { rich_text: parseInline(summary) },
  };
  if (children.length > 0) block.children = children;

  return { block, next: i };
}
