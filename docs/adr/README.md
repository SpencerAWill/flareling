# Architecture decision records

Each file here records one decision that shapes the codebase: the context it was made in, what was decided, and what it costs. They exist so a later reader (or agent) can tell a deliberate choice from an accident before changing it.

## When to write one

Write an ADR when a change:

- picks between real alternatives that someone could reasonably revisit (a library, a platform service, a data model),
- sets a rule the rest of the code has to follow, or
- trades something away on purpose (cost, speed, flexibility).

Small, easily reversed choices don't need one. When in doubt, write the short version.

## How

1. Copy [`template.md`](./template.md) to `NNNN-short-title.md`, using the next number.
2. Start it as **Proposed**, and move it to **Accepted** when the change that implements it merges.
3. Don't rewrite an accepted ADR when the decision changes. Write a new one, and mark the old one **Superseded by NNNN**.

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](./0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](./0002-cloudflare-workers-and-tanstack-start.md) | Cloudflare Workers and TanStack Start as the platform | Accepted |
| [0003](./0003-domain-logic-in-libs.md) | Domain logic in libs; split into apps only when it earns it | Accepted |
| [0004](./0004-pnpm-turborepo-source-only-libs.md) | pnpm workspaces and Turborepo, with source-only libs | Accepted |
| [0005](./0005-pulumi-for-infrastructure.md) | Pulumi for infrastructure, as two projects | Accepted |
| [0006](./0006-supply-chain-defaults.md) | Supply-chain defaults: quarantine, trust policy, pinning | Accepted |
| [0007](./0007-one-version-per-dependency.md) | One version per dependency, through a strict catalog | Accepted |
| [0008](./0008-test-in-the-workers-runtime.md) | Test in the Workers runtime and against the production build | Accepted |
| [0009](./0009-conventional-commits-and-squash-merges.md) | Conventional Commits, squash merges, linted PR titles | Accepted |
| [0010](./0010-biome-for-lint-and-format.md) | Biome for linting and formatting | Proposed |
| [0011](./0011-uuidv7-primary-keys.md) | UUIDv7 primary keys | Accepted |
| [0012](./0012-temporal-for-dates-and-times.md) | Temporal for dates and times, imported as a ponyfill | Accepted |
| [0013](./0013-shadcn-on-base-ui.md) | shadcn/ui on Base UI for components | Accepted |
| [0014](./0014-security-headers-now-csp-later.md) | Security headers now, script CSP later | Accepted |
| [0015](./0015-email-behind-an-interface.md) | Email behind an interface, provider decided later | Accepted |
| [0016](./0016-target-workers-paid.md) | Target Workers Paid for deployed environments | Superseded by 0020 |
| [0017](./0017-workspaces-as-tenants.md) | Workspaces as tenants, in one shared database | Accepted |
| [0018](./0018-stripe-subscriptions-through-a-queue.md) | Stripe subscriptions, with webhooks processed through a queue | Accepted |
| [0019](./0019-own-auth-magic-links-passkeys-d1-sessions.md) | Our own auth: magic links, passkeys, sessions in D1, RBAC | Accepted |
| [0020](./0020-target-workers-free.md) | Target Workers Free for deployed environments | Accepted |
| [0021](./0021-one-pipeline-from-check-to-prod.md) | One pipeline from check to prod, with prod behind an approval | Accepted |
