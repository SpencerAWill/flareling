# 0019. Our own auth: magic links, passkeys, sessions in D1, RBAC

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Every app built from this template needs sign-in from its first feature. The options were a hosted identity provider (Auth0, Clerk, WorkOS, Cloudflare Access), a library that brings its own tables and conventions (Better Auth, Lucia's successors), or our own, extracted from ucmc.spencerwill.com, where it has run in production on the same stack (Workers, D1, TanStack Start).

A hosted provider adds an account, per-user pricing, a second place where users live, and a network hop on every session check. A library still needs adapting to D1's limits (100 bound parameters, no PRAGMAs in migrations) and to Workers. ucmc's implementation already fits both, and reviewing it surfaced fixes worth making while extracting it.

## Decision

We will own authentication in `libs/auth`, with no passwords:

- **Magic links** are the way in and the recovery path. Requesting one answers the same way, in about the same time, whatever the outcome. Consuming one is a single atomic claim, it creates the account on first use, and it needs a click (a POST), because email scanners fetch every link.
- **Passkeys** (WebAuthn, `@simplewebauthn`) are an optional shortcut beside email, never required. Ceremonies live in D1 and are claimed with `DELETE ... RETURNING`, so each challenge is used once. Adding one needs a sign-in within the last 15 minutes.
- **Sessions** are a random token in an `HttpOnly`, `SameSite=Lax`, `__Host-` cookie (over https), stored only as a hash in D1. They slide: 30 days, extended at most hourly, and the cookie is re-sent when extended. Revoking is deleting the row.
- **RBAC** for the platform: roles and permissions are rows, seeded by migration; `system_admin` holds every permission. **Workspace roles** (owner, admin, member; ADR 0017) are separate and grant tenant access; platform roles grant none.
- **Abuse controls** run before any database work: Cloudflare's Rate Limiting binding, per IP and per email, failing open; and Turnstile on the sign-in form, failing closed once a secret is set.
- **CSRF**: Start's CSRF middleware on every server function (same origin only), plus `SameSite` cookies.

Expired sessions, links and ceremonies are deleted daily by `apps/jobs` (`sweepExpiredAuthRows`).

## Consequences

- No vendor, no per-user cost, and a session check is one indexed D1 read.
- Security fixes are ours to make. The ones found extracting from ucmc are fixed here: session cookies now slide with the row, Turnstile is no longer skipped when a bot omits the token, challenges moved from KV (where read-then-delete isn't atomic) to D1, and a duplicate passkey is a clean refusal rather than a 500.
- Email delivery is a dependency of sign-in itself, so a deployed environment without an email transport refuses to start (ADR 0015).
- Not yet built: SSO/OIDC for customers who need it, account deletion and data export, a sessions list with remote sign-out, adding a second email (the schema supports it), and admin UI for roles.
