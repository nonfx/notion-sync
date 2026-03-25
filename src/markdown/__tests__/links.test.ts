/**
 * Tests for link resolution
 */

import { describe, it, expect } from "bun:test";
import { resolveNotionLinks, type LinkMap } from "../links.ts";

describe("resolveNotionLinks", () => {
  const linkMap: LinkMap = new Map([
    // With dashes
    ["2c3e4ea0-0265-80c8-8670-c7f63e97b0e3", "concepts/statement.md"],
    // Without dashes (normalized)
    ["2c3e4ea0026580c88670c7f63e97b0e3", "concepts/statement.md"],
    // Another page
    ["abc12345-1234-5678-9012-def456789012", "other/another-page.md"],
    ["abc1234512345678901def456789012", "other/another-page.md"],
    // Index page (must be valid hex UUID format)
    ["a1b2c3d4-e5f6-7890-abcd-ef1234567890", "index.md"],
    ["a1b2c3d4e5f67890abcdef1234567890", "index.md"],
  ]);

  it("resolves notion:// URL to relative path (same directory)", () => {
    const content = "[Statement](notion://2c3e4ea0-0265-80c8-8670-c7f63e97b0e3)";
    const result = resolveNotionLinks(content, "concepts/clause.md", linkMap);
    
    expect(result).toBe("[Statement](./statement.md)");
  });

  it("resolves notion:// URL to relative path (different directory)", () => {
    const content = "[Statement](notion://2c3e4ea0-0265-80c8-8670-c7f63e97b0e3)";
    const result = resolveNotionLinks(content, "other/page.md", linkMap);
    
    expect(result).toBe("[Statement](../concepts/statement.md)");
  });

  it("resolves notion:// URL with dashes removed", () => {
    const content = "[Statement](notion://2c3e4ea0026580c88670c7f63e97b0e3)";
    const result = resolveNotionLinks(content, "page.md", linkMap);
    
    expect(result).toBe("[Statement](./concepts/statement.md)");
  });

  it("resolves multiple links in same content", () => {
    const content = `
See [Statement](notion://2c3e4ea0-0265-80c8-8670-c7f63e97b0e3) and 
[Another Page](notion://abc12345-1234-5678-9012-def456789012) for details.
`;
    const result = resolveNotionLinks(content, "docs/intro.md", linkMap);
    
    expect(result).toContain("../concepts/statement.md");
    expect(result).toContain("../other/another-page.md");
  });

  it("preserves external links unchanged", () => {
    const content = "[Example](https://example.com)";
    const result = resolveNotionLinks(content, "page.md", linkMap);
    
    expect(result).toBe("[Example](https://example.com)");
  });

  it("preserves unknown notion:// links unchanged", () => {
    const content = "[Unknown](notion://unknown-page-id-1234)";
    const result = resolveNotionLinks(content, "page.md", linkMap);
    
    // Should keep the original URL since page is not in linkMap
    expect(result).toBe("[Unknown](notion://unknown-page-id-1234)");
  });

  it("handles mixed content with text and links", () => {
    const content = `A Clause is an atomic unit from a [Statement](notion://2c3e4ea0-0265-80c8-8670-c7f63e97b0e3) - mapped to Starmaps.`;
    const result = resolveNotionLinks(content, "concepts/clause.md", linkMap);
    
    expect(result).toBe(
      "A Clause is an atomic unit from a [Statement](./statement.md) - mapped to Starmaps."
    );
  });

  it("resolves links from nested directory to root", () => {
    const content = "[Home](notion://a1b2c3d4-e5f6-7890-abcd-ef1234567890)";
    const result = resolveNotionLinks(content, "deep/nested/page.md", linkMap);
    
    expect(result).toBe("[Home](../../index.md)");
  });

  it("resolves links from root to nested directory", () => {
    const content = "[Statement](notion://2c3e4ea0-0265-80c8-8670-c7f63e97b0e3)";
    const result = resolveNotionLinks(content, "index.md", linkMap);
    
    expect(result).toBe("[Statement](./concepts/statement.md)");
  });
});
