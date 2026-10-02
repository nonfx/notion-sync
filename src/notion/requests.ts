import { APIErrorCode, ClientErrorCode, isNotionClientError } from "@notionhq/client";
import { log } from "../utils/logger.ts";

export const DEFAULT_REQUEST_CONCURRENCY = 2;
export const DEFAULT_REQUEST_INTERVAL_MS = 334;
export const DEFAULT_RETRY_ATTEMPTS = 5;

let concurrency = DEFAULT_REQUEST_CONCURRENCY;
let minIntervalMs = DEFAULT_REQUEST_INTERVAL_MS;
let retryAttempts = DEFAULT_RETRY_ATTEMPTS;
let active = 0;
let nextStart = 0;
let cooldownUntil = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const queue: Array<() => void> = [];

export function setRequestLimits(limits: { concurrency: number; minIntervalMs: number }): void {
  if (!Number.isFinite(limits.concurrency) || limits.concurrency <= 0) {
    throw new Error("Request concurrency must be a positive finite number");
  }
  if (!Number.isFinite(limits.minIntervalMs) || limits.minIntervalMs < 0) {
    throw new Error("Request interval must be a nonnegative finite number");
  }
  concurrency = Math.ceil(limits.concurrency);
  minIntervalMs = limits.minIntervalMs;
  drain();
}

export function resetRequestLimits(): void {
  setRequestLimits({
    concurrency: DEFAULT_REQUEST_CONCURRENCY,
    minIntervalMs: DEFAULT_REQUEST_INTERVAL_MS,
  });
}

export function setRetryAttempts(attempts: number): void {
  retryAttempts = attempts;
}

export function resetRetryAttempts(): void {
  retryAttempts = DEFAULT_RETRY_ATTEMPTS;
}

function drain(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  while (active < concurrency && queue.length > 0) {
    const delay = Math.max(nextStart, cooldownUntil) - performance.now();
    if (delay > 0) {
      timer = setTimeout(drain, Math.ceil(delay));
      return;
    }
    active++;
    nextStart = performance.now() + minIntervalMs;
    queue.shift()!();
  }
}

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      void (async () => {
        try {
          return await fn();
        } finally {
          active--;
          drain();
        }
      })().then(resolve, reject);
    });
    drain();
  });
}

function isRateLimited(error: unknown): boolean {
  return (
    (error instanceof Error &&
      (error.message.includes("rate limited") || error.message.includes("429"))) ||
    (typeof error === "object" && error !== null && "status" in error && error.status === 429)
  );
}

// Socket-level failures carry an errno code from Node, Bun or node-fetch. A
// sync makes hundreds of requests, so one dropped connection is expected and
// must not abort the run.
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_API_CODES = new Set<string>([
  APIErrorCode.InternalServerError,
  APIErrorCode.ServiceUnavailable,
  ClientErrorCode.RequestTimeout,
]);

/** Failures that say nothing about the request itself, so a retry can succeed. */
function isTransient(error: unknown): boolean {
  if (isNotionClientError(error)) {
    return (
      TRANSIENT_API_CODES.has(error.code) ||
      ("status" in error && typeof error.status === "number" && error.status >= 500)
    );
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    TRANSIENT_NETWORK_CODES.has(error.code)
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function retryDelay(error: unknown, attempt: number): number {
  if (typeof error === "object" && error !== null && "headers" in error) {
    const headers = error.headers as { get?: (name: string) => string | null } | undefined;
    const value = headers?.get?.("retry-after");
    if (value !== undefined && value !== null) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    }
  }
  return 1000 * Math.pow(2, attempt);
}

/**
 * Retries rate limits, which Notion rejects before doing any work. An
 * idempotent request also retries transient failures. A write is not retried
 * after one: the server may have committed it before the response was lost,
 * and a repeat would duplicate the page or blocks. Every attempt joins the
 * shared queue. Backoff holds no request slot.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { idempotent = false }: { idempotent?: boolean } = {}
): Promise<T> {
  const maxRetries = retryAttempts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await schedule(async () => {
        try {
          return await fn();
        } catch (error) {
          if (isRateLimited(error)) {
            const delay = retryDelay(error, attempt);
            // Publish the cooldown before releasing the slot to another request.
            cooldownUntil = Math.max(cooldownUntil, performance.now() + delay);
            if (attempt < maxRetries) {
              log.warn(
                `Rate limited, retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`
              );
            }
          }
          throw error;
        }
      });
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      if (isRateLimited(error)) continue;
      if (!idempotent || !isTransient(error)) throw error;
      // Back off outside the queue: one flaky request must not stall the rest.
      const delay = retryDelay(error, attempt);
      log.warn(
        `${describeError(error)}; retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
