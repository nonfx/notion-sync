/**
 * Config file types and validation for notion-rsync.config.json
 */

import { isAbsolute, normalize, sep } from "node:path";

const NOTION_ID_PATTERN = /^[0-9a-f]{32}$/i;
const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Retry settings exposed via config */
export interface RetryConfig {
  attempts: number;
}

/** Date range filter on last_edited_time (ISO-8601 strings) */
export interface DateFilterConfig {
  after?: string;
  before?: string;
}

/** A single Notion root declared in config */
export interface SourceConfig {
  id: string;
  name?: string;
  output: string;
  include?: string[];
  exclude?: string[];
  maxDepth?: number;
  dateFilter?: DateFilterConfig;
}

/** Raw config file shape after JSON parse */
export interface ConfigFile {
  output?: string;
  concurrency?: number;
  retry?: RetryConfig;
  defaultExclude?: string[];
  defaultDateFilter?: DateFilterConfig;
  sources: SourceConfig[];
}

/** Classified selector kind used when computing effective sets */
export type SelectorKind = "id" | "glob";

/** A selector string normalized for downstream matching */
export interface ParsedSelector {
  raw: string;
  kind: SelectorKind;
  /** Normalized 32-hex id when kind is "id" */
  id?: string;
}

/** Validation error with a stable path for tests and CLI output */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * Normalize a Notion id by stripping dashes and lowercasing hex digits.
 */
export function normalizeNotionId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

/**
 * Return true when the string is a well-formed 32-hex Notion id.
 */
export function isNotionId(value: string): boolean {
  return NOTION_ID_PATTERN.test(normalizeNotionId(value));
}

/**
 * Classify a selector as an id or title-path glob.
 */
export function classifySelector(selector: string): ParsedSelector {
  const trimmed = selector.trim();
  if (isNotionId(trimmed)) {
    return {
      raw: trimmed,
      kind: "id",
      id: normalizeNotionId(trimmed),
    };
  }

  return {
    raw: trimmed,
    kind: "glob",
  };
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigValidationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertString(value, label);
}

function assertOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ConfigValidationError(`${label} must be a positive number`);
  }
  return value;
}

/**
 * Validate that a source's output path is relative and stays within the
 * global output root (no absolute paths, no `..` traversal segments).
 */
function assertRelativeOutputPath(value: string, label: string): string {
  if (isAbsolute(value)) {
    throw new ConfigValidationError(`${label} must be a relative path`);
  }

  const normalized = normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new ConfigValidationError(`${label} must not escape the output root`);
  }

  return normalized;
}

function assertStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new ConfigValidationError(`${label} must be an array of strings`);
  }

  const items: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "string" || item.trim() === "") {
      throw new ConfigValidationError(`${label}[${i}] must be a non-empty string`);
    }
    items.push(item.trim());
  }

  return items;
}

/**
 * Return true when the string is a valid ISO-8601 date(-time) string.
 * Rejects lexically non-ISO formats (e.g. "2026/01/01", "January 1, 2026")
 * that `Date.parse` would otherwise accept.
 */
function isValidDateString(value: string): boolean {
  return ISO_8601_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Parse and validate an optional date filter object.
 */
function parseDateFilter(value: unknown, label: string): DateFilterConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const filter = assertObject(value, label);
  const afterRaw = filter["after"];
  const beforeRaw = filter["before"];

  let after: string | undefined;
  let before: string | undefined;

  if (afterRaw !== undefined) {
    const afterStr = assertString(afterRaw, `${label}.after`);
    if (!isValidDateString(afterStr)) {
      throw new ConfigValidationError(`${label}.after must be a valid ISO-8601 date string`);
    }
    after = afterStr;
  }

  if (beforeRaw !== undefined) {
    const beforeStr = assertString(beforeRaw, `${label}.before`);
    if (!isValidDateString(beforeStr)) {
      throw new ConfigValidationError(`${label}.before must be a valid ISO-8601 date string`);
    }
    before = beforeStr;
  }

  if (after !== undefined && before !== undefined && Date.parse(after) > Date.parse(before)) {
    throw new ConfigValidationError(`${label}.after must not be later than ${label}.before`);
  }

  return {
    ...(after !== undefined ? { after } : {}),
    ...(before !== undefined ? { before } : {}),
  };
}

function parseRetry(value: unknown): RetryConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const retry = assertObject(value, "retry");
  const attempts = retry["attempts"];
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 1) {
    throw new ConfigValidationError("retry.attempts must be a positive integer");
  }

  return { attempts };
}

function parseSource(value: unknown, index: number): SourceConfig {
  const source = assertObject(value, `sources[${index}]`);
  const id = assertString(source["id"], `sources[${index}].id`);
  if (!isNotionId(id)) {
    throw new ConfigValidationError(`sources[${index}].id must be a 32-character hex Notion id`);
  }

  const output = assertRelativeOutputPath(
    assertString(source["output"], `sources[${index}].output`),
    `sources[${index}].output`
  );
  const name = assertOptionalString(source["name"], `sources[${index}].name`);
  const include = assertStringArray(source["include"], `sources[${index}].include`);
  const exclude = assertStringArray(source["exclude"], `sources[${index}].exclude`);
  const maxDepth = assertOptionalNumber(source["maxDepth"], `sources[${index}].maxDepth`);
  const dateFilter = parseDateFilter(source["dateFilter"], `sources[${index}].dateFilter`);

  for (const selector of [...(include ?? []), ...(exclude ?? [])]) {
    if (isNotionId(selector) && !NOTION_ID_PATTERN.test(normalizeNotionId(selector))) {
      throw new ConfigValidationError(`Invalid Notion id selector: ${selector}`);
    }
  }

  return {
    id: normalizeNotionId(id),
    ...(name !== undefined ? { name } : {}),
    output,
    ...(include !== undefined ? { include } : {}),
    ...(exclude !== undefined ? { exclude } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(dateFilter !== undefined ? { dateFilter } : {}),
  };
}

/**
 * Validate and normalize a parsed config object.
 */
export function validateConfig(raw: unknown): ConfigFile {
  const config = assertObject(raw, "config");

  const sourcesRaw = config["sources"];
  if (!Array.isArray(sourcesRaw) || sourcesRaw.length === 0) {
    throw new ConfigValidationError("sources must be a non-empty array");
  }

  const sources = sourcesRaw.map((source, index) => parseSource(source, index));

  const seenOutputs = new Set<string>();
  for (const source of sources) {
    if (seenOutputs.has(source.output)) {
      throw new ConfigValidationError(`Duplicate source output path: ${source.output}`);
    }
    seenOutputs.add(source.output);
  }

  const output = assertOptionalString(config["output"], "output") ?? "./docs";
  const concurrency = assertOptionalNumber(config["concurrency"], "concurrency");
  const retry = parseRetry(config["retry"]);
  const defaultExclude = assertStringArray(config["defaultExclude"], "defaultExclude");
  const defaultDateFilter = parseDateFilter(config["defaultDateFilter"], "defaultDateFilter");

  for (const selector of defaultExclude ?? []) {
    if (isNotionId(selector)) {
      throw new ConfigValidationError(
        `defaultExclude does not support Notion id selectors (only title-path globs): ${selector}`
      );
    }
  }

  return {
    output,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(retry !== undefined ? { retry } : {}),
    ...(defaultExclude !== undefined ? { defaultExclude } : {}),
    ...(defaultDateFilter !== undefined ? { defaultDateFilter } : {}),
    sources,
  };
}
