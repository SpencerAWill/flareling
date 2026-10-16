# 0016. Target Workers Paid for deployed environments

- **Status:** Superseded by [0020](./0020-target-workers-free.md)
- **Date:** 2026-10-16

## Context

On Workers Free, each request gets 10 ms of CPU, and Cloudflare's limits page notes that "auth, SSR, or large payload parsing often use 10-20 ms". Every page here server-renders React and checks the session. Occasional overruns are tolerated, but consistent ones end in error 1102, a failure that local tests and Miniflare don't reproduce. Free also caps a Worker at 100,000 requests a day (error 1027 after that), D1 at 50 queries per request and 100,000 rows written a day, and doesn't allow Cloudflare Email Service to send to arbitrary recipients.

Workers Paid ($5 a month) raises CPU to 30 s per request by default (configurable up to 5 minutes), includes 10 million requests a month, allows 1,000 D1 queries per request, and includes 3,000 Email Service messages a month. The full comparison is in [platform-limits.md](../platform-limits.md).

## Decision

We will treat Workers Paid as a prerequisite for any deployed environment (dev and prod). Each Worker sets `limits.cpu_ms` (300 ms in `apps/web`) as a guard against runaway requests rather than relying on the 30 s default.

We keep habits that are cheap under any plan: few D1 queries per request, prerendered pages where no session is needed, and no per-row logging.

## Consequences

- Deploying needs a Cloudflare account on Workers Paid. A Free account can still develop locally, but deploys there would hit the limits above.
- `limits.cpu_ms` is a Paid-only setting, so a deploy to a Free account rejects it.
- Email Service becomes an option when the provider is chosen (ADR 0015).
- Per-request CPU still costs money on Paid, so CPU-heavy work belongs in Queues or Workflows, not in requests.
