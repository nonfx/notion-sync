/**
 * Convert Notion rich text to markdown
 */

import type { RichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";

export type RichText = RichTextItemResponse;

/**
 * Convert an array of rich text items to markdown string
 */
export function richTextToMarkdown(richText: RichText[]): string {
  return richText.map(renderRichTextItem).join("");
}

/**
 * Convert a single rich text item to markdown
 */
function renderRichTextItem(item: RichText): string {
  let text = item.plain_text;

  // Handle annotations (bold, italic, strikethrough, underline, code)
  const { annotations } = item;

  if (annotations.code) {
    text = `\`${text}\``;
  }

  if (annotations.bold) {
    text = `**${text}**`;
  }

  if (annotations.italic) {
    text = `*${text}*`;
  }

  if (annotations.strikethrough) {
    text = `~~${text}~~`;
  }

  // Underline has no standard markdown - skip or use HTML
  // if (annotations.underline) {
  //   text = `<u>${text}</u>`;
  // }

  // Handle links
  if (item.type === "text" && item.text.link) {
    text = `[${text}](${item.text.link.url})`;
  }

  // Handle mentions
  if (item.type === "mention") {
    const mention = item.mention;
    if (mention.type === "page") {
      // Will be resolved later with link resolver
      text = `[${text}](notion://${mention.page.id})`;
    } else if (mention.type === "user") {
      text = `@${text}`;
    } else if (mention.type === "date") {
      text = mention.date.start;
      if (mention.date.end) {
        text += ` → ${mention.date.end}`;
      }
    }
  }

  // Handle equations
  if (item.type === "equation") {
    text = `$${item.equation.expression}$`;
  }

  return text;
}

/**
 * Get plain text from rich text array (no formatting)
 */
export function richTextToPlain(richText: RichText[]): string {
  return richText.map((item) => item.plain_text).join("");
}
