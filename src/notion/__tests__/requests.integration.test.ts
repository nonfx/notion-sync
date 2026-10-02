import { expect, it } from "bun:test";

// Isolate real client imports from the existing suite's module-level client mocks.
for (const scenario of [
  "global",
  "pagination",
  "database-pagination",
  "retry",
  "exhaustion",
  "failure",
  "default-spacing",
  "synchronous-start",
  "pagination-retry",
  "partial",
  "transient",
  "transient-exhaustion",
]) {
  it(`shares the request budget: ${scenario}`, async () => {
    const process = Bun.spawn(
      [
        Bun.which("bun")!,
        new URL(
          scenario === "partial" ? "./fixtures/partial.ts" : "./fixtures/requests.ts",
          import.meta.url
        ).pathname,
        scenario,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect({ code, output: stdout + stderr }).toEqual({ code: 0, output: "" });
  });
}
