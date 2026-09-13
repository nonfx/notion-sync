import { expect, it } from "bun:test";

for (const scenario of [
  "page",
  "database-root",
  "duplicate",
  "failure",
  "pruned",
  "database-excluded",
  "depth",
]) {
  it(`discovers databases inside page containers: ${scenario}`, async () => {
    const child = Bun.spawn(
      [Bun.which("bun")!, new URL("./fixtures/discovery.ts", import.meta.url).pathname, scenario],
      { stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, output: stdout + stderr }).toEqual({ code: 0, output: "" });
  });
}
