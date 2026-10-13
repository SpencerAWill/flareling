import * as cloudflare from "@pulumi/cloudflare";
import { accountId, protectData, resourcePrefix } from "./config.ts";

/**
 * The baseline stateful resources every stack gets. All of them are free at
 * rest, so creating them before any app uses them costs nothing.
 *
 * Apps never reference these by ID in committed config. Wrangler configs carry
 * placeholder IDs that tooling/scripts/sync-env replaces with this stack's
 * outputs at deploy time.
 */
const opts = { protect: protectData };

/** Primary relational database. Migrations live in libs/db. */
export const database = new cloudflare.D1Database(
  "database",
  { accountId, name: resourcePrefix },
  opts,
);

/** Config, feature flags, and cached lookups. Eventually consistent. */
export const kv = new cloudflare.WorkersKvNamespace(
  "kv",
  { accountId, title: resourcePrefix },
  opts,
);

/**
 * Private object storage for uploads and exports. A public bucket behind a
 * cached custom domain is a separate resource, added when something needs it.
 */
export const files = new cloudflare.R2Bucket(
  "files",
  { accountId, name: `${resourcePrefix}-files` },
  opts,
);

/** Background work consumed by apps/jobs. */
export const jobsQueue = new cloudflare.Queue(
  "jobs-queue",
  { accountId, queueName: `${resourcePrefix}-jobs` },
  opts,
);

/**
 * Messages that exhaust their retries on the jobs queue. The link between the
 * two is set on the consumer (`dead_letter_queue` in apps/jobs' wrangler
 * config), not on the queue itself.
 */
export const jobsDeadLetterQueue = new cloudflare.Queue(
  "jobs-dead-letter-queue",
  { accountId, queueName: `${resourcePrefix}-jobs-dlq` },
  opts,
);
