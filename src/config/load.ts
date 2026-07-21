/**
 * Config discovery, parsing, name resolution, and effective selector computation.
 */

import { join } from "node:path";
import type { Client } from "@notionhq/client";
import {
  classifySelector,
  validateConfig,
  type ConfigFile,
  type ParsedSelector,
  type SourceConfig,
} from "./schema.ts";
import { createNotionClient, fetchPage, getPageTitle, withRetry } from "../notion/client.ts";
import { log } from "../utils/logger.ts";

export const DEFAULT_CONFIG_FILENAME = "notion-rsync.config.json";

/** Resolved selector set for one source after merging defaults */
export interface EffectiveSelectors {
  include: ParsedSelector[];
  exclude: ParsedSelector[];
}

/** A source after id/name resolution and selector computation */
export interface ResolvedSource {
  id: string;
  name: string;
  output: string;
  outputDir: string;
  selectors: EffectiveSelectors;
  maxDepth?: number;
}

/** Fully loaded and resolved config ready for orchestration */
export interface ResolvedConfig {
  configPath: string;
  output: string;
  concurrency?: number;
  retry?: ConfigFile["retry"];
  defaultExclude: ParsedSelector[];
  sources: ResolvedSource[];
}

/** Error when a configured name cannot be resolved uniquely */
export class NameResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NameResolutionError";
  }
}

/** Injectable page title lookup for tests */
export interface PageTitleResolver {
  getTitle(pageId: string): Promise<string>;
}

export interface LoadConfigOptions {
  configPath?: string;
  cwd?: string;
  titleResolver?: PageTitleResolver;
}

export interface ConfigSyncOptions {
  configPath?: string;
  cwd?: string;
  notionToken: string;
  dryRun: boolean;
  titleResolver?: PageTitleResolver;
}

/**
 * Resolve the config file path from an explicit flag or cwd default.
 */
export function discoverConfigPath(options: { configPath?: string; cwd?: string }): string {
  if (options.configPath) {
    return options.configPath;
  }

  const cwd = options.cwd ?? process.cwd();
  return join(cwd, DEFAULT_CONFIG_FILENAME);
}

/**
 * Read and parse a config file from disk.
 */
export async function readConfigFile(configPath: string): Promise<unknown> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Config file is not valid JSON: ${configPath}`);
  }
}

/**
 * Parse and validate config JSON.
 */
export function parseConfig(raw: unknown): ConfigFile {
  return validateConfig(raw);
}

/**
 * Build the effective include/exclude selector sets for one source.
 */
export function computeEffectiveSelectors(
  source: SourceConfig,
  defaultExclude: ParsedSelector[],
): EffectiveSelectors {
  const include = (source.include ?? []).map(classifySelector);
  const exclude = [...(source.exclude ?? []).map(classifySelector), ...defaultExclude];

  return { include, exclude };
}

function createDefaultTitleResolver(client: Client): PageTitleResolver {
  return {
    async getTitle(pageId: string): Promise<string> {
      const page = await withRetry(() => fetchPage(client, pageId));
      return getPageTitle(page);
    },
  };
}

/**
 * Resolve configured source names against Notion and compute effective selectors.
 */
export async function resolveConfig(
  config: ConfigFile,
  configPath: string,
  titleResolver: PageTitleResolver,
): Promise<ResolvedConfig> {
  const defaultExclude = (config.defaultExclude ?? []).map(classifySelector);
  const namesBySource = new Map<string, string[]>();

  const sources: ResolvedSource[] = [];

  for (const source of config.sources) {
    const title = await titleResolver.getTitle(source.id);

    if (source.name !== undefined && source.name !== title) {
      throw new NameResolutionError(
        `Name mismatch for source ${source.id}: config name "${source.name}" does not match Notion title "${title}"`,
      );
    }

    const resolvedName = source.name ?? title;
    const seenIds = namesBySource.get(resolvedName) ?? [];
    seenIds.push(source.id);
    namesBySource.set(resolvedName, seenIds);

    sources.push({
      id: source.id,
      name: resolvedName,
      output: source.output,
      outputDir: join(config.output ?? "./docs", source.output),
      selectors: computeEffectiveSelectors(source, defaultExclude),
      ...(source.maxDepth !== undefined ? { maxDepth: source.maxDepth } : {}),
    });
  }

  for (const [name, ids] of namesBySource.entries()) {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length > 1) {
      throw new NameResolutionError(
        `Ambiguous name "${name}": resolves to multiple ids (${uniqueIds.join(", ")})`,
      );
    }
  }

  return {
    configPath,
    output: config.output ?? "./docs",
    ...(config.concurrency !== undefined ? { concurrency: config.concurrency } : {}),
    ...(config.retry !== undefined ? { retry: config.retry } : {}),
    defaultExclude,
    sources,
  };
}

/**
 * Discover, read, validate, and resolve a config file.
 */
export async function loadConfig(options: LoadConfigOptions & { notionToken: string }): Promise<ResolvedConfig> {
  const configPath = discoverConfigPath(options);
  const raw = await readConfigFile(configPath);
  const config = parseConfig(raw);
  const client = createNotionClient({ token: options.notionToken });
  const titleResolver = options.titleResolver ?? createDefaultTitleResolver(client);
  return resolveConfig(config, configPath, titleResolver);
}

/**
 * Format a resolved config plan for dry-run output.
 */
export function formatResolvedPlan(resolved: ResolvedConfig): string {
  const lines: string[] = [
    `Config: ${resolved.configPath}`,
    `Output root: ${resolved.output}`,
  ];

  if (resolved.concurrency !== undefined) {
    lines.push(`Concurrency: ${resolved.concurrency}`);
  }

  if (resolved.retry !== undefined) {
    lines.push(`Retry attempts: ${resolved.retry.attempts}`);
  }

  if (resolved.defaultExclude.length > 0) {
    lines.push(`Default exclude: ${resolved.defaultExclude.map((selector) => selector.raw).join(", ")}`);
  }

  lines.push("", "Sources:");

  for (const source of resolved.sources) {
    lines.push(`  - ${source.name} (${source.id})`);
    lines.push(`    output: ${source.outputDir}`);

    if (source.selectors.include.length > 0) {
      lines.push(
        `    include: ${source.selectors.include.map((selector) => `${selector.raw} [${selector.kind}]`).join(", ")}`,
      );
    }

    if (source.selectors.exclude.length > 0) {
      lines.push(
        `    exclude: ${source.selectors.exclude.map((selector) => `${selector.raw} [${selector.kind}]`).join(", ")}`,
      );
    }

    if (source.maxDepth !== undefined) {
      lines.push(`    maxDepth: ${source.maxDepth}`);
    }
  }

  return lines.join("\n");
}

/**
 * Phase 1 stub orchestrator: load config, resolve names, print the plan.
 */
export async function syncFromConfig(options: ConfigSyncOptions): Promise<void> {
  const configPath = discoverConfigPath(options);
  const raw = await readConfigFile(configPath);
  const config = parseConfig(raw);
  const client = createNotionClient({ token: options.notionToken });
  const titleResolver = options.titleResolver ?? createDefaultTitleResolver(client);
  const resolved = await resolveConfig(config, configPath, titleResolver);

  console.log(formatResolvedPlan(resolved));

  if (!options.dryRun) {
    log.warn("Multi-source config sync is not implemented yet; re-run with --dry-run / -n to preview only.");
  }
}
