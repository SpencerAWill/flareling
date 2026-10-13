# 0003. Domain logic in libs; split into apps only when it earns it

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

A suite of apps invites splitting every domain into its own service early. On Workers, each extra hop is an extra invocation and another deploy to coordinate, and premature service boundaries are expensive to move. Keeping logic inside route handlers has the opposite problem: it can't be shared between apps, jobs, and RPC entrypoints.

## Decision

We will put domain logic in `libs/` (starting with `libs/core`), bundled into each app that imports it and run in-process. Server functions, queue consumers, and RPC entrypoints are thin adapters over it.

A domain moves into its own app behind a service binding only when it needs its own deploy cadence, must be the single writer to its data, or is shared by enough apps that they shouldn't all redeploy on every change. Internal apps are reachable only through bindings (`workers_dev: false`, `preview_urls: false`), and their RPC interfaces are versioned in `libs/contracts` once they deploy independently.

## Consequences

- No network hop by default, and moving a domain out later changes call sites rather than the logic.
- Turborepo boundaries (`app` may not depend on `app`) enforce that apps share code only through libs.
- A lib change rebuilds and redeploys every app that bundles it. That is the price of in-process calls, and the signal for when a split starts to pay.
