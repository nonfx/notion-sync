/**
 * Tests for config schema validation.
 */

import { describe, it, expect } from "bun:test";
import {
  classifySelector,
  ConfigValidationError,
  isNotionId,
  normalizeNotionId,
  validateConfig,
} from "../schema.ts";

describe("validateConfig", () => {
  it("accepts a minimal valid config", () => {
    const config = validateConfig({
      sources: [
        {
          id: "d95e4b1bba544a1794a68c9005e4fa0a",
          output: "professional-todos",
        },
      ],
    });

    expect(config.output).toBe("./docs");
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]?.id).toBe("d95e4b1bba544a1794a68c9005e4fa0a");
  });

  it("accepts a full config with globals and selectors", () => {
    const config = validateConfig({
      output: "./notion-export",
      concurrency: 2,
      retry: { attempts: 6 },
      defaultExclude: ["**/Archive/**"],
      sources: [
        {
          id: "d95e4b1b-ba54-4a17-94a6-8c9005e4fa0a",
          name: "Professional TODOs",
          output: "professional-todos",
          exclude: ["**/Archive/**", "9ded838dec5c451498cc03000357ca50"],
          maxDepth: 4,
        },
      ],
    });

    expect(config.output).toBe("./notion-export");
    expect(config.concurrency).toBe(2);
    expect(config.retry?.attempts).toBe(6);
    expect(config.defaultExclude).toEqual(["**/Archive/**"]);
    expect(config.sources[0]?.maxDepth).toBe(4);
  });

  it("rejects configs without sources", () => {
    expect(() => validateConfig({})).toThrow(ConfigValidationError);
    expect(() => validateConfig({ sources: [] })).toThrow("sources must be a non-empty array");
  });

  it("rejects invalid source ids", () => {
    expect(() =>
      validateConfig({
        sources: [{ id: "not-a-real-id", output: "x" }],
      })
    ).toThrow("sources[0].id must be a 32-character hex Notion id");
  });

  it("rejects empty output subdirs", () => {
    expect(() =>
      validateConfig({
        sources: [{ id: "d95e4b1bba544a1794a68c9005e4fa0a", output: "  " }],
      })
    ).toThrow("sources[0].output must be a non-empty string");
  });

  it("rejects invalid retry settings", () => {
    expect(() =>
      validateConfig({
        sources: [{ id: "d95e4b1bba544a1794a68c9005e4fa0a", output: "x" }],
        retry: { attempts: 0 },
      })
    ).toThrow("retry.attempts must be a positive integer");
  });

  it("accepts a valid source dateFilter", () => {
    const config = validateConfig({
      sources: [
        {
          id: "d95e4b1bba544a1794a68c9005e4fa0a",
          output: "professional-todos",
          dateFilter: { after: "2026-01-01" },
        },
      ],
    });

    expect(config.sources[0]?.dateFilter).toEqual({ after: "2026-01-01" });
  });

  it("accepts a valid defaultDateFilter and source dateFilter range", () => {
    const config = validateConfig({
      defaultDateFilter: { before: "2026-12-31T23:59:59Z" },
      sources: [
        {
          id: "d95e4b1bba544a1794a68c9005e4fa0a",
          output: "x",
          dateFilter: { after: "2026-01-01", before: "2026-06-30" },
        },
      ],
    });

    expect(config.defaultDateFilter).toEqual({ before: "2026-12-31T23:59:59Z" });
    expect(config.sources[0]?.dateFilter).toEqual({
      after: "2026-01-01",
      before: "2026-06-30",
    });
  });

  it("rejects malformed dateFilter date strings", () => {
    expect(() =>
      validateConfig({
        sources: [
          {
            id: "d95e4b1bba544a1794a68c9005e4fa0a",
            output: "x",
            dateFilter: { after: "not-a-date" },
          },
        ],
      })
    ).toThrow("sources[0].dateFilter.after must be a valid ISO-8601 date string");

    expect(() =>
      validateConfig({
        defaultDateFilter: { before: "yesterday-ish" },
        sources: [{ id: "d95e4b1bba544a1794a68c9005e4fa0a", output: "x" }],
      })
    ).toThrow("defaultDateFilter.before must be a valid ISO-8601 date string");
  });

  it("rejects dateFilter when after is later than before", () => {
    expect(() =>
      validateConfig({
        sources: [
          {
            id: "d95e4b1bba544a1794a68c9005e4fa0a",
            output: "x",
            dateFilter: { after: "2026-06-01", before: "2026-01-01" },
          },
        ],
      })
    ).toThrow("sources[0].dateFilter.after must not be later than sources[0].dateFilter.before");
  });
});

describe("selector helpers", () => {
  it("normalizes notion ids", () => {
    expect(normalizeNotionId("D95E4B1B-BA54-4A17-94A6-8C9005E4FA0A")).toBe(
      "d95e4b1bba544a1794a68c9005e4fa0a"
    );
    expect(isNotionId("d95e4b1bba544a1794a68c9005e4fa0a")).toBe(true);
    expect(isNotionId("**/Archive/**")).toBe(false);
  });

  it("classifies selectors as id or glob", () => {
    expect(classifySelector("9ded838dec5c451498cc03000357ca50")).toEqual({
      raw: "9ded838dec5c451498cc03000357ca50",
      kind: "id",
      id: "9ded838dec5c451498cc03000357ca50",
    });

    expect(classifySelector("**/Archive/**")).toEqual({
      raw: "**/Archive/**",
      kind: "glob",
    });
  });
});
