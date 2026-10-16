import { env, exports } from "cloudflare:workers";
import { createStripe } from "@flareling/billing";
import { afterEach, describe, expect, it, vi } from "vitest";

const URL = "https://example.com/api/stripe/webhook";
const stripe = createStripe({ secretKey: "sk_test_123" });

const payload = JSON.stringify({
  id: "evt_1",
  object: "event",
  type: "customer.subscription.updated",
  data: { object: { id: "sub_1", object: "subscription" } },
});

async function post(body: string, signature?: string) {
  return exports.default.fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature ? { "Stripe-Signature": signature } : {}),
    },
    body,
  });
}

function sign(body: string, secret = "whsec_test") {
  return stripe.webhooks.generateTestHeaderStringAsync({
    payload: body,
    secret,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Stripe webhook route", () => {
  it("enqueues a correctly signed event's id and type, and answers 200", async () => {
    const send = vi.spyOn(env.JOBS_QUEUE, "send");
    const res = await post(payload, await sign(payload));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(
      {
        kind: "stripe.event",
        id: "evt_1",
        type: "customer.subscription.updated",
      },
      { contentType: "json" },
    );
  });

  it("refuses an unsigned or wrongly signed body without enqueueing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.spyOn(env.JOBS_QUEUE, "send");

    expect((await post(payload)).status).toBe(400);
    expect(
      (await post(payload, await sign(payload, "whsec_other"))).status,
    ).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("answers 503 when the queue refuses, so Stripe retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(env.JOBS_QUEUE, "send").mockRejectedValue(new Error("queue down"));
    const res = await post(payload, await sign(payload));
    expect(res.status).toBe(503);
  });

  it("refuses an oversized body before reading it", async () => {
    const big = "x".repeat(300 * 1024);
    const res = await post(big, "t=1,v1=0");
    expect(res.status).toBe(413);
  });
});
