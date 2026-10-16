/**
 * Rewrites an app's wrangler.jsonc for one Pulumi stack (sync-env.ts).
 *
 * The committed configs carry the dev stack's resource names and placeholder
 * ids, which is all local development needs. A deploy rewrites, from the
 * stack's outputs:
 *
 *   - `name`: `<resourcePrefix>-<app>` (flareling-prod-web), so dev and prod,
 *     which share an account, are different Workers.
 *   - D1: `database_id` and `database_name` of each known binding.
 *   - Queues: producer, consumer and dead-letter queue names.
 *   - Rate Limiting: `namespace_id`, which is account-wide, so a shared one
 *     would share counters between stacks.
 *   - Vars that differ per stack (the app's URL, the passkey RP ID, the
 *     sender address), wherever a config declares them.
 *   - Cron Triggers: removed (an empty list, which also unschedules any
 *     already deployed). Workers Free allows 5 per account and the account's
 *     other projects use 4 (docs/adr/0020-target-workers-free.md). Flip
 *     DEPLOY_CRONS when that changes.
 *
 * It fails closed. A binding it doesn't know, or a top-level key it hasn't
 * been taught about, is an error rather than something deployed pointing at
 * dev's resources. Teach it here when adding a binding.
 *
 * Edits go through jsonc-parser, so comments and formatting survive.
 */
import {
  applyEdits,
  type FormattingOptions,
  type JSONPath,
  modify,
  type ParseError,
  parse,
  printParseErrorCode,
} from "jsonc-parser";

/** The Pulumi outputs (infra/cloudflare/index.ts) a deploy needs. */
export interface StackOutputs {
  readonly resourcePrefix: string;
  readonly d1DatabaseId: string;
  readonly d1DatabaseName: string;
  readonly jobsQueueName: string;
  readonly jobsDeadLetterQueueName: string;
  readonly authRateLimitNamespaceId: number;
  readonly webBaseUrl: string;
  readonly webauthnRpId: string;
  readonly emailFrom: string;
  /** "1" on a stack with the dev outbox (empty otherwise), and its Access app. */
  readonly emailOutbox: string;
  readonly accessTeamDomain: string;
  readonly accessOutboxAud: string;
}

export const OUTPUT_KEYS = {
  resourcePrefix: "string",
  d1DatabaseId: "string",
  d1DatabaseName: "string",
  jobsQueueName: "string",
  jobsDeadLetterQueueName: "string",
  authRateLimitNamespaceId: "number",
  webBaseUrl: "string",
  webauthnRpId: "string",
  emailFrom: "string",
  emailOutbox: "string?",
  accessTeamDomain: "string?",
  accessOutboxAud: "string?",
} as const satisfies Record<
  keyof StackOutputs,
  "string" | "string?" | "number"
>;

/** D1 bindings, by binding name. */
const D1: Record<string, (o: StackOutputs) => { id: string; name: string }> = {
  DB: (o) => ({ id: o.d1DatabaseId, name: o.d1DatabaseName }),
};

/** Queues, by the dev stack's name as committed. */
const QUEUES: Record<string, (o: StackOutputs) => string> = {
  "flareling-dev-jobs": (o) => o.jobsQueueName,
  "flareling-dev-jobs-dlq": (o) => o.jobsDeadLetterQueueName,
};

/** Rate Limiting bindings, by binding name. */
const RATE_LIMITS: Record<string, (o: StackOutputs) => number> = {
  AUTH_RATE_LIMITER: (o) => o.authRateLimitNamespaceId,
};

/** Per-stack vars, by name, set wherever a config declares them. */
const VARS: Record<string, (o: StackOutputs) => string> = {
  APP_BASE_URL: (o) => o.webBaseUrl,
  WEBAUTHN_RP_ID: (o) => o.webauthnRpId,
  EMAIL_FROM: (o) => o.emailFrom,
  EMAIL_OUTBOX: (o) => o.emailOutbox,
  ACCESS_TEAM_DOMAIN: (o) => o.accessTeamDomain,
  ACCESS_OUTBOX_AUD: (o) => o.accessOutboxAud,
};

/** Whether deployed Workers keep their Cron Triggers (see the module doc). */
const DEPLOY_CRONS = false;

/**
 * Top-level keys that hold nothing per-stack, or that are handled above. Any
 * other key (kv_namespaces, r2_buckets, services, env, ...) stops the sync
 * until someone decides how it maps.
 */
const KNOWN_KEYS = new Set([
  "$schema",
  "name",
  "compatibility_date",
  "compatibility_flags",
  "limits",
  "main",
  "workers_dev",
  "preview_urls",
  "observability",
  "vars",
  "triggers",
  "d1_databases",
  "queues",
  "ratelimits",
]);

const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

