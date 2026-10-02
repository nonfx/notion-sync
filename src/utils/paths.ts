/**
 * Index paths and Markdown links always use "/", whatever the platform
 * separator, so an index and its links read the same on every OS.
 */
export function toPosix(path: string): string {
  return path.split(/[\\/]/).join("/");
}
