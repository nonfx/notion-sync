/**
 * Parse a markdown file into its frontmatter metadata and content body.
 *
 * Understands the frontmatter this tool writes (notion_id, title, ...) as well
 * as hand-authored files with or without frontmatter. The returned `body` has
 * the generated-file header comment, the YAML frontmatter, and a leading H1
 * title removed (since the title becomes the Notion page title, not a block).
 */

export interface ParsedMarkdown {
  /** Page title (from frontmatter `title`, else first H1, else null) */
  title: string | null;
  /** Notion page id from frontmatter `notion_id`, if present */
  notionId: string | null;
  /** Remaining frontmatter key/value pairs */
  frontmatter: Record<string, string | string[]>;
  /** Markdown body with frontmatter, generated header, and title H1 stripped */
  body: string;
}

const GENERATED_HEADER_RE = /^<!--[\s\S]*?-->\s*/;

export function parseMarkdownFile(raw: string): ParsedMarkdown {
  let content = raw.replace(/^﻿/, ""); // strip BOM

  // Strip a leading generated-header HTML comment, if any.
  content = content.replace(/^\s*/, "");
  if (content.startsWith("<!--")) {
    content = content.replace(GENERATED_HEADER_RE, "");
  }

  const { frontmatter, rest } = extractFrontmatter(content);

  const fmTitle =
    typeof frontmatter["title"] === "string" ? (frontmatter["title"] as string) : null;
  const notionId =
    typeof frontmatter["notion_id"] === "string" ? (frontmatter["notion_id"] as string) : null;

  // Remove the keys we surface explicitly so callers see only "extra" metadata.
  const extra: Record<string, string | string[]> = { ...frontmatter };
  delete extra["title"];
  delete extra["notion_id"];
  delete extra["last_edited"];

  let body = rest;
  let title = fmTitle;

  // Pull the first H1 out of the body. If we don't yet have a title, use it.
  const h1 = /^\s*#\s+(.+?)\s*$/m.exec(body);
  if (h1) {
    const h1Text = h1[1]!.trim();
    const isLeading = body.slice(0, h1.index).trim() === "";
    if (!title) title = h1Text;
    // Strip the H1 only when it's the leading line (so it isn't duplicated as a
    // content block — the title lives on the page itself).
    if (isLeading && (fmTitle === null || fmTitle === h1Text || title === h1Text)) {
      body = body.slice(0, h1.index) + body.slice(h1.index + h1[0].length);
    }
  }

  return {
    title,
    notionId,
    frontmatter: extra,
    body: body.replace(/^\s+/, "").replace(/\s+$/, "") + "\n",
  };
}

function extractFrontmatter(content: string): {
  frontmatter: Record<string, string | string[]>;
  rest: string;
} {
  const frontmatter: Record<string, string | string[]> = {};

  if (!content.startsWith("---")) {
    return { frontmatter, rest: content };
  }

  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!match) {
    return { frontmatter, rest: content };
  }

  const block = match[1]!;
  for (const line of block.split("\n")) {
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    frontmatter[key] = parseValue(kv[2]!.trim());
  }

  return { frontmatter, rest: content.slice(match[0].length) };
}

function parseValue(value: string): string | string[] {
  // Array: ["a", "b"]
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => unquote(item.trim()));
  }
  return unquote(value);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }
  return value;
}

const LEADING_HEADER_RE = /^\s*<!--[\s\S]*?-->\s*\n?/;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Insert or update top-level frontmatter keys in a markdown file, preserving
 * the generated-header comment, any other frontmatter, and the body.
 *
 * Values are written verbatim (the caller formats them — e.g. quote strings).
 * Used by `push` to stamp `notion_id` back into newly-created files so a later
 * sync recognises them and stays idempotent instead of creating duplicates.
 */
export function upsertFrontmatter(raw: string, updates: Record<string, string>): string {
  const content = raw.replace(/^﻿/, ""); // strip BOM

  // Preserve a leading generated-header comment, if present.
  let header = "";
  let rest = content;
  const headerMatch = LEADING_HEADER_RE.exec(content);
  if (headerMatch && content.trimStart().startsWith("<!--")) {
    header = content.slice(0, headerMatch[0].length);
    rest = content.slice(headerMatch[0].length);
  }

  const keys = Object.keys(updates);
  const fmMatch = FRONTMATTER_RE.exec(rest);

  if (fmMatch) {
    const seen = new Set<string>();
    const lines = fmMatch[1]!.split("\n").map((line) => {
      const kv = /^([\w-]+)\s*:/.exec(line);
      if (kv && updates[kv[1]!] !== undefined) {
        seen.add(kv[1]!);
        return `${kv[1]}: ${updates[kv[1]!]}`;
      }
      return line;
    });
    for (const key of keys) {
      if (!seen.has(key)) lines.push(`${key}: ${updates[key]}`);
    }
    const body = rest.slice(fmMatch[0].length);
    return `${header}---\n${lines.join("\n")}\n---\n${body}`;
  }

  // No frontmatter yet — create one ahead of the body.
  const fmLines = keys.map((key) => `${key}: ${updates[key]}`);
  const body = rest.replace(/^\n+/, "");
  return `${header}---\n${fmLines.join("\n")}\n---\n\n${body}`;
}
