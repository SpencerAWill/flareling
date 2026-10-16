# 0020. Target Workers Free for deployed environments

- **Status:** Accepted
- **Date:** 2026-10-16
- **Supersedes:** [0016](./0016-target-workers-paid.md)

## Context

ADR 0016 made Workers Paid a prerequisite for deploying. The account this suite deploys to stays on Workers Free for now, and it is shared with ucmc.spencerwill.com and www.spencerwill.com, so account-wide limits are shared too. What that means here (details in [platform-limits.md](../platform-limits.md)):

- **10 ms of CPU per request, fixed.** `limits.cpu_ms` isn't accepted. Server rendering with a session check is near the limit; consistent overruns end in error 1102, which local tests don't reproduce.
- **100,000 requests a day, account-wide.**
- **50 D1 queries and 50 subrequests per invocation.**
- **5 Cron Triggers per account.** ucmc uses 4 (two expressions on each of its two Workers).
- **Queues keep messages 24 hours**, dead-letter queue included, and allow 10,000 operations a day.
- **D1: 500 MB per database**, 5 GB per account, 10 databases.
- **Cloudflare Email Service** can't send to arbitrary recipients.

## Decision

We will deploy on Workers Free and design within its limits:

- No `limits.cpu_ms` in any wrangler config (a comment says how to add it on Paid).
- No Cron Triggers on deployed Workers: `sync-env` strips `triggers` from deployed configs. `apps/jobs` keeps its cron and handler for local runs, and the retention sweep is run by hand until a slot is free or the plan changes.
- Per-invocation budgets: the retention sweep makes at most 40 D1 queries a run, and the jobs consumer takes 5 messages per batch.
- Email goes through a provider with an API (ADR 0015), not Email Service.

## Consequences

- No monthly cost, and the limits above become design constraints that tests mostly can't check: CPU per request especially. Measure deployed CPU time before trusting a heavy page.
- Expired auth rows and processed Stripe event ids accumulate in deployed databases until the sweep runs. At this suite's size that is slow, and the 500 MB database cap is far off.
- A dead-lettered message must be dealt with within a day. Stripe can resend any event for 30 days.
- Moving to Paid is a reversal of this ADR: restore `limits.cpu_ms`, let `sync-env` keep the cron, and raise the per-invocation budgets.
