import { expect, it } from "bun:test";

it("keeps index paths and links POSIX-style under win32 path semantics", async () => {
  const fixture = new URL("./fixtures/win32-paths.ts", import.meta.url).pathname;
  const process = Bun.spawn([Bun.which("bun")!, "test", fixture], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  expect({ code, output: code === 0 ? "" : stdout + stderr }).toEqual({ code: 0, output: "" });
});
