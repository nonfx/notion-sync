/**
 * Markdown conversion module
 */

export { richTextToMarkdown, richTextToPlain } from "./rich-text.ts";
export {
  blockToMarkdown,
  blocksToMarkdown,
  type NotionBlock,
  type RenderContext,
  type DatabaseEntry,
} from "./blocks.ts";
export { pageToMarkdown, slugify, uniqueFilename, type PageMarkdown } from "./page.ts";
export { writePageTree, writeSinglePage, type WriteResult } from "./writer.ts";
export { resolveNotionLinks, type LinkMap } from "./links.ts";

// Reverse direction (markdown -> Notion): parsing for two-way sync.
export {
  parseInline,
  normalizeNotionId,
  type RichTextRequest,
  type Annotations,
} from "./inline.ts";
export { parseMarkdownBlocks, type BlockRequest } from "./parser.ts";
export { parseMarkdownFile, type ParsedMarkdown } from "./frontmatter.ts";
