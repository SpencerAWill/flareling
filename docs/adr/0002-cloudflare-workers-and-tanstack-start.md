# 0002. Cloudflare Workers and TanStack Start as the platform

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

The suite is several apps (product, marketing, admin, background jobs, realtime) built by a small team. It needs a relational store, object storage, queues, and stateful coordination, and should cost close to nothing while idle. The reference projects (www.spencerwill.com, ucmc.spencerwill.com) already run on Cloudflare with TanStack Start.

## Decision

We will run every deployable as a Cloudflare Worker (`nodejs_compat`), using Cloudflare's primitives for state: D1 for relational data, R2 for files, KV for config and caching, Queues and Workflows for async work, and Durable Objects for coordination.

User-facing apps use TanStack Start (React 19, Vite, Tailwind 4) deployed with `@cloudflare/vite-plugin`. Server functions, server routes, and middleware are the backend; there is no separate HTTP framework. Workers talk to each other through service bindings and `WorkerEntrypoint` RPC, not HTTP.

## Consequences

- Most primitives are free at rest, and service bindings add no network hop or extra invocation.
- `pnpm dev` runs server code in workerd, the production runtime, so a Node-only API fails locally instead of after deploy.
- Workers' limits become design constraints: CPU time per request, startup time (checked indirectly by `pnpm size`), D1's per-statement and per-request limits, and daily quotas. See [platform-limits.md](../platform-limits.md) and [ADR 0020](./0020-target-workers-free.md).
- Bindings exist only inside a request, queue, or scheduled handler, so `env` is never read at module scope.
- `compatibility_date` is pinned and moved deliberately, as a tested upgrade.
