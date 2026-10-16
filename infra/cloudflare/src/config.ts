import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

export const accountId = config.require("accountId");

/** Prefix for every resource name, e.g. `flareling-dev`. */
export const resourcePrefix = config.require("resourcePrefix");

/**
 * Mark stateful resources (D1, R2, KV, Queues) with `protect`, so no plan can
 * delete them until the flag is removed. On in prod, off in dev.
 */
export const protectData = config.getBoolean("protectData") ?? true;

/**
 * The zone this suite's hostnames live in. It is shared with other projects
 * (www.spencerwill.com and ucmc.spencerwill.com write to the same zone), so
 * this program must only ever declare its own hostnames: never ZoneSetting,
 * WAF, or other zone-wide resources, which would change behavior for every
 * site in the zone.
 */
export const zone = {
  id: config.require("zoneId"),
  name: config.require("zoneName"),
};

/**
 * Base hostname for this stack. Apps get subdomains of it once they exist
 * (for example `app.<hostname>`), declared as WorkersCustomDomain resources
 * after the app's first Wrangler deploy.
 */
export const hostname = config.require("hostname");

/**
 * The Rate Limiting namespace id the apps' AUTH_RATE_LIMITER uses in this
 * stack. Namespace ids are account-wide, and Workers that share one share
 * counters, so dev and prod (same account) need different ones. Not a
 * resource: Wrangler creates the namespace on deploy; this only picks its id.
 */
export const authRateLimitNamespaceId = config.requireNumber(
  "authRateLimitNamespaceId",
);

/**
 * Whether apps/web's Worker (`<resourcePrefix>-web`) has been deployed in
 * this stack yet. A custom domain can only point at a Worker that exists, so
 * a new stack's first deploy runs with this off; set it to true afterwards
 * and the next `pulumi up` attaches `hostname` to the Worker.
 */
export const webDeployed = config.getBoolean("webDeployed") ?? false;

/** The address sign-in emails come from. Depends on the email provider. */
export const emailFrom = config.get("emailFrom") ?? `noreply@${hostname}`;
