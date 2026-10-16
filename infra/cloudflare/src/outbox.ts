import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import { accountId, hostname, resourcePrefix } from "./config.ts";

/**
 * The dev email outbox (docs/adr/0022-dev-email-outbox.md): apps/web stores
 * email in D1 instead of sending it and lists it at /dev/outbox, which a
 * Cloudflare Access application restricts to `outboxViewers`. The page also
 * verifies Access's token itself (issuer `accessTeamDomain`, audience this
 * application's tag), so a misconfigured policy still doesn't expose it.
 *
 * Never in prod: the outbox holds working sign-in links.
 */
const config = new pulumi.Config();

export const emailOutboxEnabled = config.getBoolean("emailOutbox") ?? false;

if (emailOutboxEnabled && pulumi.getStack() === "prod") {
  throw new Error(
    "emailOutbox is for dev only: it stores working sign-in links in D1.",
  );
}

const viewers = emailOutboxEnabled
  ? config.requireObject<string[]>("outboxViewers")
  : [];
if (emailOutboxEnabled && viewers.length === 0) {
  throw new Error("emailOutbox needs at least one address in outboxViewers.");
}

/** `<team>.cloudflareaccess.com`, the Zero Trust organization's domain. */
export const accessTeamDomain = emailOutboxEnabled
  ? config.require("accessTeamDomain")
  : "";

const outboxApp = emailOutboxEnabled
  ? new cloudflare.ZeroTrustAccessApplication("outbox-access", {
      accountId,
      name: `${resourcePrefix}-web outbox`,
      type: "self_hosted",
      // The path and everything under it, on this stack's hostname only.
      domain: `${hostname}/dev/outbox`,
      sessionDuration: "24h",
      appLauncherVisible: false,
      policies: [
        {
          name: "outbox viewers",
          decision: "allow",
          precedence: 1,
          includes: viewers.map((email) => ({ email: { email } })),
        },
      ],
    })
  : undefined;

/** The Access application's audience tag, which the page checks tokens for. */
export const accessOutboxAud = outboxApp?.aud ?? pulumi.output("");
