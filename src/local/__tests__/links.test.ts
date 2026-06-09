/**
 * Tests for reverse link resolution (relative .md links -> notion:// refs).
 */

import { describe, it, expect } from "bun:test";
import { resolveLocalLinks, type PathIdMap } from "../links.ts";

const map: PathIdMap = new Map([
  ["index.md", "root-id"],
  ["guide.md", "guide-id"],
  ["concepts/clause.md", "clause-id"],
]);

describe("resolveLocalLinks", () => {
  it("resolves a same-directory link", () => {
    const out = resolveLocalLinks("See [Guide](./guide.md).", "index.md", map);
    expect(out).toBe("See [Guide](notion://guide-id).");
  });

  it("resolves a nested link from the root", () => {
    const out = resolveLocalLinks("See [Clause](./concepts/clause.md).", "index.md", map);
    expect(out).toBe("See [Clause](notion://clause-id).");
  });

  it("resolves a parent-directory link", () => {
    const out = resolveLocalLinks("Back to [Guide](../guide.md).", "concepts/clause.md", map);
    expect(out).toBe("Back to [Guide](notion://guide-id).");
  });

  it("preserves an anchor on the link", () => {
    const out = resolveLocalLinks("[G](./guide.md#section)", "index.md", map);
    expect(out).toBe("[G](notion://guide-id#section)");
  });

  it("leaves external links unchanged", () => {
    const out = resolveLocalLinks("[x](https://example.com)", "index.md", map);
    expect(out).toBe("[x](https://example.com)");
  });

  it("leaves unknown .md links unchanged", () => {
    const out = resolveLocalLinks("[x](./missing.md)", "index.md", map);
    expect(out).toBe("[x](./missing.md)");
  });

  it("leaves non-.md relative links unchanged", () => {
    const out = resolveLocalLinks("[x](./image.png)", "index.md", map);
    expect(out).toBe("[x](./image.png)");
  });

  it("resolves multiple links in one document", () => {
    const out = resolveLocalLinks(
      "[Guide](./guide.md) and [Clause](./concepts/clause.md)",
      "index.md",
      map
    );
    expect(out).toBe("[Guide](notion://guide-id) and [Clause](notion://clause-id)");
  });
});
