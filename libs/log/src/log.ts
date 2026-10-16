/**
 * Structured logging for every Worker: the one place server code calls
 * `console.*` (Biome's noConsole allows it here only).
 *
 * Workers Logs is the transport, not a library. The platform ingests
 * `console.*` directly: the method name becomes the level, and an object
 * passed as the second argument becomes fields you can query in the
 * dashboard. A logging library would end up as a console shim that costs
 * bundle size, so there isn't one. What this adds over bare `console.*`:
 *
 *   - Levels with a runtime threshold (`LOG_LEVEL`), so `log.debug` lines can
 *     stay in the code and out of production logs.
 *   - Ambient context, so a request's Ray ID lands on every line without being
 *     passed through every function that might log.
 *   - Redaction by default for error messages (`errorMessage`).
 *
 * Event names are `namespace.event_in_snake_case` (`audit.write_failed`). They
 * are what you filter on, so treat them as stable identifiers; details go in
 * the fields. Fields carry non-PII context only, and anything that might hold
 * user data goes through ./redact.ts first.
 *
 * Ported from ucmc.spencerwill.com's log.server.ts.
 */

import { env } from "cloudflare:workers";
import { AsyncLocalStorage } from "node:async_hooks";
import { redactString } from "./redact.ts";

/** Structured context for a log line. Non-PII; see the module note. */
export type LogFields = Record<string, unknown>;

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const threshold: { rank?: number } = {};

/**
 * Lines below the threshold are dropped. `LOG_LEVEL` is an optional var, unset
 * by default, so debug logging can be turned on for one deployed Worker during
 * an incident without a code change. Resolved on first use rather than at
 * module scope, because bindings exist only inside a handler, and defensively,
 * because not every context that imports this has them.
 */
function thresholdRank(): number {
  threshold.rank ??= LEVEL_RANK[configuredLevel()];
  return threshold.rank;
}

function configuredLevel(): LogLevel {
  try {
    const raw = (env as { LOG_LEVEL?: string }).LOG_LEVEL;
    if (raw && raw in LEVEL_RANK) {
      return raw as LogLevel;
    }
  } catch {
    // No binding context. `info` is the right answer there too.
  }
  return "info";
}

// AsyncLocalStorage survives an `await` in workerd under nodejs_compat
// (pinned in log.test.ts).
const logContext = new AsyncLocalStorage<LogFields>();

/**
 * Runs `fn` with `fields` added to every line it logs, directly or through
 * anything it awaits. Nested calls merge onto the outer fields.
 */
export function runWithLogContext<T>(fields: LogFields, fn: () => T): T {
  return logContext.run({ ...logContext.getStore(), ...fields }, fn);
}

/**
 * An `unknown` from a `catch`, as a string that is safe to log. Always
 * redacted: a raw `err.message` is fine until it's a D1 constraint error
 * echoing a row, or a fetch failure carrying a URL with a token in it.
 */
export function errorMessage(err: unknown): string {
  return redactString(err instanceof Error ? err.message : String(err));
}

function emit(level: LogLevel, event: string, fields: LogFields): void {
  if (LEVEL_RANK[level] < thresholdRank()) {
    return;
  }
  // The level maps to the same-named method, which is how Workers Logs
  // derives a line's level. workerd implements all four (pinned in the tests,
  // since console.debug is the one people assume is missing).
  console[level](event, { ...logContext.getStore(), ...fields });
}

/**
 * `log.error("audit.write_failed", { ... })`. One object rather than four
 * functions, so levels nobody uses yet aren't dead exports.
 */
export const log = {
  debug: (event: string, fields: LogFields = {}) =>
    emit("debug", event, fields),
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}) =>
    emit("error", event, fields),
};
