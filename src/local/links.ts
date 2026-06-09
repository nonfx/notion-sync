/**
 * Resolve internal markdown links to `notion://<id>` references.
 *
 * This is the reverse of `markdown/links.ts` (which turns `notion://` URLs into
 * relative file paths). Given a map of file paths → Notion page ids, it rewrites
 * relative `.md` links in a document so they can be parsed into page mentions
 * when pushing content back to Notion. External links are left untouched.
 */

import { dirname, join, normalize } from "node:path";

/** Map of relative file path (POSIX-style) → Notion page id */
export type PathIdMap = Map<string, string>;

function toPosix(path: string): string {
  return path.split(/[\\/]/).join("/");
}

/**
 * Rewrite relative `.md` links in `body` to `notion://<id>` using `pathIdMap`.
 *
 * @param body           Markdown content
 * @param currentRelPath Path of the current file, relative to the scan root
 * @param pathIdMap      Map of relative file paths to Notion page ids
 */
export function resolveLocalLinks(
  body: string,
  currentRelPath: string,
  pathIdMap: PathIdMap
): string {
  const currentDir = dirname(currentRelPath);

  // Match markdown links whose target is a relative path (not a URL/anchor).
  const linkPattern = /\]\(([^)]+)\)/g;

  return body.replace(linkPattern, (match, rawUrl: string) => {
    const url = rawUrl.trim();

    // Leave absolute URLs, anchors, and already-notion links alone.
    if (/^[a-z]+:\/\//i.test(url) || url.startsWith("#") || url.startsWith("notion://")) {
      return match;
    }
    if (url.startsWith("mailto:")) return match;

    const [pathPart, anchor] = splitAnchor(url);
    if (!pathPart.toLowerCase().endsWith(".md")) return match;

    const resolved = toPosix(normalize(join(currentDir, pathPart)));
    const id = pathIdMap.get(resolved) ?? pathIdMap.get(stripLeadingDotSlash(resolved));
    if (!id) return match;

    const suffix = anchor ? `#${anchor}` : "";
    return `](notion://${id}${suffix})`;
  });
}

function splitAnchor(url: string): [string, string | null] {
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return [url, null];
  return [url.slice(0, hashIndex), url.slice(hashIndex + 1)];
}

function stripLeadingDotSlash(path: string): string {
  return path.replace(/^\.\//, "");
}
