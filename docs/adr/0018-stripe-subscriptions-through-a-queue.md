# 0018. Stripe subscriptions, with webhooks processed through a queue

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Products built from this template charge workspaces (ADR 0017) a recurring fee. Decisions needed: which billing model, where plan definitions live, how webhook events become database state, and how to develop and test without a Stripe account.

Stripe delivers webhooks at least once, possibly out of order and late, and treats a slow or failing endpoint as a failure to retry. Processing an event touches Stripe and D1, either of which can blip.

## Decision

We will bill with **Stripe subscriptions**, through Stripe-hosted **Checkout** (to subscribe) and the **Customer Portal** (to change plan, update payment, cancel), so card data never reaches this app. Only workspace owners and admins can open either.

**Plans and entitlements live in code** (`libs/billing/src/plans.ts`). Stripe holds prices, each tagged with a **lookup key** (`pro_monthly`, `pro_yearly`) that maps it to a plan, so no price ids are in code or config. Feature code checks entitlements (`workspacePlan(id).entitlements`), never plan names.

**Webhooks go through the jobs queue.** `apps/web`'s `/api/stripe/webhook` verifies the signature (WebCrypto), enqueues `{ kind, id, type }` and answers 200. `apps/jobs` consumes the queue and calls `processStripeEvent`, which:

- skips event ids already in `stripe_events` (redelivery is a no-op),
- re-fetches the event and then the subscription from Stripe, and writes that current state, so late or out-of-order events can't regress a subscription,
- records the event id in the same D1 batch as the write.

Failures retry with exponential backoff (30 s doubling, 5 retries), then land in the dead-letter queue, which nothing consumes: inspect, fix, replay.

**Local development and CI use stripe-mock**, the official API stand-in, as a compose service and a CI service container. localstripe was considered and rejected: it emulates state, but lags the API and is unofficial.

## Consequences

- Stripe is optional: without `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, billing is off and the webhook route answers 404. Setting only one, or pointing a deployed environment at stripe-mock, fails configuration checks on the first request.
- `past_due` keeps the plan while Stripe retries the payment; `unpaid`, `canceled` and the rest fall back to Free. A price with an unmapped lookup key is stored and logged but grants nothing beyond Free.
- stripe-mock is stateless: responses are fixtures, so local runs and E2E check that requests are valid and the pipeline is wired (webhook, queue, consumer, Stripe call), not that a plan changes. That logic is covered by `libs/billing`'s tests with MSW. For real test-mode events locally, use a Stripe test account with `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
- Locally, `apps/jobs` runs as an auxiliary Worker of `apps/web` under Vite, sharing its local D1 and queues. Deployed, each is its own Worker; the queue names in both wrangler configs are the dev stack's until deploy tooling substitutes the target stack's.
- Upgrading the `stripe` SDK upgrades the Stripe API version it pins (`2026-09-30.endive` today), so it's a reviewed change, like a compatibility date.
- Not yet built: per-seat quantities, trials, tax, invoices in-app, and enforcing entitlements (the member limit) once invitations exist.
