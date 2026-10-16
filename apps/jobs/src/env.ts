import { defineEnv, logLevel } from "@flareling/env";
import { z } from "zod";

/**
 * This Worker's vars and secrets. Billing is optional: with no Stripe key,
 * Stripe messages fail (and end in the dead-letter queue) rather than the
 * whole Worker, so jobs that don't need Stripe keep running.
 */
export const getEnv = defineEnv({
  LOG_LEVEL: logLevel,
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  /** Local development and tests: stripe-mock (`http://stripe-mock:12111`). */
  STRIPE_API_BASE: z.url().optional(),
});
