import { createHmac } from "node:crypto";

/** The webhook signing secret the local preview runs with (playwright.config.ts). */
export const STRIPE_WEBHOOK_SECRET = "whsec_e2e";

/** A `Stripe-Signature` header, built the way Stripe's docs describe. */
export function stripeSignature(
  payload: string,
  secret = STRIPE_WEBHOOK_SECRET,
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${v1}`;
}
