/**
 * Convert Notion blocks to markdown
 */

import type { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import type { UnsupportedBlock } from "../notion/client.ts";
import type { PropertyValue } from "../notion/tree.ts";
import { richTextToMarkdown, richTextToPlain } from "./rich-text.ts";

// Extended block type with children attached during fetch
export type NotionBlock = (BlockObjectResponse | UnsupportedBlock) & { children?: NotionBlock[] };

/**
 * Database entry info for rendering inline database tables
 */
export interface DatabaseEntry {
  id: string;
  title: string;
  properties: Record<string, PropertyValue>;
}

/**
 * Context for block rendering - provides access to database entries
 */
export interface RenderContext {
  /** Map of database ID -> entries (child pages with their properties) */
  databases: Map<string, DatabaseEntry[]>;
}

/**
 * Convert a single block to markdown
 */
export function blockToMarkdown(block: NotionBlock, indent = 0, context?: RenderContext): string {
  const prefix = "  ".repeat(indent);

  switch (block.type) {
    case "paragraph":
      return renderParagraph(block, prefix);

    case "heading_1":
      return `# ${richTextToMarkdown(block.heading_1.rich_text)}\n`;

    case "heading_2":
      return `## ${richTextToMarkdown(block.heading_2.rich_text)}\n`;

    case "heading_3":
      return `### ${richTextToMarkdown(block.heading_3.rich_text)}\n`;

    case "bulleted_list_item":
      return renderBulletedListItem(block, prefix);

    case "numbered_list_item":
      return renderNumberedListItem(block, prefix);

    case "to_do":
      return renderTodo(block, prefix);

    case "toggle":
      return renderToggle(block, prefix);

    case "code":
      return renderCodeBlock(block);

    case "quote":
      return renderQuote(block, prefix);

    case "callout":
      return renderCallout(block);

    case "divider":
      return "---\n";

    case "table":
      return renderTable(block);

    case "image":
      return renderImage(block);

    case "video":
      return renderVideo(block);

    case "file":
      return renderFile(block);

    case "pdf":
      return renderPdf(block);

    case "bookmark":
      return renderBookmark(block);

    case "embed":
      return renderEmbed(block);

    case "link_preview":
      return renderLinkPreview(block);

    case "equation":
      return `$$\n${block.equation.expression}\n$$\n`;

    case "table_of_contents":
      return "<!-- Table of Contents -->\n";

    case "breadcrumb":
      return ""; // Skip breadcrumbs

    case "column_list":
      return renderColumnList(block);

    case "column":
      return renderChildren(block.children, indent);

    case "synced_block":
      return renderChildren(block.children, indent);

    case "child_page":
      return `[${block.child_page.title}](notion://${block.id})\n`;

    case "child_database":
      return renderChildDatabase(block, context);

    case "link_to_page":
      return renderLinkToPage(block);

    case "template":
      return `<!-- Unsupported block type: ${block.type} -->\n`;

    case "unsupported":
      return renderUnsupportedNotionBlock(block);

    case "api_unsupported":
      return renderApiUnsupported(block as unknown as UnsupportedBlock);

    default: {
      // Handle unofficial heading levels (h4-h6) that can exist as custom blocks
      const blockType = (block as NotionBlock).type as string;
      const blockData = block as Record<string, unknown>;

      if (blockType === "heading_4" && blockData["heading_4"]) {
        const h4 = blockData["heading_4"] as {
          rich_text: Parameters<typeof richTextToMarkdown>[0];
        };
        return `#### ${richTextToMarkdown(h4.rich_text)}\n`;
      }
      if (blockType === "heading_5" && blockData["heading_5"]) {
        const h5 = blockData["heading_5"] as {
          rich_text: Parameters<typeof richTextToMarkdown>[0];
        };
        return `##### ${richTextToMarkdown(h5.rich_text)}\n`;
      }
      if (blockType === "heading_6" && blockData["heading_6"]) {
        const h6 = blockData["heading_6"] as {
          rich_text: Parameters<typeof richTextToMarkdown>[0];
        };
        return `###### ${richTextToMarkdown(h6.rich_text)}\n`;
      }

      return `<!-- Unknown block type: ${blockType} -->\n`;
    }
  }
}

/**
 * Convert array of blocks to markdown
 */
export function blocksToMarkdown(
  blocks: NotionBlock[] | null | undefined,
  context?: RenderContext
): string {
  if (!blocks || blocks.length === 0) return "";

  const lines: string[] = [];
  let prevType: string | null = null;

  for (const block of blocks) {
    // Add blank line between different block types (except consecutive list items)
    const isListItem = ["bulleted_list_item", "numbered_list_item", "to_do"].includes(block.type);
    const prevWasListItem =
      prevType && ["bulleted_list_item", "numbered_list_item", "to_do"].includes(prevType);

    if (prevType && !(isListItem && prevWasListItem)) {
      lines.push("");
    }

    // blockToMarkdown returns content ending with \n, trim it since we join with \n
    const content = blockToMarkdown(block, 0, context).replace(/\n$/, "");
    lines.push(content);
    prevType = block.type;
  }

  return lines.join("\n") + "\n";
}

// --- Block Renderers ---

function renderParagraph(block: NotionBlock & { type: "paragraph" }, prefix: string): string {
  const text = richTextToMarkdown(block.paragraph.rich_text);
  if (!text) return "";

  let result = `${prefix}${text}\n`;

  if (block.children) {
    result += renderChildren(block.children, prefix.length / 2 + 1);
  }

  return result;
}

function renderBulletedListItem(
  block: NotionBlock & { type: "bulleted_list_item" },
  prefix: string
): string {
  const text = richTextToMarkdown(block.bulleted_list_item.rich_text);
  let result = `${prefix}- ${text}\n`;

  if (block.children) {
    result += renderChildren(block.children, prefix.length / 2 + 1);
  }

  return result;
}

function renderNumberedListItem(
  block: NotionBlock & { type: "numbered_list_item" },
  prefix: string
): string {
  const text = richTextToMarkdown(block.numbered_list_item.rich_text);
  let result = `${prefix}1. ${text}\n`;

  if (block.children) {
    result += renderChildren(block.children, prefix.length / 2 + 1);
  }

  return result;
}

function renderTodo(block: NotionBlock & { type: "to_do" }, prefix: string): string {
  const checked = block.to_do.checked ? "x" : " ";
  const text = richTextToMarkdown(block.to_do.rich_text);
  let result = `${prefix}- [${checked}] ${text}\n`;

  if (block.children) {
    result += renderChildren(block.children, prefix.length / 2 + 1);
  }

  return result;
}

function renderToggle(block: NotionBlock & { type: "toggle" }, prefix: string): string {
  const summary = richTextToMarkdown(block.toggle.rich_text);
  let result = `${prefix}<details>\n${prefix}<summary>${summary}</summary>\n\n`;

  if (block.children) {
    result += renderChildren(block.children, prefix.length / 2);
  }

  result += `${prefix}</details>\n`;
  return result;
}

function renderCodeBlock(block: NotionBlock & { type: "code" }): string {
  const language = block.code.language || "";
  const code = richTextToPlain(block.code.rich_text);
  const caption = block.code.caption ? richTextToPlain(block.code.caption) : "";

  let result = `\`\`\`${language}\n${code}\n\`\`\`\n`;

  if (caption) {
    result += `*${caption}*\n`;
  }

  return result;
}

function renderQuote(block: NotionBlock & { type: "quote" }, prefix: string): string {
  const text = richTextToMarkdown(block.quote.rich_text);
  const lines = text.split("\n").map((line) => `${prefix}> ${line}`);
  let result = lines.join("\n") + "\n";

  if (block.children) {
    const childContent = renderChildren(block.children, 0);
    result += childContent
      .split("\n")
      .map((line) => `${prefix}> ${line}`)
      .join("\n");
  }

  return result;
}

function renderCallout(block: NotionBlock & { type: "callout" }): string {
  const icon = block.callout.icon;
  let emoji = "";

  if (icon?.type === "emoji") {
    emoji = icon.emoji + " ";
  }

  const text = richTextToMarkdown(block.callout.rich_text);
  let result = `> ${emoji}${text}\n`;

  if (block.children) {
    const childContent = renderChildren(block.children, 0);
    result += childContent
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }

  return result;
}

function renderTable(block: NotionBlock & { type: "table" }): string {
  if (!block.children) return "";

  const rows = block.children as (NotionBlock & { type: "table_row" })[];
  if (rows.length === 0) return "";

  const lines: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row?.type !== "table_row") continue;

    const cells = row.table_row.cells.map((cell) => richTextToMarkdown(cell));
    lines.push(`| ${cells.join(" | ")} |`);

    // Add header separator after first row
    if (i === 0) {
      const separator = cells.map(() => "---");
      lines.push(`| ${separator.join(" | ")} |`);
    }
  }

  return lines.join("\n") + "\n";
}

