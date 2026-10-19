/**
 * Starting a subscription (Stripe Checkout) and managing one (the Customer
 * Portal). Both are Stripe-hosted pages: card details never touch this app.
 * Only a workspace's owners and admins may use them.
 */
import type { Principal } from "@flareling/auth";
import { requireWorkspaceRole } from "@flareling/core";
import { getDb, schema } from "@flareling/db";
import { eq } from "drizzle-orm";
import { type BillingInterval, type PaidPlanName, PLANS } from "./plans.ts";
import type { Stripe } from "./stripe.ts";

const { billingCustomers, workspaces } = schema;

export interface BillingContext {
  readonly stripe: Stripe;
  /** The app's origin, for Stripe's return URLs. */
  readonly appBaseUrl: string;
}

/**
 * The workspace's billing page, where Stripe sends people back to. Its URL
 * uses the workspace's public id, as every page URL does.
 */
async function billingUrl(
  ctx: BillingContext,
  workspaceId: string,
  query = "",
): Promise<string> {
  const [workspace] = await getDb()
    .select({ publicId: workspaces.publicId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!workspace) throw new Error("workspace vanished after the role check");
  return new URL(
    `/w/${workspace.publicId}/billing${query}`,
    ctx.appBaseUrl,
  ).toString();
}

/**
 * The workspace's Stripe customer, created on first use. The idempotency key
 * makes a retried or concurrent first call create one customer, and the
 * primary key on billing_customers makes only one row stick.
 */
async function ensureCustomer(
  stripe: Stripe,
  workspaceId: string,
): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ id: billingCustomers.stripeCustomerId })
    .from(billingCustomers)
    .where(eq(billingCustomers.workspaceId, workspaceId));
  if (existing) return existing.id;

  const customer = await stripe.customers.create(
    { metadata: { workspace_id: workspaceId } },
    { idempotencyKey: `customer-${workspaceId}` },
  );
  await db
    .insert(billingCustomers)
    .values({ workspaceId, stripeCustomerId: customer.id })
    .onConflictDoNothing();
  const [stored] = await db
    .select({ id: billingCustomers.stripeCustomerId })
    .from(billingCustomers)
    .where(eq(billingCustomers.workspaceId, workspaceId));
  return stored?.id ?? customer.id;
}

/** A Stripe Checkout URL to subscribe the workspace to `plan`. */
export async function startCheckout(
  ctx: BillingContext,
  principal: Principal | null,
  input: {
    readonly workspaceId: string;
    readonly plan: PaidPlanName;
    readonly interval: BillingInterval;
  },
): Promise<string> {
  await requireWorkspaceRole(principal, input.workspaceId, "admin");
  const lookupKey = PLANS[input.plan].prices[input.interval];
  const prices = await ctx.stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) {
    throw new Error(`No active Stripe price has the lookup key ${lookupKey}.`);
  }

  const customer = await ensureCustomer(ctx.stripe, input.workspaceId);
  const session = await ctx.stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: input.workspaceId,
    // Carried onto the subscription, so its events name their workspace.
    subscription_data: { metadata: { workspace_id: input.workspaceId } },
    success_url: await billingUrl(ctx, input.workspaceId, "?checkout=success"),
    cancel_url: await billingUrl(ctx, input.workspaceId),
  });
  if (!session.url)
    throw new Error("Stripe returned a Checkout session with no URL.");
  return session.url;
}

/** A Stripe Customer Portal URL to change plan, update payment, or cancel. */
export async function openBillingPortal(
  ctx: BillingContext,
  principal: Principal | null,
  workspaceId: string,
): Promise<string> {
  await requireWorkspaceRole(principal, workspaceId, "admin");
  const customer = await ensureCustomer(ctx.stripe, workspaceId);
  const session = await ctx.stripe.billingPortal.sessions.create({
    customer,
    return_url: await billingUrl(ctx, workspaceId),
  });
  return session.url;
}
