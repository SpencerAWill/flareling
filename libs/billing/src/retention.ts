import { type DeleteBeforeResult, deleteBefore, schema } from "@flareling/db";

const { stripeEvents } = schema;

/**
 * How long a processed event's id is kept, for skipping redeliveries. Stripe
 * retries a webhook for up to 3 days, and keeps events retrievable for 30,
 * which is also as far back as anyone can replay one.
 */
const STRIPE_EVENT_RETENTION_DAYS = 30;

/** Forgets processed Stripe event ids older than any redelivery or replay. */
export async function sweepStripeEvents(
  now: Date,
): Promise<DeleteBeforeResult> {
  const cutoff = new Date(
    now.getTime() - STRIPE_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  return deleteBefore(stripeEvents, stripeEvents.processedAt, cutoff);
}
