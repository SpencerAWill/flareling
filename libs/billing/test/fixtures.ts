import type { Principal } from "@flareling/auth";
import { ensurePersonalWorkspace } from "@flareling/core";
import { getDb, newId, schema } from "@flareling/db";
import { setupNetwork } from "@msw/cloudflare";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { createStripe } from "../src/index.ts";

/** Where tests point the Stripe client; MSW answers for it. */
export const STRIPE = "http://stripe.test";

export const stripe = createStripe({
  secretKey: "sk_test_123",
  apiBase: STRIPE,
});

/**
 * Outbound requests are intercepted, so nothing reaches Stripe, and a
 * request no handler declares fails the test.
 */
export function interceptNetwork() {
  const network = setupNetwork();
  network.configure({ onUnhandledFrame: "error" });
  beforeAll(() => network.enable());
  afterEach(() => {
    network.resetHandlers();
    vi.restoreAllMocks();
  });
  afterAll(() => network.disable());
  return network;
}

/** Stripe sends form-encoded bodies. */
export async function formBody(request: {
  text(): Promise<string>;
}): Promise<URLSearchParams> {
  return new URLSearchParams(await request.text());
}

/** A user with a personal workspace they own. */
export async function createOwner(): Promise<{
  principal: Principal;
  workspaceId: string;
}> {
  const userId = newId();
  await getDb().insert(schema.users).values({ id: userId });
  return {
    principal: {
      userId,
      primaryEmail: `${userId}@example.com`,
      emails: [],
      roles: [],
      permissions: [],
      isSystemAdmin: false,
    },
    workspaceId: await ensurePersonalWorkspace(userId),
  };
}

/** A Stripe subscription object, as the API returns it. */
export function subscriptionObject(overrides: {
  id?: string;
  customer?: string;
  status?: string;
  lookupKey?: string | null;
  workspaceId?: string;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}) {
  return {
    id: overrides.id ?? "sub_1",
    object: "subscription",
    customer: overrides.customer ?? "cus_1",
    status: overrides.status ?? "active",
    cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
    metadata: overrides.workspaceId
      ? { workspace_id: overrides.workspaceId }
      : {},
    items: {
      object: "list",
      data: [
        {
          id: "si_1",
          object: "subscription_item",
          current_period_end: overrides.periodEnd ?? 1_800_000_000,
          price: {
            id: "price_1",
            object: "price",
            lookup_key:
              overrides.lookupKey === undefined
                ? "pro_monthly"
                : overrides.lookupKey,
          },
        },
      ],
    },
  };
}
