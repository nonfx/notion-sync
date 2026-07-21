/**
 * Selector matching with precedence and include-override traversal hints.
 */

import { normalizeNotionId, type ParsedSelector } from "./schema.ts";
import type { EffectiveSelectors } from "./load.ts";

/** Node metadata available before child fetch during tree build */
export interface SelectorNode {
  id: string;
  /** Title segments from source root through this node (inclusive) */
  titlePath: string[];
}

/** Result of applying selector precedence to one node */
export type SelectorDecision = "include" | "exclude";

interface PartitionedSelectors {
  includeIds: ParsedSelector[];
  excludeIds: ParsedSelector[];
  includeGlobs: ParsedSelector[];
  excludeGlobs: ParsedSelector[];
  defaultExcludeGlobs: ParsedSelector[];
}

/**
 * Split effective selectors by kind and origin for precedence evaluation.
 */
function partitionSelectors(selectors: EffectiveSelectors): PartitionedSelectors {
  const includeIds: ParsedSelector[] = [];
  const excludeIds: ParsedSelector[] = [];
  const includeGlobs: ParsedSelector[] = [];
  const excludeGlobs: ParsedSelector[] = [];

  for (const selector of selectors.include) {
    if (selector.kind === "id") {
      includeIds.push(selector);
    } else {
      includeGlobs.push(selector);
    }
  }

  for (const selector of selectors.exclude) {
    if (selector.kind === "id") {
      excludeIds.push(selector);
    } else {
      excludeGlobs.push(selector);
    }
  }

  return {
    includeIds,
    excludeIds,
    includeGlobs,
    excludeGlobs,
    defaultExcludeGlobs: selectors.defaultExclude,
  };
}

/**
 * Convert a title-path glob pattern into a RegExp.
 */
function globToRegExp(pattern: string): RegExp {
  let regex = "^";
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index]!;

    if (char === "*") {
      if (pattern[index + 1] === "*") {
        if (pattern[index + 2] === "/") {
          regex += "(?:.*/)?";
          index += 3;
          continue;
        }

        regex += ".*";
        index += 2;
        continue;
      }

      regex += "[^/]*";
      index += 1;
      continue;
    }

    if (char === "/" && pattern[index + 1] === "*" && pattern[index + 2] === "*") {
      const isTerminal = index + 3 >= pattern.length;
      regex += isTerminal ? "(?:/.*)?" : "(?:/.+)?";
      index += 3;
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      index += 1;
      continue;
    }

    if ("/\\^$+.|()[]{}".includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }

    index += 1;
  }

  regex += "$";
  return new RegExp(regex);
}

/**
 * Match a title-path glob against a slash-joined path string.
 */
export function matchGlob(pattern: string, titlePath: string[]): boolean {
  const path = titlePath.join("/");
  return globToRegExp(pattern).test(path);
}

/**
 * Apply selector precedence for one node.
 * explicit include ID > explicit exclude ID > include glob > exclude glob > defaultExclude glob > default include.
 */
export function resolveNodeDecision(node: SelectorNode, selectors: EffectiveSelectors): SelectorDecision {
  const partitioned = partitionSelectors(selectors);
  const normalizedId = normalizeNotionId(node.id);

  for (const selector of partitioned.includeIds) {
    if (selector.id === normalizedId) {
      return "include";
    }
  }

  for (const selector of partitioned.excludeIds) {
    if (selector.id === normalizedId) {
      return "exclude";
    }
  }

  for (const selector of partitioned.includeGlobs) {
    if (matchGlob(selector.raw, node.titlePath)) {
      return "include";
    }
  }

  for (const selector of partitioned.excludeGlobs) {
    if (matchGlob(selector.raw, node.titlePath)) {
      return "exclude";
    }
  }

  for (const selector of partitioned.defaultExcludeGlobs) {
    if (matchGlob(selector.raw, node.titlePath)) {
      return "exclude";
    }
  }

  return "include";
}

/**
 * Return true when an include glob could match a descendant under titlePath.
 */
export function globCouldMatchDescendant(pattern: string, titlePath: string[]): boolean {
  const prefix = titlePath.join("/");

  if (matchGlob(pattern, titlePath)) {
    return false;
  }

  if (pattern.startsWith(`${prefix}/`)) {
    return true;
  }

  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3);
    return (
      matchGlob(suffix, [...titlePath, "__child__"]) ||
      matchGlob(`**/${suffix}`, [...titlePath, "__child__"])
    );
  }

  return matchGlob(pattern, [...titlePath, "__child__"]);
}

/**
 * Return true when an excluded node may contain an explicitly included descendant.
 */
export function shouldTraverseExcludedNode(node: SelectorNode, selectors: EffectiveSelectors): boolean {
  const partitioned = partitionSelectors(selectors);

  if (partitioned.includeIds.length > 0) {
    return true;
  }

  for (const selector of partitioned.includeGlobs) {
    if (globCouldMatchDescendant(selector.raw, node.titlePath)) {
      return true;
    }
  }

  return false;
}

/**
 * Return true when child fetch should be skipped for this node.
 */
export function shouldPruneNode(node: SelectorNode, selectors: EffectiveSelectors): boolean {
  if (resolveNodeDecision(node, selectors) === "include") {
    return false;
  }

  return !shouldTraverseExcludedNode(node, selectors);
}
