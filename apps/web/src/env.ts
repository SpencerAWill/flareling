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
  /** Turnstile on the sign-in form. Unset skips the check (local only). */
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
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
  vars: Pick<Vars, "APP_BASE_URL"> & Partial<Pick<Vars, "MAILPIT_URL">>,
): string[] {
  const problems: string[] = [];
  const deployed = vars.APP_BASE_URL.startsWith("https://");
  if (deployed && !vars.MAILPIT_URL) {
    problems.push(
      "No email transport is configured, so nobody could sign in. Choose a provider (docs/adr/0015-email-behind-an-interface.md).",
    );
  }
  if (deployed && vars.MAILPIT_URL) {
    problems.push("MAILPIT_URL is for local development only.");
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
