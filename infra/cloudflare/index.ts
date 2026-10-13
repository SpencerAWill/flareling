import { accountId, hostname, zone } from "./src/config.ts";
import {
  database,
  files,
  jobsDeadLetterQueue,
  jobsQueue,
  kv,
} from "./src/data.ts";

/**
 * Long-lived Cloudflare resources for one environment (the `dev` or `prod`
 * stack). Code deploys are Wrangler's job. This program owns everything that
 * outlives a deploy. See the "Infrastructure (Pulumi)" section of the README.
 *
 * The stack outputs below are the contract with Wrangler: the deploy workflow
 * reads them to fill in each app's placeholder binding IDs.
 */

export const cloudflareAccountId = accountId;
export const zoneName = zone.name;
export const baseHostname = hostname;

export const d1DatabaseId = database.uuid;
export const d1DatabaseName = database.name;
export const kvNamespaceId = kv.id;
export const r2FilesBucketName = files.name;
export const jobsQueueName = jobsQueue.queueName;
export const jobsDeadLetterQueueName = jobsDeadLetterQueue.queueName;
