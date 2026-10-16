import { defineEnv, logLevel } from "@flareling/env";
import { z } from "zod";

/**
 * This app's vars and secrets, validated on the first request of each isolate
 * (see src/start.ts). Add a variable here, document it in .env.example, and
 * set it in wrangler.jsonc `vars` or as a secret. Read it in a handler with
 * `getEnv().NAME`.
 */
export const getEnv = defineEnv({
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
