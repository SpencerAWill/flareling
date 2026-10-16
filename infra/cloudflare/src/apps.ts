import * as cloudflare from "@pulumi/cloudflare";
import {
  accountId,
  hostname,
  resourcePrefix,
  webDeployed,
  zone,
} from "./config.ts";

/**
 * Per-app settings Wrangler doesn't own. Worker names follow sync-env's rule
 * (`<resourcePrefix>-<app>`, tooling/scripts/src/wrangler-env.ts).
 */
export const webWorkerName = `${resourcePrefix}-web`;

/** apps/web serves the stack's base hostname. */
export const webBaseUrl = `https://${hostname}`;

/**
 * Passkeys are bound to this. A passkey made in one stack doesn't work in the
 * other, and changing it later strands every passkey made under the old one.
 */
export const webauthnRpId = hostname;

/**
 * Only this hostname's DNS record and certificate, never zone-wide settings
 * (the zone is shared). Waits for the Worker to exist; see `webDeployed`.
 */
export const webDomain = webDeployed
  ? new cloudflare.WorkersCustomDomain("web-domain", {
      accountId,
      zoneId: zone.id,
      hostname,
      service: webWorkerName,
    })
  : undefined;
