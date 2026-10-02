// Runs in its own `bun test` process: it replaces node:path with its win32
// implementation, which must not leak into other suites.
import { expect, it, mock } from "bun:test";
import { win32 } from "node:path";
import type { PageNode } from "../../../notion/tree.ts";

mock.module("node:path", () => ({ ...win32, default: win32 }));
const { computeLinkMap } = await import("../../writer.ts");
const { resolveNotionLinks } = await import("../../links.ts");

function page(id: string, title: string, children: PageNode[] = []): PageNode {
  return { id, title, lastEditedTime: "", blocks: null, children, isDatabase: false };
}

const tree = page("a0", "Root", [page("b1", "Guide", [page("c2", "Step")]), page("d3", "FAQ")]);

it("records index paths with forward slashes on Windows", () => {
  const linkMap = computeLinkMap(tree, "out");
  expect(linkMap.get("c2")).toBe("root/guide/step.md");
  expect(linkMap.get("b1")).toBe("root/guide/index.md");
});

it("writes Markdown links with forward slashes on Windows", () => {
  const linkMap = computeLinkMap(tree, "out");
  expect(resolveNotionLinks("notion://c2", "root/index.md", linkMap)).toBe("./guide/step.md");
  expect(resolveNotionLinks("notion://d3", "root/guide/step.md", linkMap)).toBe("../faq.md");
});