function renderImage(block: NotionBlock & { type: "image" }): string {
  const image = block.image;
  const url = image.type === "external" ? image.external.url : image.file.url;
  const caption = image.caption ? richTextToPlain(image.caption) : "image";

  return `![${caption}](${url})\n`;
}

function renderVideo(block: NotionBlock & { type: "video" }): string {
  const video = block.video;
  const url = video.type === "external" ? video.external.url : video.file.url;
  const caption = video.caption ? richTextToPlain(video.caption) : "Video";

  return `[${caption}](${url})\n`;
}

function renderFile(block: NotionBlock & { type: "file" }): string {
  const file = block.file;
  const url = file.type === "external" ? file.external.url : file.file.url;
  const caption = file.caption ? richTextToPlain(file.caption) : "File";

  return `[${caption}](${url})\n`;
}

function renderPdf(block: NotionBlock & { type: "pdf" }): string {
  const pdf = block.pdf;
  const url = pdf.type === "external" ? pdf.external.url : pdf.file.url;
  const caption = pdf.caption ? richTextToPlain(pdf.caption) : "PDF";

  return `[${caption}](${url})\n`;
}

function renderBookmark(block: NotionBlock & { type: "bookmark" }): string {
  const caption = block.bookmark.caption
    ? richTextToPlain(block.bookmark.caption)
    : block.bookmark.url;

  return `[${caption}](${block.bookmark.url})\n`;
}

