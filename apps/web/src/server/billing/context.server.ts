import type { BillingContext } from "@flareling/billing";
import { createStripe } from "@flareling/billing";
import { getEnv } from "#/env.ts";

/** libs/billing's context from the env, or null when billing is off. */
export function billingContext(): BillingContext | null {
  const vars = getEnv();
  if (!vars.STRIPE_SECRET_KEY) return null;
  return {
    stripe: createStripe({
      secretKey: vars.STRIPE_SECRET_KEY,
      apiBase: vars.STRIPE_API_BASE,
    }),
    appBaseUrl: vars.APP_BASE_URL,
  };
}
