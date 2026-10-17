import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import { accountId, hostname, resourcePrefix } from "./config.ts";

/**
 * The Turnstile widget on apps/web's sign-in form, one per stack. Not a
 * zone setting: a widget is an account resource that names the hostnames it
 * accepts tokens from, so it touches nothing else in the shared zone.
 *
 * `managed`: Cloudflare shows an interactive challenge only when its risk
 * score for the visitor is high; most people pass without seeing one.
 *
 * The deploy action (.github/actions/deploy) passes the site key to apps/web as the TURNSTILE_SITE_KEY var
 * (the sign-in page reads it from the server at runtime) and uploads the
 * secret as TURNSTILE_SECRET_KEY. Local development leaves both unset, which
 * skips the check (libs/auth's passesTurnstile).
 */
const widget = new cloudflare.TurnstileWidget("sign-in-turnstile", {
  accountId,
  name: `${resourcePrefix}-web sign-in`,
  domains: [hostname],
  mode: "managed",
});

export const turnstileSiteKey = widget.sitekey;
/** Encrypted in state; `pulumi stack output --show-secrets` reveals it. */
export const turnstileSecretKey = pulumi.secret(widget.secret);
