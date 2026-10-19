# 0025. Realtime through apps/web, with one Durable Object room per workspace

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

Team workspaces (ADR 0017, ADR 0024) have more than one person in them, so the members page should show who's online and update when membership changes, without a reload. On Cloudflare that means WebSockets held by a Durable Object. Several things constrained where it goes:

- **Workers that define a Durable Object get no version preview URLs.** apps/web relies on those for PR previews.
- **On Workers Free, Durable Objects are SQLite-backed only:** 100,000 requests a day, with WebSocket messages counted at 20:1. The Hibernation API stops duration billing while sockets are idle.
- **Authentication lives in apps/web** (the session cookie, `requireWorkspaceRole`). Browsers send cookies on cross-site WebSocket upgrades, and the CSRF middleware only covers server functions.
- **A socket can outlive the session or membership that opened it.**

## Decision

We will put the rooms in a separate internal Worker, **apps/realtime**: one SQLite-backed `WorkspaceRoom` Durable Object per workspace, with no public routes. Browsers connect only to **apps/web** at `/api/realtime/$workspaceId`. Web checks the Origin, the session, a per-user rate limit and membership, then forwards the upgrade through a cross-script Durable Object binding, adding the user and session ids as headers. The room trusts those headers because only web can reach it.

- **Presence** is computed from the open sockets: user ids, once each however many tabs.
- **Events carry no data.** Web publishes `members_changed` after every membership change, and clients reload through the usual server functions. A socket is never a second read path that could skip a permission check.
- **Revocation:** removing someone or someone leaving closes their sockets (code 4403), and signing out closes that session's sockets (4401). Every socket is also closed after an hour (4000), and the client reconnects, which checks everything again. That covers whatever wasn't pushed, such as a session that simply expired. The room sends a `disconnect` message with the reason before closing, because close codes don't survive every hop.
- **Cost:** sockets are accepted with the Hibernation API, and pings are answered by the runtime (`setWebSocketAutoResponse`) without waking the room.
- **Contract:** the protocol (close codes, headers, the message schema, the room's RPC interface) lives in **libs/contracts**, imported by both apps and the browser.

## Consequences

- apps/web keeps its preview URLs, and realtime deploys on its own, between jobs and web, since web's binding needs the class to exist.
- Durable Object classes are created by `migrations` in apps/realtime's `wrangler.jsonc`. They're one-way: renaming or removing a class needs a new `renamed_classes` or `deleted_classes` entry, never an edit to an applied one.
- Pushes are best effort. A room that can't be reached is logged and never fails the change that triggered it, so a missed push shows up at the next reconnect at the latest.
- A new way to lose access (revoking sessions, disabling an account) has to close sockets too, or it takes effect only when the socket expires (`.claude/rules/auth.md`).
- Local development runs apps/realtime as a Vite auxiliary Worker. That bridge drops server-initiated close frames, which the `disconnect` message covers. It also resets a refused upgrade instead of answering 404, so refusals are tested in workerd (`apps/web/test/realtime.test.ts`), not e2e.
