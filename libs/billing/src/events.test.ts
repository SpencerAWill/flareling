import { getDb, schema } from "@flareling/db";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  createOwner,
  interceptNetwork,
  STRIPE,
  stripe,
  subscriptionObject,
} from "../test/fixtures.ts";
import {
  processStripeEvent,
  type StripeEventMessage,
  verifyWebhook,
  workspacePlan,
} from "./index.ts";
import { cryptoProvider } from "./stripe.ts";

const network = interceptNetwork();
const SECRET = "whsec_test";

async function signed(payload: string, secret = SECRET) {
  return stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
    cryptoProvider,
  });
}

describe("verifyWebhook", () => {
  const payload = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "customer.subscription.updated",
  });

  it("accepts a correctly signed body and keeps only the id and type", async () => {
    expect(
      await verifyWebhook(stripe, payload, await signed(payload), SECRET),
    ).toEqual(message("evt_1", "customer.subscription.updated"));
  });

  it("rejects a missing, wrong-secret or tampered signature", async () => {
    expect(await verifyWebhook(stripe, payload, null, SECRET)).toBeNull();
    expect(
      await verifyWebhook(
        stripe,
        payload,
        await signed(payload, "whsec_other"),
        SECRET,
      ),
    ).toBeNull();
    const header = await signed(payload);
    expect(
      await verifyWebhook(
        stripe,
        payload.replace("evt_1", "evt_2"),
        header,
        SECRET,
      ),
    ).toBeNull();
  });
});

function serve(event: object, subscription: object) {
  const requests: string[] = [];
  network.use(
    http.get(`${STRIPE}/v1/events/:id`, ({ request }) => {
      requests.push(new URL(request.url).pathname);
      return HttpResponse.json(event);
    }),
    http.get(`${STRIPE}/v1/subscriptions/:id`, ({ request }) => {
      requests.push(new URL(request.url).pathname);
      return HttpResponse.json(subscription);
    }),
  );
  return requests;
}

function message(id: string, type: string): StripeEventMessage {
  return { kind: "stripe.event", id, type };
}

function eventFor(id: string, type: string, object: object) {
  return { id, object: "event", type, data: { object } };
}

