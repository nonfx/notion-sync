// The package entry point, imported by path so Bun cannot substitute its
// built-in node-fetch. See abortingFetch in notion/client.ts.
declare module "node-fetch/lib/index.js" {
  export { default } from "node-fetch";
}
