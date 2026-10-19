---
paths:
  - "libs/auth/**"
  - "libs/core/src/workspaces*"
  - "libs/core/src/members*"
  - "libs/core/src/invites*"
  - "apps/web/src/server/auth/**"
  - "apps/web/src/lib/auth.ts"
  - "apps/web/src/routes/sign-in.tsx"
  - "apps/web/src/routes/auth.*"
  - "apps/web/src/routes/invite.tsx"
  - "apps/web/src/routes/w/**"
  - "apps/web/src/routes/my/**"
  - "apps/web/src/components/passkeys.tsx"
  - "apps/web/src/components/turnstile.tsx"
  - "apps/web/e2e/sign-in.spec.ts"
  - "apps/web/e2e/passkey.spec.ts"
---

# Auth, sessions and RBAC

The design and why it's ours: `docs/adr/0019-own-auth-magic-links-passkeys-d1-sessions.md`. Workspaces (tenants): ADR 0017; invites: ADR 0024. This file is the rules for changing it.

## Where things go

- **`libs/auth`** owns the logic: magic links, passkeys, sessions, the principal, RBAC, abuse guards, the expiry sweep. It takes an `AuthContext` (cookies, clock, email sender, rate limiter, config) instead of reading request state, so every path is testable in workerd with `test/context.ts`.
- **`apps/web/src/server/auth/`** adapts Start to it: `context.server.ts` builds one `AuthContext` per request, and `fns.ts` holds thin server functions (validate with zod, dynamic-import libs/auth, return a result value). Keep logic out of `fns.ts`.
- **Client code imports `@flareling/auth/client` only.** The main entry pulls in D1 and `cloudflare:workers`, and a static import from a component lands it in the browser bundle.

## Rules that are easy to break

- **The principal is sent to its own browser** (`getSessionFn`). Anything added to `Principal` is visible to that user; never put another user's data or a secret on it.
- **Route guards are UX; server functions are the check.** `requireSignedIn` in `beforeLoad` only redirects. Every server function that reads or writes account or workspace data loads the principal itself and checks it (`requirePermission`, `requireWorkspaceRole`).
- **Workspace access goes through `requireWorkspaceRole`.** Non-members get the same `ForbiddenError` (or 404 page) as members without the role, so an id never reveals whether a workspace exists. `system_admin` grants nothing inside a workspace.
- **Requesting a magic link reveals nothing.** Every outcome (sent, unknown address, rate limited, Turnstile failed) answers `{ ok: true }` after the same padded delay. Don't add a branch that returns early or says more.
- **Consuming a link needs a POST.** `/auth/callback` shows a button; it must never consume on load, because email scanners prefetch links.
- **Single use is one statement.** Links are claimed with a conditional UPDATE, ceremonies with `DELETE ... RETURNING`. Don't split either into read-then-write.
- **Adding a passkey needs a recent sign-in** (15 minutes, `reason: "reauthenticate"` otherwise), so a stolen session can't plant a credential.
- **Abuse guards run before database work**, and `withinRateLimit` fails open by design. The E2E bypass (`E2E_BYPASS_RATE_LIMIT`) is ignored over https; keep it that way.
- **Emails are normalized** with `normalizeEmail` before every insert and lookup; `user_emails.email` is globally unique.
- **Redirect targets go through `isSafeRedirect`** (a path on this origin), on the server and the client.
- **Invite links never create a session.** Accepting needs a signed-in account with the invited address (`acceptInvite`). Don't make `/invite` sign anyone in, and don't act on page load.
- **A workspace always keeps an owner.** Role changes, removals and leaving put the last-owner check (`anotherOwnerRemains`) inside the UPDATE or DELETE, along with the role as it was read. Don't move either into a read beforehand.
- **Seat checks are in the write.** Inviting counts members plus unexpired open invites inside the INSERT; accepting counts members inside its INSERT. Don't replace them with a count read beforehand.
- **Times come from `nowOf(ctx)`**, never `Date.now()` or the database's clock, so tests can move time.

## Adding things

- **A permission** is a migration (a row in `permissions`, plus grants in `role_permissions`), not just a string in code.
- **A table with expiring rows** needs an index on its expiry column and an entry in a sweep (`libs/auth/src/sweep.ts`, or the owning lib's `retention.ts`, run daily by `apps/jobs`). `libs/db/src/retention.test.ts` checks the delete uses the index; add the table there too.
- **A new cookie** uses `cookieName()` (gets `__Host-` over https) and `isSecure()`.
- **The dev outbox** (`/dev/outbox`, ADR 0022) holds working sign-in links. Keep both locks: Access in front, and `accessViewer`'s own token check in the handler. Never enable it for prod, and never render its content unescaped or link to other origins.
- **Audit** security-relevant changes with `recordAudit` (sign-in, passkey added or removed, role changes).
