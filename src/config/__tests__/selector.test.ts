/**
 * Tests for selector matching, precedence, and include-override traversal.
 */

import { describe, it, expect } from "bun:test";
import { classifySelector } from "../schema.ts";
import type { EffectiveSelectors } from "../load.ts";
import {
  globCouldMatchDescendant,
  matchGlob,
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

    expect(
      globCouldMatchDescendant("Sync2Hire/Archive/Keeper/**", ["Sync2Hire", "Archive"])
    ).toBe(true);

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

    expect(
      globCouldMatchDescendant("Sync2Hire/Important/**", ["Sync2Hire", "Other"])
    ).toBe(false);

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
});
