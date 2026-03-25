/**
 * Sync index management - tracks sync state for idempotency
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const INDEX_DIR = ".notion-rsync";
export const INDEX_FILE = "index.json";

export interface PageState {
  path: string;
  title: string;
  lastEdited: string;
}

export interface SyncIndex {
  version: string;
  rootPageId: string;
  lastSync: string | null;
  pages: Record<string, PageState>;
}

export async function loadIndex(outputDir: string): Promise<SyncIndex | null> {
  const indexPath = join(outputDir, INDEX_DIR, INDEX_FILE);

  try {
    const content = await readFile(indexPath, "utf-8");
    return JSON.parse(content) as SyncIndex;
  } catch {
    return null;
  }
}

export async function writeIndex(outputDir: string, index: SyncIndex): Promise<void> {
  const indexPath = join(outputDir, INDEX_DIR, INDEX_FILE);
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

export function createEmptyIndex(rootPageId: string): SyncIndex {
  return {
    version: "1.0.0",
    rootPageId,
    lastSync: null,
    pages: {},
  };
}
