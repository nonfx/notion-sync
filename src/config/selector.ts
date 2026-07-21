/**
 * Selector matching with precedence and include-override traversal hints.
 */

import { normalizeNotionId, type DateFilterConfig, type ParsedSelector } from "./schema.ts";
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
 *
 * `ancestorExcluded` cascades an ancestor's exclusion down to descendants that don't
 * match any selector of their own, so traversing into an excluded parent to find one
 * buried keeper (include-override) doesn't accidentally sweep in its unrelated siblings.
 */
export function resolveNodeDecision(
  node: SelectorNode,
  selectors: EffectiveSelectors,
  ancestorExcluded = false
): SelectorDecision {
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

  return ancestorExcluded ? "exclude" : "include";
}

const MS_PER_DAY = 86_400_000;

/**
 * Inclusive calendar-day bound for `before` (end of the configured date, UTC).
 */
function beforeBoundMs(before: string): number {
  return Date.parse(before) + MS_PER_DAY - 1;
}

/**
 * Apply effective dateFilter to a node's last_edited_time.
 * No filter or in-range timestamps return "include"; out-of-range return "exclude".
 */
export function resolveDateDecision(
  lastEditedTime: string,
  dateFilter?: DateFilterConfig
): SelectorDecision {
  if (!dateFilter) {
    return "include";
  }

  const editedMs = Date.parse(lastEditedTime);

  if (dateFilter.after !== undefined && editedMs < Date.parse(dateFilter.after)) {
    return "exclude";
  }

  if (dateFilter.before !== undefined && editedMs > beforeBoundMs(dateFilter.before)) {
    return "exclude";
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
 *
 * `pendingIncludeIds` scopes id-based override search to targets not yet found
 * anywhere in the tree (see `computePendingIncludeIds`). Without a shared mutable
 * set across the whole crawl, any include id configured for the source would force
 * traversal into *every* excluded subtree looking for it, even unrelated ones — so
 * callers that don't share crawl-wide state (e.g. isolated unit tests) fall back to
 * a fresh set derived from `selectors` each call, matching this function's original
 * "is there an unresolved include id at all" semantics.
 */
export function shouldTraverseExcludedNode(
  node: SelectorNode,
  selectors: EffectiveSelectors,
  pendingIncludeIds?: Set<string>
): boolean {
  const partitioned = partitionSelectors(selectors);
  const remainingIncludeIds = pendingIncludeIds ?? new Set(partitioned.includeIds.map((s) => s.id));

  if (remainingIncludeIds.size > 0) {
    return true;
  }

  for (const selector of partitioned.includeGlobs) {
    if (globCouldMatchDescendant(selector.raw, node.titlePath)) {
      return true;
    }
  }

  return false;
}

/** Ancestor-exclusion + in-flight include-id state threaded through a tree crawl */
export interface PruneContext {
  ancestorExcluded?: boolean;
  pendingIncludeIds?: Set<string>;
}

/**
 * Return true when child fetch should be skipped for this node.
 */
export function shouldPruneNode(
  node: SelectorNode,
  selectors: EffectiveSelectors,
  context: PruneContext = {}
): boolean {
  const decision = resolveNodeDecision(node, selectors, context.ancestorExcluded ?? false);
  if (decision === "include") {
    return false;
  }

  return !shouldTraverseExcludedNode(node, selectors, context.pendingIncludeIds);
}

/**
 * Compute the initial set of unresolved include-id targets for a source, shared
 * (and mutated) across a whole tree crawl so override traversal stops searching
 * once every configured include id has actually been found.
 */
export function computePendingIncludeIds(selectors?: EffectiveSelectors): Set<string> | undefined {
  if (!selectors) {
    return undefined;
  }

  const ids = selectors.include.filter((selector) => selector.kind === "id").map((selector) => selector.id!);
  return ids.length > 0 ? new Set(ids) : undefined;
}
