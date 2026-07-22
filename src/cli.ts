#!/usr/bin/env node
/**
 * Notion Rsync CLI
 *
 * Sync Notion pages to local markdown files.
 */

import { existsSync } from "node:fs";
import { parseArgs } from "util";
import { version } from "../package.json";
import { discoverConfigPath, syncFromConfig } from "./config/load.ts";
import { sync } from "./sync/engine.ts";
import { partialSync } from "./sync/partial.ts";
import { push } from "./sync/push.ts";
import { init } from "./sync/init.ts";
import { status } from "./sync/status.ts";
import { log, setLogLevel } from "./utils/logger.ts";

const HELP_TEXT = `
notion-rsync v${version}

Rsync for Notion - Sync Notion pages to local markdown files.

USAGE:
  notion-rsync <command> [options]

COMMANDS:
  init <page-id>    Initialize sync with a Notion page
  sync              Sync Notion pages to local markdown (pull)
  push [page-id]    Push local markdown back up to Notion (create/update pages)
  status            Show sync status

OPTIONS:
  -o, --output <dir>    Output directory (default: ./docs)
  -p, --pages <ids>     Sync only specific page IDs (comma-separated)
  -v, --verbose         Enable verbose logging
  -n, --dry-run         Show what would be synced without making changes
      --config <path>   Config file for multi-source sync (default: ./notion-rsync.config.json)
  -h, --help            Show this help message
  --version             Show version

ENVIRONMENT:
  NOTION_TOKEN          Notion API token (required)

EXAMPLES:
  notion-rsync init abc123def456 --output ./docs
  notion-rsync sync
  notion-rsync sync --config notion-rsync.config.json -n
  notion-rsync push                 # push using the configured root page
  notion-rsync push abc123def456    # push a new folder under a target page
  notion-rsync status
`;

interface CLIOptions {
  output: string;
  verbose: boolean;
  dryRun: boolean;
  help: boolean;
  version: boolean;
  pages: string | undefined;
  config: string | undefined;
}

function parseArguments(): { command: string; args: string[]; options: CLIOptions } {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: "string", short: "o", default: "./docs" },
      verbose: { type: "boolean", short: "v", default: false },
      "dry-run": { type: "boolean", short: "n", default: false },
      pages: { type: "string", short: "p" },
      config: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  return {
    command: positionals[0] ?? "",
    args: positionals.slice(1),
    options: {
      output: values.output ?? "./docs",
      verbose: values.verbose ?? false,
      dryRun: values["dry-run"] ?? false,
      pages: values.pages,
      config: values.config,
      help: values.help ?? false,
      version: values.version ?? false,
    },
  };
}

async function main(): Promise<void> {
  const { command, args, options } = parseArguments();

  // Set log level based on verbose flag
  if (options.verbose) {
    setLogLevel("debug");
  }

  // Handle help and version flags
  if (options.help || command === "help") {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (options.version) {
    console.log(`notion-rsync v${version}`);
    process.exit(0);
  }

  // Check for NOTION_TOKEN
  const notionToken = process.env["NOTION_TOKEN"];
  if (!notionToken && command !== "help") {
    log.error("NOTION_TOKEN environment variable is required");
    log.info("Set it with: export NOTION_TOKEN=your_token");
    process.exit(1);
  }

  // Route to command handlers
  try {
    switch (command) {
      case "init": {
        const pageId = args[0];
        if (!pageId) {
          log.error("Page ID is required for init command");
          log.info("Usage: notion-rsync init <page-id>");
          process.exit(1);
        }
        await init({
          pageId,
          outputDir: options.output,
          notionToken: notionToken!,
        });
        break;
      }

      case "sync": {
        const defaultConfigPath = discoverConfigPath({});
        const configPath =
          options.config ?? (existsSync(defaultConfigPath) ? defaultConfigPath : undefined);
        if (configPath) {
          await syncFromConfig({
            configPath,
            notionToken: notionToken!,
            dryRun: options.dryRun,
          });
          break;
        }

        if (options.pages) {
          const pageIds = options.pages.split(",").map((id) => id.trim().replace(/-/g, ""));
          await partialSync({
            outputDir: options.output,
            notionToken: notionToken!,
            pageIds,
            dryRun: options.dryRun,
          });
        } else {
          await sync({
            outputDir: options.output,
            notionToken: notionToken!,
            dryRun: options.dryRun,
          });
        }
        break;
      }

      case "push": {
        const parentPageId = args[0]?.replace(/-/g, "");
        await push({
          outputDir: options.output,
          notionToken: notionToken!,
          parentPageId,
          dryRun: options.dryRun,
        });
        break;
      }

      case "status": {
        await status({
          outputDir: options.output,
        });
        break;
      }

      case "": {
        console.log(HELP_TEXT);
        process.exit(0);
      }

      default: {
        log.error(`Unknown command: ${command}`);
        console.log(HELP_TEXT);
        process.exit(1);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      log.error(error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
    } else {
      log.error("An unexpected error occurred");
    }
    process.exit(1);
  }
}

main();
