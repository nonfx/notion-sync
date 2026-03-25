/**
 * Initialize sync configuration
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../utils/logger.ts";
import { INDEX_DIR, writeIndex, type SyncIndex } from "./index.ts";

export interface InitOptions {
  pageId: string;
  outputDir: string;
  notionToken: string;
}

export async function init(options: InitOptions): Promise<void> {
  log.info(`Initializing sync for page: ${options.pageId}`);
  log.info(`Output directory: ${options.outputDir}`);

  // Create output directory if it doesn't exist
  await mkdir(options.outputDir, { recursive: true });

  // Create .notion-rsync directory
  const indexDir = join(options.outputDir, INDEX_DIR);
  await mkdir(indexDir, { recursive: true });

  // Create initial index
  const index: SyncIndex = {
    version: "1.0.0",
    rootPageId: options.pageId,
    lastSync: null,
    pages: {},
  };

  await writeIndex(options.outputDir, index);

  log.info("Initialization complete!");
  log.info(`Run 'notion-rsync sync --output ${options.outputDir}' to sync pages`);
}
