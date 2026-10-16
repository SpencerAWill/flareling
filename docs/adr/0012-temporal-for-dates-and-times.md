# 0012. Temporal for dates and times, imported as a ponyfill

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Sessions expire, magic links time out, subscriptions renew, and audit rows need timestamps. `Date` has no time zones beyond the host's and UTC, and its arithmetic is error-prone around daylight-saving transitions. ucmc.spencerwill.com uses Temporal and hit exactly those cases (a 30-day window across a DST change differs from 30 calendar days by an hour).

Workers has no stable native Temporal yet. In July 2026 the deployed runtime briefly exposed a native `Temporal` whose clock was stuck at epoch 0 during requests, while `Date.now()` was correct ([cloudflare/workerd#6907](https://github.com/cloudflare/workerd/issues/6907)). Code that installed a polyfill only `if (typeof Temporal === "undefined")` silently picked up the broken native one. It was reverted; Cloudflare plans native Temporal with no timeline.

## Decision

We will use Temporal for dates, times and durations, imported from `temporal-polyfill` as a ponyfill (`import { Temporal } from "temporal-polyfill"`), never installed onto the global. Two kinds of arithmetic, chosen deliberately:

- **Exact elapsed time** (`instant.add({ hours: 1 })`) for expiries and retention windows, which must not shift with daylight saving.
- **Calendar arithmetic in a named time zone** (`toZonedDateTimeISO(zone)`) for anything a person reads off a calendar: "end of day", billing dates, monthly resets.

D1 stores instants as integer milliseconds (Drizzle's `timestamp_ms` mode). Convert at the boundary.

## Consequences

- The polyfill adds roughly 19 KB gzip to each Worker that uses it.
- Code is immune to whatever global `Temporal` the runtime does or doesn't provide.
- Switching to native Temporal later is a change of import, once Workers ships it and it has proven stable.
- `Date` remains only at boundaries that require it (Drizzle columns, third-party APIs).
