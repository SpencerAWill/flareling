import { ForbiddenError } from "@flareling/auth";
import { getDb, newId, schema } from "@flareling/db";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  createOwner,
  formBody,
  interceptNetwork,
  STRIPE,
  stripe,
} from "../test/fixtures.ts";
import { openBillingPortal, startCheckout } from "./index.ts";

const network = interceptNetwork();
const ctx = { stripe, appBaseUrl: "https://app.example.com" };

function stripeHandlers(calls: {
  customers: URLSearchParams[];
  checkout: URLSearchParams[];
}) {
  return [
    http.get(`${STRIPE}/v1/prices`, ({ request }) => {
      const url = new URL(request.url);
      const key = url.searchParams.get("lookup_keys[0]");
      return HttpResponse.json({
        object: "list",
        data:
          key === "pro_monthly" ? [{ id: "price_pro_m", object: "price" }] : [],
        has_more: false,
      });
    }),
    http.post(`${STRIPE}/v1/customers`, async ({ request }) => {
      calls.customers.push(await formBody(request));
      return HttpResponse.json({
        id: `cus_${calls.customers.length}`,
        object: "customer",
      });
    }),
    http.post(`${STRIPE}/v1/checkout/sessions`, async ({ request }) => {
      calls.checkout.push(await formBody(request));
      return HttpResponse.json({
        id: "cs_1",
        object: "checkout.session",
        url: "https://checkout.stripe.com/c/cs_1",
      });
    }),
  ];
}

describe("startCheckout", () => {
  it("creates the workspace's customer once and a subscription Checkout for the plan's price", async () => {
    const { principal, workspaceId, publicId } = await createOwner();
    const calls = {
      customers: [] as URLSearchParams[],
      checkout: [] as URLSearchParams[],
    };
    network.use(...stripeHandlers(calls));

    const input = { workspaceId, plan: "pro", interval: "month" } as const;
    expect(await startCheckout(ctx, principal, input)).toBe(
      "https://checkout.stripe.com/c/cs_1",
    );
    await startCheckout(ctx, principal, input);

    expect(calls.customers).toHaveLength(1);
    expect(calls.customers[0]?.get("metadata[workspace_id]")).toBe(workspaceId);
    const rows = await getDb().select().from(schema.billingCustomers);
    expect(rows.filter((r) => r.workspaceId === workspaceId)).toEqual([
      expect.objectContaining({ workspaceId, stripeCustomerId: "cus_1" }),
    ]);

    const session = calls.checkout[1];
    expect(session?.get("mode")).toBe("subscription");
    expect(session?.get("customer")).toBe("cus_1");
    expect(session?.get("line_items[0][price]")).toBe("price_pro_m");
    expect(session?.get("client_reference_id")).toBe(workspaceId);
    expect(session?.get("subscription_data[metadata][workspace_id]")).toBe(
      workspaceId,
    );
    expect(session?.get("success_url")).toBe(
      `https://app.example.com/w/${publicId}/billing?checkout=success`,
    );
  });

  it("fails loudly when Stripe has no active price for the lookup key", async () => {
    const { principal, workspaceId } = await createOwner();
    network.use(...stripeHandlers({ customers: [], checkout: [] }));
    await expect(
      startCheckout(ctx, principal, {
        workspaceId,
        plan: "pro",
        interval: "year",
      }),
    ).rejects.toThrow("pro_yearly");
  });

  it("refuses members who aren't owners or admins, before calling Stripe", async () => {
    const { workspaceId } = await createOwner();
    const other = await createOwner();
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: other.principal.userId, role: "member" });
    // No handlers: any Stripe request would fail the test.
    await expect(
      startCheckout(ctx, other.principal, {
        workspaceId,
        plan: "pro",
        interval: "month",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      startCheckout(ctx, null, {
        workspaceId: newId(),
        plan: "pro",
        interval: "month",
      }),
    ).rejects.toThrow();
  });
});

describe("openBillingPortal", () => {
  it("returns a portal session for the workspace's customer, returning to its billing page", async () => {
    const { principal, workspaceId, publicId } = await createOwner();
    await getDb()
      .insert(schema.billingCustomers)
      .values({ workspaceId, stripeCustomerId: "cus_existing" });
    let body: URLSearchParams | undefined;
    network.use(
      http.post(`${STRIPE}/v1/billing_portal/sessions`, async ({ request }) => {
        body = await formBody(request);
        return HttpResponse.json({
          id: "bps_1",
          object: "billing_portal.session",
          url: "https://billing.stripe.com/p/session/1",
        });
      }),
    );

    expect(await openBillingPortal(ctx, principal, workspaceId)).toBe(
      "https://billing.stripe.com/p/session/1",
    );
    expect(body?.get("customer")).toBe("cus_existing");
    expect(body?.get("return_url")).toBe(
      `https://app.example.com/w/${publicId}/billing`,
    );
  });
});
