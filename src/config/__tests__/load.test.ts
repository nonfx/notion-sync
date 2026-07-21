/**
 * Tests for config loading, name resolution, and effective selectors.
 */

import { describe, it, expect } from "bun:test";
import {
  computeEffectiveSelectors,
  discoverConfigPath,
  formatResolvedPlan,
  NameResolutionError,
  parseConfig,
  resolveConfig,
  syncResolvedSources,
  type PageTitleResolver,
} from "../load.ts";
import { classifySelector } from "../schema.ts";

const PAGE_A = "d95e4b1bba544a1794a68c9005e4fa0a";
const PAGE_B = "2df24584254b804094d3dfb56506b0be";

function createResolver(titles: Record<string, string>): PageTitleResolver {
  return {
    async getTitle(pageId: string): Promise<string> {
      const title = titles[pageId];
      if (title === undefined) {
        throw new Error(`Unknown page id: ${pageId}`);
      }
      return title;
    },
  };
}

describe("discoverConfigPath", () => {
  it("uses an explicit path when provided", () => {
    expect(discoverConfigPath({ configPath: "./custom.json" })).toBe("./custom.json");
  });

  it("defaults to notion-rsync.config.json in cwd", () => {
    expect(discoverConfigPath({ cwd: "/tmp/workspace" })).toBe(
      "/tmp/workspace/notion-rsync.config.json"
    );
  });
});

describe("resolveConfig", () => {
  it("resolves matching source names and computes effective selectors", async () => {
    const config = parseConfig({
      output: "./notion-export",
      defaultExclude: ["**/Archive/**"],
      sources: [
        {
          id: PAGE_A,
          name: "Professional TODOs",
          output: "professional-todos",
          exclude: ["9ded838dec5c451498cc03000357ca50"],
        },
        {
          id: PAGE_B,
          output: "sync2hire",
        },
      ],
    });

    const resolved = await resolveConfig(
      config,
      "notion-rsync.config.json",
      createResolver({
        [PAGE_A]: "Professional TODOs",
        [PAGE_B]: "Sync2Hire",
      })
    );

    expect(resolved.sources).toHaveLength(2);
    expect(resolved.sources[0]).toMatchObject({
      id: PAGE_A,
      name: "Professional TODOs",
      output: "professional-todos",
      outputDir: "notion-export/professional-todos",
    });

    expect(resolved.sources[1]?.name).toBe("Sync2Hire");
    expect(resolved.sources[0]?.selectors.exclude).toEqual([
      classifySelector("9ded838dec5c451498cc03000357ca50"),
    ]);
    expect(resolved.sources[0]?.selectors.defaultExclude).toEqual([
      classifySelector("**/Archive/**"),
    ]);
  });

  it("fails loudly when a configured name does not match Notion", async () => {
    const config = parseConfig({
      sources: [{ id: PAGE_A, name: "Wrong Name", output: "x" }],
    });

    await expect(
      resolveConfig(
        config,
        "notion-rsync.config.json",
        createResolver({ [PAGE_A]: "Professional TODOs" })
      )
    ).rejects.toThrow(NameResolutionError);

    await expect(
      resolveConfig(
        config,
        "notion-rsync.config.json",
        createResolver({ [PAGE_A]: "Professional TODOs" })
      )
    ).rejects.toThrow('config name "Wrong Name" does not match Notion title "Professional TODOs"');
  });

  it("fails loudly on ambiguous names across sources", async () => {
    const config = parseConfig({
      sources: [
        { id: PAGE_A, name: "Todos", output: "a" },
        { id: PAGE_B, name: "Todos", output: "b" },
      ],
    });

    await expect(
      resolveConfig(
        config,
        "notion-rsync.config.json",
        createResolver({
          [PAGE_A]: "Todos",
          [PAGE_B]: "Todos",
        })
      )
    ).rejects.toThrow('Ambiguous name "Todos"');
  });
});

