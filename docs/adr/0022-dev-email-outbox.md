# 0022. A dev email outbox behind Cloudflare Access

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

A deployed environment refuses to start without an email transport (ADR 0015), since sign-in is by emailed link. No provider is chosen yet: the free Resend account's one domain is used by ucmc.spencerwill.com. That blocked every deploy, including dev, which only its developers use.

Dev doesn't need to email arbitrary people; it needs its developers to get their sign-in links. ucmc.spencerwill.com once fell back to logging emails, which put working sign-in links in dashboard-readable logs, so any substitute has to keep the links readable only by the right people.

## Decision

A deployed dev environment stores email in D1 (`email_outbox`) instead of sending it, and lists it at `/dev/outbox`:

- **`libs/email`'s `outbox` transport** writes the message. Mailpit still wins when both are configured, so local development is unchanged.
- **Cloudflare Access** guards the path: an application for `<hostname>/dev/outbox` on the dev stack, allowing only `outboxViewers`. Viewers sign in with whichever login method the Zero Trust organization has: the Cloudflare identity provider (your Cloudflare account; the default for organizations created since June 2026, limited to account members), or One-time PIN (Zero Trust → Integrations → Identity providers). The policy matches the email address that login method reports, so `outboxViewers` must use it. Zero Trust Free covers up to 50 users.
- **The page verifies Access's token itself** with `jose`: signature against the team's published keys, issuer, audience (that application's tag) and expiry. A loosened policy, or a request reaching the Worker another way, still gets a 403. With the outbox off it is a 404.
- **Never in prod.** infra/cloudflare refuses `emailOutbox` on the `prod` stack, and apps/web refuses `EMAIL_OUTBOX` without the Access settings.
- **Kept a day.** The page prunes older rows on every read (deployed Workers have no cron on Workers Free), and the jobs sweep includes the table.
- **Rendering** escapes everything and makes only links to the app's own origin clickable; the response is `no-store`, `noindex` and `no-referrer`.

## Consequences

- Dev deploys and is fully usable (sign-in, passkeys, billing) without an email provider. Prod still needs one.
- Working sign-in links sit in dev's D1 for up to a day. Anyone who can read that database (the deploy and infra tokens, the dashboard) can sign in as a dev user. Acceptable for dev; the reason it is refused for prod.
- Access is account-wide configuration: the Zero Trust organization and its login methods are set up by hand once, and shared with the account's other projects.
- The smoke test still doesn't sign in. An Access service token would let it read the outbox and sign in, as a later step.
