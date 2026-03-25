/**
 * Status command - show current sync state
 */

import { log } from "../utils/logger.ts";
import { loadIndex } from "./index.ts";

export interface StatusOptions {
  outputDir: string;
}

export async function status(options: StatusOptions): Promise<void> {
  const index = await loadIndex(options.outputDir);

  if (!index) {
    log.info("No sync configuration found");
    log.info("Run 'notion-rsync init <page-id>' to initialize");
    return;
  }

  console.log("\nSync Status");
  console.log("===========");
  console.log(`Root Page ID: ${index.rootPageId}`);
  console.log(`Last Sync: ${index.lastSync ?? "Never"}`);
  console.log(`Tracked Pages: ${Object.keys(index.pages).length}`);

  if (Object.keys(index.pages).length > 0) {
    console.log("\nPages:");
    for (const [id, page] of Object.entries(index.pages)) {
      console.log(`  - ${page.title} (${page.path})`);
      console.log(`    ID: ${id}`);
      console.log(`    Last edited: ${page.lastEdited}`);
    }
  }
}
