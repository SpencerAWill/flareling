# 0023. Resend for production email, from a domain the template user brings

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

[ADR 0015](./0015-email-behind-an-interface.md) put email behind an interface and left the provider open; [ADR 0022](./0022-dev-email-outbox.md) let dev deploy without one. Prod can't: it refuses to start with no email transport, because sign-in is by emailed link.

The candidates were the two in ADR 0015:

- **Cloudflare Email Service:** no extra account or secret, but sending to arbitrary recipients is "Not available" on Workers Free ([ADR 0020](./0020-target-workers-free.md), docs/platform-limits.md R3), and it is still in beta.
- **Resend:** a REST API with a free tier (3,000 a month, 100 a day, one verified domain per account), and what ucmc.spencerwill.com already uses.

The free tier's one domain matters for anyone running several apps. In this instance, the shared spencerwill.com infrastructure owns the verified `spencerwill.com` domain and issues each app its own sending-scoped key (SpencerAWill/spencerwill.com#2). A template user may have one Resend account per app, or a shared one like that.

## Decision

We will send prod's email through Resend:

- **`libs/email`'s `resend` transport** posts to `https://api.resend.com/emails` with plain `fetch`, no SDK (one endpoint doesn't justify a dependency). Each message gets a random `Idempotency-Key`, reused by its one retry (after a network error, a 10-second timeout, a 429 or a 5xx), so a request Resend already accepted isn't sent twice. Other errors aren't retried, and no error body, which can echo the recipient, is logged. Logs carry `kind` and provider only, as for the other transports.
- **Precedence: Mailpit, then the outbox, then Resend.** Local development never sends real mail, even with a key in `.env.local`, and a dev stack with the outbox never sends either.
- **apps/web** takes `RESEND_API_KEY` as a secret, and the existing `EMAIL_FROM` / `EMAIL_FROM_NAME` vars. A deployed environment with none of `MAILPIT_URL` (refused when deployed anyway), `EMAIL_OUTBOX` or `RESEND_API_KEY` fails on its first request. So does one with both `EMAIL_OUTBOX` and `RESEND_API_KEY`: deploys only add secrets, so a key left on a stack that moved to the outbox would otherwise sit there unnoticed.
- **infra/cloudflare** takes the key and from-address as stack config, and creates no Resend resources: the user brings their own account and verified domain. Either `resendApiKey` (secret) and `emailFrom`, or `emailStack`, which names another Pulumi stack and the outputs holding them, read through a `StackReference`. Exactly one of Resend and `emailOutbox` per stack, so a stack can't deploy without a transport, and a dev stack never holds a key. The deploy action uploads the key with each Worker version (`--secrets-file`), and `sync-env` writes the from-address into `EMAIL_FROM`.
- **This instance's prod** uses `emailStack` against `SpencerAWill/spencerwill-shared/prod`, sending as `flareling@spencerwill.com`. The key stays in one place and rotates there; the template's code knows nothing about it.

ADR 0015 stands: this is the provider it left open.

## Consequences

- Prod can deploy once its stack config names a key and a verified from-address.
- Sending is still inside the request. ADR 0015's note stands: move it to a Queue consumer so a slow or failing Resend doesn't fail a sign-in.
- The free tier caps prod at 100 emails a day, shared with every app on the same Resend account. Past that, sign-in fails until 00:00 UTC.
- A key scoped to a domain can send as any address on it, so apps that share a domain can impersonate each other's from-addresses. Accepted for apps with one owner.
- With `emailStack`, the referenced stack must be applied before this one: a missing or empty output fails the `pulumi up`, which is the point.
