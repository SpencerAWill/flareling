import { webauthnRpId, webBaseUrl, webDomain } from "./src/apps.ts";
import {
  accountId,
  authRateLimitNamespaceId,
  hostname,
  resourcePrefix,
  zone,
} from "./src/config.ts";
import {
  database,
  files,
  jobsDeadLetterQueue,
  jobsQueue,
  kv,
} from "./src/data.ts";
import { emailFrom, resendApiKey } from "./src/email.ts";
import {
  accessOutboxAud,
  accessTeamDomain,
  emailOutboxEnabled,
} from "./src/outbox.ts";
import { turnstileSecretKey, turnstileSiteKey } from "./src/turnstile.ts";

/**
 * Long-lived Cloudflare resources for one environment (the `dev` or `prod`
 * stack). Code deploys are Wrangler's job. This program owns everything that
 * outlives a deploy. See the "Infrastructure (Pulumi)" section of the README.
 *
 * The stack outputs below are the contract with Wrangler: the deploy workflow
 * passes them (`pulumi stack output --json`) to tooling/scripts' sync-env,
 * which rewrites each app's wrangler.jsonc for this stack. Renaming one means
 * renaming it there too.
 */

export {
  authRateLimitNamespaceId,
  emailFrom,
  resourcePrefix,
  webauthnRpId,
  webBaseUrl,
};
export const webDomainId = webDomain?.id;
export {
  accessOutboxAud,
  accessTeamDomain,
  resendApiKey,
  turnstileSecretKey,
  turnstileSiteKey,
};
/** "1" turns apps/web's outbox transport on (sync-env's EMAIL_OUTBOX). */
export const emailOutbox = emailOutboxEnabled ? "1" : "";

export const cloudflareAccountId = accountId;
export const zoneName = zone.name;
export const baseHostname = hostname;

export const d1DatabaseId = database.uuid;
export const d1DatabaseName = database.name;
export const kvNamespaceId = kv.id;
export const r2FilesBucketName = files.name;
export const jobsQueueName = jobsQueue.queueName;
export const jobsDeadLetterQueueName = jobsDeadLetterQueue.queueName;
