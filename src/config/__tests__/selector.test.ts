/**
 * Tests for selector matching, precedence, and include-override traversal.
 */

import { describe, it, expect } from "bun:test";
import { classifySelector } from "../schema.ts";
import type { EffectiveSelectors } from "../load.ts";
import {
  computePendingIncludeIds,
  globCouldMatchDescendant,
  matchGlob,
  resolveDateDecision,
  resolveNodeDecision,
  shouldPruneNode,
  shouldTraverseExcludedNode,
  type SelectorNode,
} from "../selector.ts";

const KEEPER_ID = "9ded838dec5c451498cc03000357ca50";
const EXCLUDED_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function selectors(partial: Partial<EffectiveSelectors>): EffectiveSelectors {
  return {
    include: partial.include ?? [],
    exclude: partial.exclude ?? [],
    defaultExclude: partial.defaultExclude ?? [],
  };
}

function node(titlePath: string[], id = OTHER_ID): SelectorNode {
  return { id, titlePath };
}

describe("matchGlob", () => {
  it("matches title-path globs with ** segments", () => {
    expect(matchGlob("**/Archive/**", ["Sync2Hire", "Archive", "Old Note"])).toBe(true);
    expect(matchGlob("**/Archive/**", ["Sync2Hire", "Active"])).toBe(false);
    expect(matchGlob("Sync2Hire/Archive/*", ["Sync2Hire", "Archive", "Old Note"])).toBe(true);
  });
});

describe("resolveNodeDecision precedence", () => {
  it("prefers explicit include id over exclude id", () => {
    const decision = resolveNodeDecision(
      node(["Root"], KEEPER_ID),
      selectors({
        include: [classifySelector(KEEPER_ID)],
        exclude: [classifySelector(KEEPER_ID)],
      })
    );

    expect(decision).toBe("include");
  });

  it("prefers explicit exclude id over include glob", () => {
    const decision = resolveNodeDecision(
      node(["Sync2Hire", "Archive"], EXCLUDED_ID),
      selectors({
        include: [classifySelector("**/Archive/**")],
        exclude: [classifySelector(EXCLUDED_ID)],
      })
    );

    expect(decision).toBe("exclude");
  });

  it("prefers include glob over exclude glob", () => {
    const decision = resolveNodeDecision(
      node(["Sync2Hire", "Archive", "Keeper"]),
      selectors({
        include: [classifySelector("**/Keeper/**")],
        exclude: [classifySelector("**/Archive/**")],
      })
    );

    expect(decision).toBe("include");
  });

  it("prefers source exclude glob over defaultExclude glob", () => {
    const decision = resolveNodeDecision(
      node(["Sync2Hire", "Drafts", "Note"]),
      selectors({
        exclude: [classifySelector("**/Drafts/**")],
        defaultExclude: [classifySelector("**/Drafts/**")],
      })
    );

    expect(decision).toBe("exclude");
  });

  it("applies defaultExclude when nothing else matches", () => {
    const decision = resolveNodeDecision(
      node(["Sync2Hire", "Archive", "Old Note"]),
      selectors({
        defaultExclude: [classifySelector("**/Archive/**")],
      })
    );

    expect(decision).toBe("exclude");
  });

  it("defaults to include when no selectors match", () => {
    const decision = resolveNodeDecision(
      node(["Sync2Hire", "Active"]),
      selectors({
        exclude: [classifySelector("**/Archive/**")],
        defaultExclude: [classifySelector("**/Trash/**")],
      })
    );

    expect(decision).toBe("include");
  });
});

