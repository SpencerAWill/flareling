/**
 * Stripe webhooks, in two halves:
 *
 *   1. The web app's webhook route calls `verifyWebhook`, enqueues the
 *      event's id and type, and answers 200 at once. Stripe wants a fast 2xx,
 *      and retries otherwise.
 *   2. The jobs Worker's queue consumer calls `processStripeEvent` with retries
 *      and a dead-letter queue behind it.
 *
 * Processing trusts nothing but the event id. It fetches the event and then
 * the subscription from Stripe and writes that, the latest state, so events
 * that arrive late, twice or out of order can't regress a subscription. The
 * event id is recorded in the same batch as the write, and a recorded id is
 * skipped, which makes redelivery harmless.
 */
import { getDb, schema } from "@flareling/db";
import { log } from "@flareling/log";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { planForLookupKey } from "./plans.ts";
import { cryptoProvider, type Stripe } from "./stripe.ts";

const { billingCustomers, stripeEvents, subscriptions } = schema;

/**
 * What goes on the queue: the id is all processing needs. A schema, because
 * the consumer (apps/jobs) parses what it receives rather than trusting a
 * type: a producer from another version, or a message replayed by hand from
 * the dead-letter queue, fails at the door with the reason.
 */
export const stripeEventMessage = z.object({
  kind: z.literal("stripe.event"),
  id: z.string().startsWith("evt_"),
  type: z.string().min(1),
});

export type StripeEventMessage = z.infer<typeof stripeEventMessage>;

/**
 * The event, if `rawBody` carries a valid Stripe signature for `secret`
 * (within Stripe's default 5-minute tolerance); otherwise null. `rawBody` must
 * be the exact bytes received, so read it with `request.text()`.
 */
export async function verifyWebhook(
  stripe: Stripe,
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<StripeEventMessage | null> {
  if (!signature) return null;
  try {
    const event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      secret,
      undefined,
      cryptoProvider,
    );
    return { kind: "stripe.event", id: event.id, type: event.type };
  } catch {
    return null;
  }
}

/** Event types that change a subscription's state. */
const SUBSCRIPTION_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export type ProcessResult = "processed" | "duplicate" | "ignored";

export async function processStripeEvent(
  stripe: Stripe,
  message: StripeEventMessage,
  now: Date = new Date(),
): Promise<ProcessResult> {
  const db = getDb();
  const [seen] = await db
    .select({ id: stripeEvents.id })
    .from(stripeEvents)
    .where(eq(stripeEvents.id, message.id));
  if (seen) return "duplicate";

  const record = db
    .insert(stripeEvents)
    .values({ id: message.id, type: message.type, processedAt: now })
    .onConflictDoNothing();

  if (!SUBSCRIPTION_EVENTS.has(message.type)) {
    await record;
    return "ignored";
  }

  const event = await stripe.events.retrieve(message.id);
  const subscriptionId = subscriptionIdOf(event);
  if (!subscriptionId) {
    await record;
    return "ignored";
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const workspaceId = await workspaceOf(subscription);
  if (!workspaceId) {
    // Retrying won't help, and dropping it silently would hide a real
    // misconfiguration (a subscription made outside Checkout, say).
    log.error("billing.subscription_without_workspace", {
      eventId: message.id,
      subscriptionId,
    });
    await record;
    return "ignored";
  }

  const item = subscription.items.data[0];
  const lookupKey = item?.price.lookup_key ?? null;
  const plan = planForLookupKey(lookupKey);
  if (!plan) {
    log.warn("billing.unknown_price", { eventId: message.id, lookupKey });
  }
  const row = {
    stripeSubscriptionId: subscription.id,
    workspaceId,
    status: subscription.status,
    plan: plan ?? "unknown",
    stripePriceId: item?.price.id ?? "",
    currentPeriodEnd: item?.current_period_end
      ? new Date(item.current_period_end * 1000)
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    updatedAt: now,
  };
  await db.batch([
    db
      .insert(subscriptions)
      .values(row)
      .onConflictDoUpdate({
        target: subscriptions.stripeSubscriptionId,
        set: {
          status: sql`excluded.status`,
          plan: sql`excluded.plan`,
          stripePriceId: sql`excluded.stripe_price_id`,
          currentPeriodEnd: sql`excluded.current_period_end`,
          cancelAtPeriodEnd: sql`excluded.cancel_at_period_end`,
          updatedAt: sql`excluded.updated_at`,
        },
      }),
    record,
  ]);
  return "processed";
}

function subscriptionIdOf(event: Stripe.Event): string | undefined {
  const object = event.data.object as {
    object?: string;
    id?: string;
    subscription?: unknown;
  };
  if (object.object === "subscription") return object.id;
  if (
    object.object === "checkout.session" &&
    typeof object.subscription === "string"
  ) {
    return object.subscription;
  }
  return undefined;
}

async function workspaceOf(
  subscription: Stripe.Subscription,
): Promise<string | undefined> {
  const fromMetadata = subscription.metadata?.workspace_id;
  if (fromMetadata) return fromMetadata;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const [row] = await getDb()
    .select({ workspaceId: billingCustomers.workspaceId })
    .from(billingCustomers)
    .where(eq(billingCustomers.stripeCustomerId, customerId));
  return row?.workspaceId;
}
