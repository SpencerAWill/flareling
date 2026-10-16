import { defineEnv, logLevel } from "@flareling/env";

/**
 * This app's vars and secrets, validated on the first request of each isolate
 * (see src/start.ts). Add a variable here, document it in .env.example, and
 * set it in wrangler.jsonc `vars` or as a secret. Read it in a handler with
 * `getEnv().NAME`.
 */
export const getEnv = defineEnv({
  LOG_LEVEL: logLevel,
});