const FORMATTING: FormattingOptions = { insertSpaces: true, tabSize: 2 };

interface WranglerConfig {
  readonly [key: string]: unknown;
  readonly vars?: Readonly<Record<string, unknown>>;
  readonly triggers?: { readonly crons?: readonly string[] };
  readonly d1_databases?: readonly { binding: string }[];
  readonly queues?: {
    readonly producers?: readonly { queue: string }[];
    readonly consumers?: readonly {
      queue: string;
      dead_letter_queue?: string;
    }[];
  };
  readonly ratelimits?: readonly { name: string }[];
}

export class SyncError extends Error {
  override name = "SyncError";
}

/**
 * `text` (an app's wrangler.jsonc) rewritten for the stack in `outputs`.
 * `app` is the directory name under apps/ (web, jobs).
 */
export function syncWranglerConfig(
  text: string,
  app: string,
  outputs: StackOutputs,
): string {
  const errors: ParseError[] = [];
  const config = parse(text, errors, {
    allowTrailingComma: true,
  }) as WranglerConfig;
  if (errors.length > 0) {
    const codes = errors.map(
      (e) => `${printParseErrorCode(e.error)} at ${e.offset}`,
    );
    throw new SyncError(
      `${app}: wrangler.jsonc doesn't parse: ${codes.join(", ")}`,
    );
  }

  const unknown = Object.keys(config).filter((k) => !KNOWN_KEYS.has(k));
  if (unknown.length > 0) {
    throw new SyncError(
      `${app}: sync-env doesn't know whether ${unknown.join(", ")} is per stack. Teach tooling/scripts/src/wrangler-env.ts.`,
    );
  }

  const changes: [JSONPath, string | number | never[]][] = [
    [["name"], `${outputs.resourcePrefix}-${app}`],
  ];
  const lookup = <T>(
    table: Record<string, (o: StackOutputs) => T>,
    key: string,
    what: string,
  ) => {
    const map = table[key];
    if (!map) {
      throw new SyncError(
        `${app}: no stack output for ${what} "${key}". Teach tooling/scripts/src/wrangler-env.ts.`,
      );
    }
    return map(outputs);
  };

  config.d1_databases?.forEach((db, i) => {
    const target = lookup(D1, db.binding, "the D1 binding");
    changes.push([["d1_databases", i, "database_id"], target.id]);
    changes.push([["d1_databases", i, "database_name"], target.name]);
  });
  config.queues?.producers?.forEach((p, i) => {
    changes.push([
      ["queues", "producers", i, "queue"],
      lookup(QUEUES, p.queue, "the queue"),
    ]);
  });
  config.queues?.consumers?.forEach((c, i) => {
    changes.push([
      ["queues", "consumers", i, "queue"],
      lookup(QUEUES, c.queue, "the queue"),
    ]);
    if (c.dead_letter_queue !== undefined) {
      changes.push([
        ["queues", "consumers", i, "dead_letter_queue"],
        lookup(QUEUES, c.dead_letter_queue, "the queue"),
      ]);
    }
  });
  config.ratelimits?.forEach((r, i) => {
    changes.push([
      ["ratelimits", i, "namespace_id"],
      String(lookup(RATE_LIMITS, r.name, "the rate limiter")),
    ]);
  });

  for (const name of Object.keys(config.vars ?? {})) {
    const map = VARS[name];
    if (map) changes.push([["vars", name], map(outputs)]);
  }
  if (!DEPLOY_CRONS && config.triggers?.crons !== undefined) {
    changes.push([["triggers", "crons"], []]);
  }

  let result = text;
  for (const [path, value] of changes) {
    result = applyEdits(
      result,
      modify(result, path, value, { formattingOptions: FORMATTING }),
    );
  }
  if (result.includes(PLACEHOLDER_ID)) {
    throw new SyncError(`${app}: a placeholder id is left after syncing.`);
  }
  return result;
}

/** Validates `pulumi stack output --json`, naming every missing or wrong key. */
export function parseStackOutputs(json: unknown): StackOutputs {
  if (typeof json !== "object" || json === null) {
    throw new SyncError(
      "Stack outputs must be a JSON object (pulumi stack output --json).",
    );
  }
  const record = json as Record<string, unknown>;
  // "string?" may be empty (a stack without that feature); others may not.
  const problems = Object.entries(OUTPUT_KEYS)
    .filter(([key, type]) =>
      type === "string?"
        ? typeof record[key] !== "string"
        : typeof record[key] !== type || record[key] === "",
    )
    .map(([key, type]) => `${key} (${type})`);
  if (problems.length > 0) {
    throw new SyncError(
      `Stack outputs are missing or malformed: ${problems.join(", ")}`,
    );
  }
  return record as unknown as StackOutputs;
}