describe("include-override traversal", () => {
  it("prunes excluded subtrees without include selectors", () => {
    expect(
      shouldPruneNode(
        node(["Sync2Hire", "Archive"]),
        selectors({ exclude: [classifySelector("**/Archive/**")] })
      )
    ).toBe(true);
  });

  it("walks into an excluded parent when an include id is configured", () => {
    const archive = node(["Sync2Hire", "Archive"]);

    expect(
      shouldTraverseExcludedNode(
        archive,
        selectors({
          exclude: [classifySelector("**/Archive/**")],
          include: [classifySelector(KEEPER_ID)],
        })
      )
    ).toBe(true);

    expect(
      shouldPruneNode(
        archive,
        selectors({
          exclude: [classifySelector("**/Archive/**")],
          include: [classifySelector(KEEPER_ID)],
        })
      )
    ).toBe(false);
  });

  it("walks into an excluded parent when an include glob targets a descendant", () => {
    const archive = node(["Sync2Hire", "Archive"]);

    expect(globCouldMatchDescendant("Sync2Hire/Archive/Keeper/**", ["Sync2Hire", "Archive"])).toBe(
      true
    );

    expect(
      shouldTraverseExcludedNode(
        archive,
        selectors({
          exclude: [classifySelector("**/Archive/**")],
          include: [classifySelector("Sync2Hire/Archive/Keeper/**")],
        })
      )
    ).toBe(true);
  });

  it("does not traverse excluded branches when include globs only match elsewhere", () => {
    const otherBranch = node(["Sync2Hire", "Other"]);

    expect(globCouldMatchDescendant("Sync2Hire/Important/**", ["Sync2Hire", "Other"])).toBe(false);

    expect(
      shouldPruneNode(
        otherBranch,
        selectors({
          exclude: [classifySelector("**/Other/**")],
          include: [classifySelector("Sync2Hire/Important/**")],
        })
      )
    ).toBe(true);
  });

  it("includes a buried keeper by id even when ancestors are excluded", () => {
    const keeper = node(["Sync2Hire", "Archive", "Keeper"], KEEPER_ID);

    expect(
      resolveNodeDecision(
        keeper,
        selectors({
          exclude: [classifySelector("**/Archive/**")],
          include: [classifySelector(KEEPER_ID)],
        })
      )
    ).toBe("include");
  });

  it("cascades an excluded ancestor's decision to a sibling with no selector of its own", () => {
    // Regression: traversing into "Excluded Parent" to find a buried include-id
    // keeper must not let its unrelated sibling default back to "include".
    const sibling = node(["Root", "Excluded Parent", "Sibling"]);

    const decision = resolveNodeDecision(
      sibling,
      selectors({
        exclude: [classifySelector(EXCLUDED_ID)],
        include: [classifySelector(KEEPER_ID)],
      }),
      /* ancestorExcluded */ true
    );

    expect(decision).toBe("exclude");
  });

  it("does not require ancestorExcluded cascade when no ancestor was excluded", () => {
    const sibling = node(["Root", "Sibling"]);

    expect(
      resolveNodeDecision(sibling, selectors({ include: [classifySelector(KEEPER_ID)] }), false)
    ).toBe("include");
  });

  it("stops traversing unrelated excluded subtrees once every include id is found (pendingIncludeIds)", () => {
    // Regression: a source with an unrelated include-id override must not force
    // traversal into every other excluded subtree, e.g. an unrelated Archive.
    const archive = node(["Root", "Archive"]);
    const sourceSelectors = selectors({
      defaultExclude: [classifySelector("**/Archive/**")],
      include: [classifySelector(KEEPER_ID)],
    });

    // Fresh crawl: the keeper hasn't been found yet, so Archive still gets traversed.
    const pending = computePendingIncludeIds(sourceSelectors)!;
    expect(pending.has(KEEPER_ID)).toBe(true);
    expect(shouldPruneNode(archive, sourceSelectors, { pendingIncludeIds: pending })).toBe(false);

    // Once the keeper elsewhere in the tree has been found and consumed...
    pending.delete(KEEPER_ID);

    // ...Archive is now a plain, unrelated excluded subtree and should be pruned.
    expect(shouldPruneNode(archive, sourceSelectors, { pendingIncludeIds: pending })).toBe(true);
  });

  it("computePendingIncludeIds returns undefined when there are no include ids", () => {
    expect(
      computePendingIncludeIds(selectors({ exclude: [classifySelector("**/Archive/**")] }))
    ).toBeUndefined();
    expect(computePendingIncludeIds(undefined)).toBeUndefined();
  });
});

describe("resolveDateDecision", () => {
  it("includes when no dateFilter is configured", () => {
    expect(resolveDateDecision("2026-03-15T12:00:00.000Z")).toBe("include");
    expect(resolveDateDecision("2026-03-15T12:00:00.000Z", undefined)).toBe("include");
  });

  it("excludes timestamps before after bound", () => {
    expect(resolveDateDecision("2025-12-31T23:59:59.999Z", { after: "2026-01-01" })).toBe(
      "exclude"
    );
    expect(resolveDateDecision("2026-01-01T00:00:00.000Z", { after: "2026-01-01" })).toBe(
      "include"
    );
    expect(resolveDateDecision("2026-06-15T00:00:00.000Z", { after: "2026-01-01" })).toBe(
      "include"
    );
  });

  it("excludes timestamps after before bound", () => {
    expect(resolveDateDecision("2026-07-01T00:00:00.000Z", { before: "2026-06-30" })).toBe(
      "exclude"
    );
    expect(resolveDateDecision("2026-06-30T23:59:59.999Z", { before: "2026-06-30" })).toBe(
      "include"
    );
    expect(resolveDateDecision("2026-06-15T00:00:00.000Z", { before: "2026-06-30" })).toBe(
      "include"
    );
  });

  it("applies both after and before as an inclusive range", () => {
    const filter = { after: "2026-01-01", before: "2026-06-30" };

    expect(resolveDateDecision("2025-06-01T00:00:00.000Z", filter)).toBe("exclude");
    expect(resolveDateDecision("2026-03-15T12:00:00.000Z", filter)).toBe("include");
    expect(resolveDateDecision("2026-07-01T00:00:00.000Z", filter)).toBe("exclude");
  });

  it("includes timestamps exactly on after and before boundaries", () => {
    expect(
      resolveDateDecision("2026-01-01T00:00:00.000Z", { after: "2026-01-01", before: "2026-06-30" })
    ).toBe("include");
    expect(
      resolveDateDecision("2026-06-30T23:59:59.999Z", { after: "2026-01-01", before: "2026-06-30" })
    ).toBe("include");
  });
});
