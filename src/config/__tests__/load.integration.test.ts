import { expect, it } from "bun:test";

it("resolves page and database titles with one shared request slot", async () => {
  const child = Bun.spawn(
    [Bun.which("bun")!, new URL("./fixtures/load-default-title.ts", import.meta.url).pathname],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, output: stdout + stderr }).toEqual({ code: 0, output: "" });
});