describe("computeEffectiveSelectors", () => {
  it("merges defaultExclude into source exclude selectors", () => {
    const selectors = computeEffectiveSelectors(
      {
        id: PAGE_A,
        output: "x",
        exclude: ["**/Private/**"],
      },
      [classifySelector("**/Archive/**")]
    );

    expect(selectors.include).toEqual([]);
    expect(selectors.exclude.map((selector) => selector.raw)).toEqual(["**/Private/**"]);
    expect(selectors.defaultExclude.map((selector) => selector.raw)).toEqual(["**/Archive/**"]);
  });

  it("uses source-only dateFilter when no default is set", () => {
    const selectors = computeEffectiveSelectors(
      {
        id: PAGE_A,
        output: "x",
        dateFilter: { after: "2026-03-01", before: "2026-12-31" },
      },
      []
    );

    expect(selectors.dateFilter).toEqual({
      after: "2026-03-01",
      before: "2026-12-31",
    });
  });

  it("uses default-only dateFilter when source has none", () => {
    const selectors = computeEffectiveSelectors(
      {
        id: PAGE_A,
        output: "x",
      },
      [],
      { after: "2026-01-01", before: "2026-06-30" }
    );

    expect(selectors.dateFilter).toEqual({
      after: "2026-01-01",
      before: "2026-06-30",
    });
  });

  it("intersects source and default date bounds (later after, earlier before)", () => {
    const selectors = computeEffectiveSelectors(
      {
        id: PAGE_A,
        output: "x",
        dateFilter: { after: "2026-02-01", before: "2026-09-30" },
      },
      [],
      { after: "2026-01-01", before: "2026-12-31" }
    );

    expect(selectors.dateFilter).toEqual({
      after: "2026-02-01",
      before: "2026-09-30",
    });
  });

  it("narrows bounds when source and default disagree", () => {
    const selectors = computeEffectiveSelectors(
      {
        id: PAGE_A,
        output: "x",
        dateFilter: { after: "2026-01-01", before: "2026-12-31" },
      },
      [],
      { after: "2026-06-01", before: "2026-06-30" }
    );

    expect(selectors.dateFilter).toEqual({
      after: "2026-06-01",
      before: "2026-06-30",
    });
  });

  it("omits dateFilter when neither source nor default set one", () => {
    const selectors = computeEffectiveSelectors({ id: PAGE_A, output: "x" }, []);

    expect(selectors.dateFilter).toBeUndefined();
  });
});

describe("formatResolvedPlan", () => {
  it("prints default and effective dateFilter per source", async () => {
    const config = parseConfig({
      output: "./notion-export",
      defaultDateFilter: { after: "2026-01-01", before: "2026-12-31" },
      sources: [
        {
          id: PAGE_A,
          name: "Professional TODOs",
          output: "professional-todos",
          dateFilter: { after: "2026-03-01" },
        },
      ],
    });

    const resolved = await resolveConfig(
      config,
      "notion-rsync.config.json",
      createResolver({ [PAGE_A]: "Professional TODOs" })
    );

    const plan = formatResolvedPlan(resolved);

    expect(plan).toContain("Default dateFilter: after 2026-01-01, before 2026-12-31");
    expect(plan).toContain("effective dateFilter: after 2026-03-01, before 2026-12-31");
  });
});

describe("syncResolvedSources", () => {
  it("runs each source sequentially with its output subdir and root id", async () => {
    const config = parseConfig({
      output: "./notion-export",
      sources: [
        { id: PAGE_A, output: "professional-todos" },
        { id: PAGE_B, output: "sync2hire" },
      ],
    });

    const resolved = await resolveConfig(
      config,
      "notion-rsync.config.json",
      createResolver({
        [PAGE_A]: "Professional TODOs",
        [PAGE_B]: "Sync2Hire",
      })
    );

    const syncCalls: Array<{ outputDir: string; rootPageId?: string }> = [];
    await syncResolvedSources(resolved, {
      notionToken: "test-token",
      dryRun: false,
      syncSource: async (options) => {
        syncCalls.push({
          outputDir: options.outputDir,
          rootPageId: options.rootPageId,
        });
      },
    });

    expect(syncCalls).toEqual([
      {
        outputDir: "notion-export/professional-todos",
        rootPageId: PAGE_A,
      },
      {
        outputDir: "notion-export/sync2hire",
        rootPageId: PAGE_B,
      },
    ]);
  });
});
