/**
 * Validated, typed env for Workers, built on @t3-oss/env-core.
 *
 * On Workers, vars and secrets arrive on the `env` binding (wrangler.jsonc
 * `vars`, `wrangler secret put`, and `.env.local` locally), not on
 * process.env, and only inside a handler. So an app declares its schema once
 * with `defineEnv`, and the returned getter validates on first use and caches
 * the result for the life of the isolate. A missing or malformed variable
 * fails loudly on the first request instead of at whichever request first
 * needs it. Bindings (D1, KV, R2) are not validated here; their types come
 * from `wrangler types`.
 *
 * Two deliberate departures from t3's defaults, both found in its source:
 *   - It is handed a copy holding only the schema's keys, never the `env`
 *     binding itself, because `emptyStringAsUndefined` deletes keys from the
 *     object it is given.
 *   - Its default error handler logs the raw issues with console.error. Ours
 *     throws an EnvValidationError that names each variable and what is wrong
 *     with it, and never includes a value, since the values are secrets.
 */

import { env as workerEnv } from "cloudflare:workers";
import type { StandardSchemaV1 } from "@t3-oss/env-core";
import { createEnv } from "@t3-oss/env-core";

type Schema = Record<string, StandardSchemaV1>;
type Parsed<T extends Schema> = {
  readonly [K in keyof T]: StandardSchemaV1.InferOutput<T[K]>;
};
type RuntimeEnv = Record<string, string | number | boolean | undefined>;

/** Thrown for invalid env. Its message lists variable names, never values. */
export class EnvValidationError extends Error {
  readonly variables: readonly string[];

  constructor(problems: readonly { variable: string; message: string }[]) {
    super(
      `Invalid environment variables:\n${problems
        .map((p) => `  ${p.variable}: ${p.message}`)
        .join("\n")}`,
    );
    this.name = "EnvValidationError";
    this.variables = problems.map((p) => p.variable);
  }
}

function pathKey(segment: PropertyKey | StandardSchemaV1.PathSegment): string {
  return String(typeof segment === "object" ? segment.key : segment);
}

/**
 * Validates `source` against `schema`. Exported for tests and for code that
 * has an env object in hand (a scheduled handler's `env` argument);
 * request code uses the getter from `defineEnv`.
 */
export function parseEnv<T extends Schema>(
  schema: T,
  source: Readonly<Record<string, unknown>>,
): Parsed<T> {
  const runtimeEnv: RuntimeEnv = {};
  for (const key of Object.keys(schema)) {
    const value = source[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      runtimeEnv[key] = value;
    }
  }
  return createEnv({
    server: schema,
    runtimeEnv,
    isServer: true,
    emptyStringAsUndefined: true,
    onValidationError: (issues) => {
      throw new EnvValidationError(
        issues.map((issue) => ({
          variable: issue.path?.map(pathKey).join(".") ?? "(env)",
          message: issue.message,
        })),
      );
    },
  }) as Parsed<T>;
}

/**
 * Declares an app's env schema and returns its getter:
 *
 *     export const getEnv = defineEnv({ APP_BASE_URL: z.url() });
 *     // in a handler:
 *     const { APP_BASE_URL } = getEnv();
 *
 * Call the getter only inside a handler, where bindings exist.
 */
export function defineEnv<T extends Schema>(schema: T): () => Parsed<T> {
  let parsed: Parsed<T> | undefined;
  return () => {
    parsed ??= parseEnv(schema, workerEnv as Record<string, unknown>);
    return parsed;
  };
}
