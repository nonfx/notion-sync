/**
 * Parse inline markdown into Notion rich text request objects.
 *
 * This is the reverse of `rich-text.ts` (which renders Notion rich text to
 * markdown). It handles bold, italic, strikethrough, inline code, links,
 * inline equations, and `notion://` page mentions.
 */

/** Annotation flags applied to a span of text */
export interface Annotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
}

/**
 * A rich text item in Notion's *request* format (what the API accepts when
 * creating/updating blocks). Intentionally permissive — we cast to the SDK's
 * `RichTextItemRequest` at the API boundary.
 */
export interface RichTextRequest {
  type?: "text" | "mention" | "equation";
  text?: { content: string; link?: { url: string } | null };
  mention?: { page: { id: string } };
  equation?: { expression: string };
  annotations?: Annotations;
}

const NOTION_LINK_PREFIX = "notion://";

/**
 * Convert a string of inline markdown to an array of rich text request items.
 */
export function parseInline(input: string): RichTextRequest[] {
  if (!input) return [];
  return parseSegment(input, {});
}

function hasAnnotations(ann: Annotations): boolean {
  return Boolean(ann.bold || ann.italic || ann.strikethrough || ann.code);
}

function makeText(content: string, ann: Annotations, link?: string): RichTextRequest {
  const text: { content: string; link?: { url: string } | null } = { content };
  if (link) text.link = { url: link };
  const item: RichTextRequest = { type: "text", text };
  if (hasAnnotations(ann)) item.annotations = { ...ann };
  return item;
}

/**
 * Notion page IDs are 32 hex chars; the API prefers the dashed UUID form.
 * Add dashes when we get a bare 32-char id, otherwise pass through.
 */
export function normalizeNotionId(id: string): string {
  const bare = id.replace(/-/g, "");
  if (/^[0-9a-f]{32}$/i.test(bare)) {
    return `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}`;
  }
  return id;
}

function buildLink(label: string, url: string, ann: Annotations): RichTextRequest[] {
  if (url.startsWith(NOTION_LINK_PREFIX)) {
    // A page mention targets a page, not a heading anchor — strip any
    // `#anchor` (and query) so the id is a valid UUID.
    const raw = url.slice(NOTION_LINK_PREFIX.length).split(/[#?]/)[0]!;
    const id = normalizeNotionId(raw);
    const item: RichTextRequest = { type: "mention", mention: { page: { id } } };
    if (hasAnnotations(ann)) item.annotations = { ...ann };
    return [item];
  }

  // Regular link — parse the label for nested formatting and attach the URL
  // to each resulting text item.
  const inner = parseSegment(label, ann);
  if (inner.length === 0) return [makeText(label, ann, url)];

  for (const item of inner) {
    if (item.type !== "mention" && item.text) {
      item.text.link = { url };
    }
  }
  return inner;
}

/** Match `[label](url)` at the given position. */
function matchLink(
  text: string,
  start: number
): { label: string; url: string; end: number } | null {
  const match = /^\[([^\]]*)\]\(([^)]+)\)/.exec(text.slice(start));
  if (!match) return null;
  return { label: match[1] ?? "", url: match[2] ?? "", end: start + match[0].length };
}

/** Find the closing single `*`/`_` italic marker (not part of a `**`/`__`). */
function findItalicClose(text: string, from: number, marker: string): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] !== marker) continue;
    if (text[j + 1] === marker) {
      j++; // skip a doubled marker
      continue;
    }
    return j;
  }
  return -1;
}

function parseSegment(text: string, ann: Annotations): RichTextRequest[] {
  const out: RichTextRequest[] = [];
  let buf = "";
  let i = 0;

  const flush = (): void => {
    if (buf) {
      out.push(makeText(buf, ann));
      buf = "";
    }
  };

  while (i < text.length) {
    const ch = text[i]!;
    const rest = text.slice(i);

    // Inline code — content is literal, no further parsing.
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        out.push(makeText(text.slice(i + 1, end), { ...ann, code: true }));
        i = end + 1;
        continue;
      }
    }

    // Link or page mention.
    if (ch === "[") {
      const link = matchLink(text, i);
      if (link) {
        flush();
        out.push(...buildLink(link.label, link.url, ann));
        i = link.end;
        continue;
      }
    }

    // Bold + italic (*** or ___) — handle before bold so the triple marker
    // isn't mis-split into a bold open plus a stray italic marker.
    if (rest.startsWith("***") || rest.startsWith("___")) {
      const marker = rest.slice(0, 3);
      const end = text.indexOf(marker, i + 3);
      if (end !== -1) {
        flush();
        out.push(...parseSegment(text.slice(i + 3, end), { ...ann, bold: true, italic: true }));
        i = end + 3;
        continue;
      }
    }

    // Bold (** or __).
    if (rest.startsWith("**") || rest.startsWith("__")) {
      const marker = rest.slice(0, 2);
      const end = text.indexOf(marker, i + 2);
      if (end !== -1) {
        flush();
        out.push(...parseSegment(text.slice(i + 2, end), { ...ann, bold: true }));
        i = end + 2;
        continue;
      }
    }

    // Strikethrough (~~).
    if (rest.startsWith("~~")) {
      const end = text.indexOf("~~", i + 2);
      if (end !== -1) {
        flush();
        out.push(...parseSegment(text.slice(i + 2, end), { ...ann, strikethrough: true }));
        i = end + 2;
        continue;
      }
    }

    // Italic (* or _).
    if (ch === "*" || ch === "_") {
      const end = findItalicClose(text, i + 1, ch);
      if (end !== -1 && end > i + 1) {
        flush();
        out.push(...parseSegment(text.slice(i + 1, end), { ...ann, italic: true }));
        i = end + 1;
        continue;
      }
    }

    // Inline equation ($...$).
    if (ch === "$") {
      const end = text.indexOf("$", i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        const item: RichTextRequest = {
          type: "equation",
          equation: { expression: text.slice(i + 1, end) },
        };
        if (hasAnnotations(ann)) item.annotations = { ...ann };
        out.push(item);
        i = end + 1;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flush();
  return out;
}