function renderEmbed(block: NotionBlock & { type: "embed" }): string {
  const caption = block.embed.caption ? richTextToPlain(block.embed.caption) : block.embed.url;

  return `[${caption}](${block.embed.url})\n`;
}

function renderLinkPreview(block: NotionBlock & { type: "link_preview" }): string {
  return `[${block.link_preview.url}](${block.link_preview.url})\n`;
}

function renderColumnList(block: NotionBlock & { type: "column_list" }): string {
  if (!block.children) return "";

  // Render columns side by side isn't really possible in markdown
  // Just render them sequentially
  return renderChildren(block.children, 0);
}

function renderLinkToPage(block: NotionBlock & { type: "link_to_page" }): string {
  const link = block.link_to_page;
  if (link.type === "page_id") {
    return `[Page](notion://${link.page_id})\n`;
  } else if (link.type === "database_id") {
    return `[Database](notion://${link.database_id})\n`;
  }
  return "";
}

/**
 * Render a child_database block as a markdown table
 * Shows database title and entries with their properties
 */
function renderChildDatabase(
  block: NotionBlock & { type: "child_database" },
  context?: RenderContext
): string {
  const title = block.child_database.title;
  const dbId = block.id;

  // Get database entries from context
  const entries = context?.databases.get(dbId) || context?.databases.get(dbId.replace(/-/g, ""));

  // If no entries data, fall back to a link
  if (!entries || entries.length === 0) {
    return `**${title}**\n\n[View database](notion://${dbId})\n`;
  }

  // Build table from entries
  const lines: string[] = [];

  // Add database title as heading
  lines.push(`**${title}**\n`);

  // Collect all property keys from entries (excluding title which is separate)
  const propertyKeys = new Set<string>();
  for (const entry of entries) {
    for (const key of Object.keys(entry.properties)) {
      propertyKeys.add(key);
    }
  }

  // Build header row: Title + other properties (limit to first 3 properties to keep table readable)
  const displayKeys = Array.from(propertyKeys).slice(0, 3);
  const headers = ["Page", ...displayKeys];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

  // Build data rows
  for (const entry of entries) {
    const cells: string[] = [`[${escapeTableCell(entry.title)}](notion://${entry.id})`];

    for (const key of displayKeys) {
      const value = entry.properties[key];
      cells.push(escapeTableCell(formatPropertyValue(value)));
    }

    lines.push(`| ${cells.join(" | ")} |`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Format a property value for display in table cell
 */
function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * Escape special characters in table cells
 */
function escapeTableCell(text: string): string {
  // Escape backslashes first so we don't double-escape the ones we add below.
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function renderChildren(children: NotionBlock[] | undefined, indent: number): string {
  if (!children) return "";

  return children.map((child) => blockToMarkdown(child, indent)).join("");
}

/**
 * Render API-unsupported blocks as visible HTML
 * This preserves the block's existence and metadata for potential future sync
 */
function renderApiUnsupported(block: UnsupportedBlock): string {
  const { message, block_id } = block.api_unsupported;

  // Extract block type from error message if possible (e.g., "ai_block")
  const typeMatch = message.match(/Block type (\w+) is not supported/);
  const blockType = typeMatch ? typeMatch[1] : "unknown";

  return `<div class="notion-unsupported" data-block-id="${block_id}" data-block-type="${blockType}">
  <em>⚠️ Unsupported Notion block: ${blockType}</em>
</div>\n`;
}

/**
 * Render Notion's "unsupported" block type
 * These are blocks the API returns but doesn't fully support
 * We still try to render children if they exist
 */
function renderUnsupportedNotionBlock(block: NotionBlock): string {
  let result = `<div class="notion-unsupported" data-block-id="${block.id}" data-block-type="unsupported">
  <em>⚠️ Unsupported Notion block</em>
</div>\n`;

  // Render children if they exist (they might contain useful content or placeholders)
  if (block.children && block.children.length > 0) {
    result += renderChildren(block.children, 0);
  }

  return result;
}
