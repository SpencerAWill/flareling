/**
 * Stripe's webhook endpoint: check the signature, put the event on the jobs
 * queue, answer 200. Processing happens in apps/jobs, so this stays fast
 * (Stripe treats a slow endpoint as failed) and a D1 or Stripe hiccup becomes
 * a queue retry instead of a webhook retry.
 */
import { env } from "cloudflare:workers";
import { createStripe, verifyWebhook } from "@flareling/billing";
import { errorMessage, log } from "@flareling/log";
import { getEnv } from "#/env.ts";

/**
 * Stripe's events are a few KB. Anything far larger isn't from Stripe, so it
 * is refused before the signature check reads it.
 */
const MAX_BODY_BYTES = 256 * 1024;

export async function handleStripeWebhook(request: Request): Promise<Response> {
  const vars = getEnv();
  if (!vars.STRIPE_SECRET_KEY || !vars.STRIPE_WEBHOOK_SECRET) {
    return new Response("Not Found", { status: 404 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return new Response("Payload Too Large", { status: 413 });
  }

  // The signature covers the exact bytes Stripe sent, so read the raw text.
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return new Response("Payload Too Large", { status: 413 });
  }
  const stripe = createStripe({
    secretKey: vars.STRIPE_SECRET_KEY,
    apiBase: vars.STRIPE_API_BASE,
  });
  const message = await verifyWebhook(
    stripe,
    body,
    request.headers.get("stripe-signature"),
    vars.STRIPE_WEBHOOK_SECRET,
  );
  if (!message) {
    log.warn("billing.webhook_rejected");
    return new Response("Bad Request", { status: 400 });
  }

  try {
    await env.JOBS_QUEUE.send(message, { contentType: "json" });
  } catch (err) {
    // A 5xx makes Stripe retry, with backoff, for up to three days.
    log.error("billing.webhook_enqueue_failed", {
      eventId: message.id,
      error: errorMessage(err),
    });
    return new Response("Service Unavailable", { status: 503 });
  }
  return Response.json({ received: true });
}
