import { defineEnv, logLevel } from "@flareling/env";
import { z } from "zod";

/**
 * This app's vars and secrets, validated on the first request of each isolate
 * (see src/start.ts). Add a variable here, document it in .env.example, and
 * set it in wrangler.jsonc `vars` or as a secret. Read it in a handler with
 * `getEnv().NAME`.
 */
const getVars = defineEnv({
  LOG_LEVEL: logLevel,
  /** The app's origin. Sign-in links, the passkey origin check and whether
   *  cookies are Secure all come from it, so it must match the real URL. */
  APP_BASE_URL: z.url(),
  /** The product name in emails and the passkey prompt. */
  APP_NAME: z.string().min(1),
  WEBAUTHN_RP_ID: z.string().min(1),
  EMAIL_FROM: z.email(),
  EMAIL_FROM_NAME: z.string().optional(),
  /** Local development: the Mailpit sidecar (`http://mailpit:8025`). */
  MAILPIT_URL: z.url().optional(),
  /** Turnstile on the sign-in form: the public site key the widget uses,
   *  and the secret the server verifies with. Set both or neither; unset
   *  skips the check (local only). */
  TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  /** Stripe billing (libs/billing). Set the key and the webhook signing
   *  secret together, or neither; unset turns billing off. */
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  /** Local development and tests: stripe-mock (`http://stripe-mock:12111`). */
  STRIPE_API_BASE: z.url().optional(),
  /** A deployed dev environment's email goes to /dev/outbox instead of
   *  being sent, behind Cloudflare Access (docs/adr/0022-dev-email-outbox.md).
   *  Set per stack by sync-env, with the Access organization's domain and the
   *  outbox application's audience tag, which the page verifies tokens for. */
  EMAIL_OUTBOX: z.literal("1").optional(),
  ACCESS_TEAM_DOMAIN: z.string().endsWith(".cloudflareaccess.com").optional(),
  ACCESS_OUTBOX_AUD: z.string().min(1).optional(),
  /** E2E suites only. libs/auth ignores it on https. */
  E2E_BYPASS_RATE_LIMIT: z.literal("1").optional(),
});

type Vars = ReturnType<typeof getVars>;

/**
 * Settings that are valid one by one but wrong together. A deployed (https)
 * environment with no email transport would accept every request and then
 * fail the first sign-in; failing here instead fails every request from the
 * first one, which the post-deploy smoke test catches.
 */
export function configurationProblems(
  vars: Pick<Vars, "APP_BASE_URL"> &
    Partial<
      Pick<
        Vars,
        | "MAILPIT_URL"
        | "TURNSTILE_SITE_KEY"
        | "TURNSTILE_SECRET_KEY"
        | "STRIPE_SECRET_KEY"
        | "STRIPE_WEBHOOK_SECRET"
        | "STRIPE_API_BASE"
        | "EMAIL_OUTBOX"
        | "ACCESS_TEAM_DOMAIN"
        | "ACCESS_OUTBOX_AUD"
      >
    >,
): string[] {
  const problems: string[] = [];
  // A secret without a site key means the form never sends a token, so every
  // sign-in request is refused, silently by design.
  if (Boolean(vars.TURNSTILE_SITE_KEY) !== Boolean(vars.TURNSTILE_SECRET_KEY)) {
    problems.push(
      "Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY together, or neither.",
    );
  }
  // A key without the webhook secret would take payments and never record
  // them; a webhook secret without a key could verify events but not fetch them.
  if (Boolean(vars.STRIPE_SECRET_KEY) !== Boolean(vars.STRIPE_WEBHOOK_SECRET)) {
    problems.push(
      "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET together, or neither.",
    );
  }
  const deployed = vars.APP_BASE_URL.startsWith("https://");
  if (deployed && !vars.MAILPIT_URL && !vars.EMAIL_OUTBOX) {
    problems.push(
      "No email transport is configured, so nobody could sign in. Choose a provider (docs/adr/0015-email-behind-an-interface.md).",
    );
  }
  // The outbox holds working sign-in links; without Access's settings the
  // page can't check who is reading them, so it would refuse everyone.
  if (
    vars.EMAIL_OUTBOX &&
    !(vars.ACCESS_TEAM_DOMAIN && vars.ACCESS_OUTBOX_AUD)
  ) {
    problems.push(
      "EMAIL_OUTBOX needs ACCESS_TEAM_DOMAIN and ACCESS_OUTBOX_AUD (docs/adr/0022-dev-email-outbox.md).",
    );
  }
  if (deployed && vars.MAILPIT_URL) {
    problems.push("MAILPIT_URL is for local development only.");
  }
  if (deployed && vars.STRIPE_API_BASE) {
    problems.push("STRIPE_API_BASE is for local development only.");
  }
  return problems;
}

let checked = false;

/** The validated env. Throws on the first request if it's misconfigured. */
export function getEnv(): Vars {
  const vars = getVars();
  if (!checked) {
    const problems = configurationProblems(vars);
    if (problems.length > 0) {
      throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
    }
    checked = true;
  }
  return vars;
}