describe("processStripeEvent", () => {
  it("writes the subscription's current state from Stripe, then skips the event when redelivered", async () => {
    const { workspaceId } = await createOwner();
    const sub = subscriptionObject({
      id: "sub_a",
      workspaceId,
      periodEnd: 1_800_000_000,
    });
    // The event carries stale data; processing must use the fetched subscription.
    const requests = serve(
      eventFor("evt_a", "customer.subscription.updated", {
        ...sub,
        status: "incomplete",
      }),
      sub,
    );
    const msg = message("evt_a", "customer.subscription.updated");

    expect(await processStripeEvent(stripe, msg)).toBe("processed");
    expect(requests).toEqual(["/v1/events/evt_a", "/v1/subscriptions/sub_a"]);
    expect(await workspacePlan(workspaceId)).toEqual({
      plan: "pro",
      entitlements: { members: 25 },
      subscription: {
        status: "active",
        currentPeriodEnd: new Date(1_800_000_000 * 1000),
        cancelAtPeriodEnd: false,
      },
    });

    expect(await processStripeEvent(stripe, msg)).toBe("duplicate");
    expect(requests).toHaveLength(2);
  });

  it("follows a completed Checkout session to its subscription, and updates rather than duplicates", async () => {
    const { workspaceId } = await createOwner();
    serve(
      eventFor("evt_b", "checkout.session.completed", {
        id: "cs_1",
        object: "checkout.session",
        subscription: "sub_b",
      }),
      subscriptionObject({ id: "sub_b", workspaceId }),
    );
    await processStripeEvent(
      stripe,
      message("evt_b", "checkout.session.completed"),
    );

    network.resetHandlers();
    serve(
      eventFor("evt_c", "customer.subscription.deleted", {
        id: "sub_b",
        object: "subscription",
      }),
      subscriptionObject({ id: "sub_b", workspaceId, status: "canceled" }),
    );
    await processStripeEvent(
      stripe,
      message("evt_c", "customer.subscription.deleted"),
    );

    const rows = (await getDb().select().from(schema.subscriptions)).filter(
      (r) => r.workspaceId === workspaceId,
    );
    expect(rows.map((r) => r.status)).toEqual(["canceled"]);
    expect((await workspacePlan(workspaceId)).plan).toBe("free");
  });

  it("finds the workspace by customer when the subscription has no metadata", async () => {
    const { workspaceId } = await createOwner();
    await getDb()
      .insert(schema.billingCustomers)
      .values({ workspaceId, stripeCustomerId: "cus_d" });
    serve(
      eventFor("evt_d", "customer.subscription.created", {
        id: "sub_d",
        object: "subscription",
      }),
      subscriptionObject({ id: "sub_d", customer: "cus_d" }),
    );
    expect(
      await processStripeEvent(
        stripe,
        message("evt_d", "customer.subscription.created"),
      ),
    ).toBe("processed");
    expect((await workspacePlan(workspaceId)).plan).toBe("pro");
  });

  it("records events it doesn't act on without calling Stripe", async () => {
    // No handlers: a Stripe request would fail the test.
    const msg = message("evt_e", "invoice.paid");
    expect(await processStripeEvent(stripe, msg)).toBe("ignored");
    expect(await processStripeEvent(stripe, msg)).toBe("duplicate");
  });

  it("logs and records a subscription that names no known workspace", async () => {
    serve(
      eventFor("evt_f", "customer.subscription.created", {
        id: "sub_f",
        object: "subscription",
      }),
      subscriptionObject({ id: "sub_f", customer: "cus_unknown" }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = message("evt_f", "customer.subscription.created");
    expect(await processStripeEvent(stripe, msg)).toBe("ignored");
    expect(error).toHaveBeenCalledWith(
      "billing.subscription_without_workspace",
      expect.objectContaining({ eventId: "evt_f", subscriptionId: "sub_f" }),
    );
    expect(await processStripeEvent(stripe, msg)).toBe("duplicate");
  });

  it("stores a price with an unmapped lookup key, granting nothing beyond Free", async () => {
    const { workspaceId } = await createOwner();
    serve(
      eventFor("evt_g", "customer.subscription.created", {
        id: "sub_g",
        object: "subscription",
      }),
      subscriptionObject({
        id: "sub_g",
        workspaceId,
        lookupKey: "legacy_monthly",
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await processStripeEvent(
      stripe,
      message("evt_g", "customer.subscription.created"),
    );
    expect(warn).toHaveBeenCalledWith(
      "billing.unknown_price",
      expect.objectContaining({ lookupKey: "legacy_monthly" }),
    );
    expect(await workspacePlan(workspaceId)).toEqual({
      plan: "free",
      entitlements: { members: 3 },
    });
  });

  it("leaves no record when Stripe fails, so the queue's retry processes it", async () => {
    const { workspaceId } = await createOwner();
    network.use(
      http.get(`${STRIPE}/v1/events/:id`, () =>
        HttpResponse.json(
          { error: { type: "api_error", message: "boom" } },
          { status: 500 },
        ),
      ),
    );
    const msg = message("evt_h", "customer.subscription.updated");
    await expect(processStripeEvent(stripe, msg)).rejects.toThrow();

    network.resetHandlers();
    serve(
      eventFor("evt_h", "customer.subscription.updated", {
        id: "sub_h",
        object: "subscription",
      }),
      subscriptionObject({ id: "sub_h", workspaceId }),
    );
    expect(await processStripeEvent(stripe, msg)).toBe("processed");
  });
});

describe("workspacePlan", () => {
  it("is Free with no subscription", async () => {
    const { workspaceId } = await createOwner();
    expect(await workspacePlan(workspaceId)).toEqual({
      plan: "free",
      entitlements: { members: 3 },
    });
  });

  it("keeps the plan while past due, and drops it when unpaid", async () => {
    const { workspaceId } = await createOwner();
    for (const [i, status, plan] of [
      [1, "past_due", "pro"],
      [2, "unpaid", "free"],
    ] as const) {
      network.resetHandlers();
      serve(
        eventFor(`evt_s${i}`, "customer.subscription.updated", {
          id: "sub_s",
          object: "subscription",
        }),
        subscriptionObject({ id: "sub_s", workspaceId, status }),
      );
      await processStripeEvent(
        stripe,
        message(`evt_s${i}`, "customer.subscription.updated"),
      );
      expect((await workspacePlan(workspaceId)).plan).toBe(plan);
    }
  });
});
