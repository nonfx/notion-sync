/**
 * Resolve Notion links to local markdown paths
 */

import { relative, dirname } from "node:path";

/** Map of Notion page/database ID -> relative file path */
export type LinkMap = Map<string, string>;

/**
 * Resolve notion:// URLs in markdown content to relative local paths
 *
 * @param content - Markdown content with notion:// URLs
 * @param currentFilePath - Path of the current file (relative to output dir)
 * @param linkMap - Map of Notion IDs to file paths
 * @param outLinkedIds - When provided, collects the normalized ID of every
 *   notion:// link encountered (resolved or not). Incremental sync stores
 *   these so a page can be re-rendered when a link target's path changes.
 * @returns Content with resolved links
 */
export function resolveNotionLinks(
  content: string,
  currentFilePath: string,
  linkMap: LinkMap,
  outLinkedIds?: Set<string>
): string {
  // Match notion:// URLs (with or without dashes in UUID)
  // Format: notion://uuid or notion://uuid-with-dashes
  const notionUrlPattern = /notion:\/\/([a-f0-9-]+)/gi;

  return content.replace(notionUrlPattern, (match, notionId) => {
    // Normalize ID (remove dashes for lookup)
    const normalizedId = notionId.replace(/-/g, "");
    outLinkedIds?.add(normalizedId);

    // Try both formats
    let targetPath = linkMap.get(notionId) || linkMap.get(normalizedId);

    if (!targetPath) {
      // Link to unknown page - keep original URL as comment
      return match;
    }

    // Calculate relative path from current file to target
    const currentDir = dirname(currentFilePath);
    const relativePath = relative(currentDir, targetPath);

    // Use ./ prefix for same directory, otherwise the relative path
    return relativePath.startsWith("..") ? relativePath : "./" + relativePath;
  });
}
