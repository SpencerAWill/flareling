# flareling

A GitHub template repository for building and shipping a multi-app SaaS suite on Cloudflare's developer platform.

Flareling gives you a working monorepo from day one: web apps, APIs, background jobs, realtime, infrastructure as code, and CI/CD. It is designed to scale to many apps while keeping the monthly bill close to zero until you have real traffic.

> **Status:** early scaffolding. This README describes the target architecture. Sections marked 🚧 are not built yet. Conventions are drawn from production use in [www.spencerwill.com](https://github.com/SpencerAWill/www.spencerwill.com) and [ucmc.spencerwill.com](https://github.com/SpencerAWill/ucmc.spencerwill.com).

---

## Table of contents

- [Why Flareling](#why-flareling)
- [Stack](#stack)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Day-to-day development](#day-to-day-development)
- [Environments and deployment](#environments-and-deployment)
- [Infrastructure (Pulumi)](#infrastructure-pulumi)
- [Data and storage](#data-and-storage)
- [Cost efficiency](#cost-efficiency)
- [Designing for scale](#designing-for-scale)
- [Testing](#testing)
- [Security and supply chain](#security-and-supply-chain)
- [Observability](#observability)
- [Working with AI agents](#working-with-ai-agents)
- [Platform gotchas](#platform-gotchas)
- [Adding an app or lib](#adding-an-app-or-lib)
- [Open decisions](#open-decisions)
- [Contributing](#contributing)
- [License](#license)

---

## Why Flareling

- **One repo, many deployables.** Everything in `apps/` deploys independently. Everything in `libs/` is shared code bundled into the apps that use it.
- **Edge-native by default.** Everything runs on Workers. No containers, no regions to choose, no cold-start tuning.
- **Pay for use, not for idle.** Every default favors primitives that cost nothing at rest: service bindings, static assets, Durable Object hibernation, and zero-egress R2.
- **Fast local loop.** `pnpm dev` runs the whole suite locally with real binding emulation (D1, KV, R2, Queues, Durable Objects) through Miniflare.
- **Production-grade from the first commit.** Typed bindings, migrations, IaC, smoke-tested deploys, supply-chain hardening, and CI are already wired in.

## Stack

| Concern | Choice |
| --- | --- |
| Runtime | Cloudflare Workers (`nodejs_compat`) |
| Language | TypeScript (strict) |
| Node / package manager | Node 24 (`.nvmrc`), pnpm 12 (pinned via `packageManager`) |
| Monorepo | pnpm workspaces + Turborepo, split into `apps/` (deployables) and `libs/` (bundled source) |
| Frontend | [TanStack Start](https://tanstack.com/start), React 19, Vite, Tailwind CSS 4, deployed with `@cloudflare/vite-plugin` |
| Backend | TanStack Start server functions, server routes, and middleware. Worker RPC (`WorkerEntrypoint`) between Workers. No separate HTTP framework. |
| Relational data | D1 + [Drizzle ORM](https://orm.drizzle.team) |
| Stateful coordination / realtime | Durable Objects (SQLite-backed) |
| Object storage | R2 |
| Config, flags, cache | KV |
| Async work | Queues + Workflows |
| Infrastructure as code | Pulumi (TypeScript) with the Cloudflare and GitHub providers |
| Code deploys | Wrangler (via `cloudflare/wrangler-action` in CI) |
| CI/CD | GitHub Actions |
| Lint / format | Biome, plus knip for unused code and dependencies |
| Git hooks / commits | Husky, lint-staged, commitlint (Conventional Commits) |
| Env validation | `@t3-oss/env-core` |
| Tests | Vitest in the Workers runtime (`@cloudflare/vitest-plugin`), Playwright for E2E |
| Dependency updates | Dependabot with cooldowns and grouping |
| Dev environment | Dev container via docker-compose (Node 24, pnpm via corepack, Pulumi, gh, Claude Code, zsh + Powerlevel10k) with a Mailpit sidecar. Settings for both VS Code and Zed. |

## Architecture

```text
┌─────────────────────────────── Cloudflare edge ───────────────────────────────┐
│                                                                                 │
│  example.com ───────► apps/marketing (TanStack Start, prerendered)              │
│  app.example.com ───► apps/web   (TanStack Start: UI + server functions/routes) │
│  admin.example.com ─► apps/admin (TanStack Start, behind Access)                │
│                            │                                                    │
│              libs/core ────┤  domain logic bundled in, runs in-process          │
│                            │                                                    │
│                            ├──► D1 (primary data)   R2 (files)   KV (config)    │
│                            ├──► apps/realtime (Durable Objects) ◄─ WebSocket    │
│                            └──► Queue ──► apps/jobs (consumers, Workflows)      │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Key principles:

1. **Each app is its own backend.** TanStack Start server functions handle data loading and mutations with end-to-end types. Server routes handle raw HTTP such as webhooks, OAuth callbacks, and health checks. Middleware covers auth, logging, and rate limiting.
2. **Domain logic lives in libs, not in routes.** Server functions are thin adapters over `libs/core`, which is bundled into each app that imports it. This runs in-process with no network hop and no extra invocation.
3. **Split a domain into its own app only when it earns it.** That means when it needs its own deploy cadence, must be the single writer to its data, or is shared by many apps that shouldn't all redeploy on every change. Internal apps expose typed methods through `WorkerEntrypoint` and service bindings, not HTTP routes.
4. **Only user-facing apps are public.** Internal apps (`jobs`, `realtime`, and any RPC services) set `workers_dev: false` and `preview_urls: false` and are reachable only through bindings.
5. **Work that can wait goes to a queue.** Emails, webhooks, exports, and fan-out go through Queues. Multi-step processes with retries use Workflows.
6. **State that needs coordination lives in a Durable Object.** Use them for presence, collaboration, locks, and per-tenant or per-entity consistency.

## Repository layout

```text
.
├── apps/                   # Deployables: each one is a Worker with its own wrangler.jsonc
│   ├── web/                # Main product app (TanStack Start)
│   ├── marketing/          # Public site (TanStack Start, mostly prerendered)
│   ├── admin/              # Internal tooling, protected by Cloudflare Access
│   ├── jobs/               # Queue consumers, Workflows, cron triggers (no public routes)
│   └── realtime/           # Durable Objects for WebSockets and coordination (no public routes)
├── libs/                   # Shared code, bundled into apps at build time, never deployed alone
│   ├── core/               # Domain logic, called from server functions, jobs, and RPC entrypoints
│   ├── db/                 # Drizzle schema, D1 migrations, query helpers
│   ├── ui/                 # Shared React components, with Storybook
│   ├── auth/               # Session, passkey, and RBAC utilities
│   ├── contracts/          # Shared zod schemas, types, and RPC interfaces
│   ├── env/                # Typed, validated env schemas per app
│   └── log/                # Structured logger with redaction
├── infra/
│   ├── cloudflare/         # Pulumi: zones, DNS, D1, R2, KV, Queues, Access, WAF (dev/prod stacks)
│   └── github/             # Pulumi: repo settings, rulesets, environments, CI secrets (one stack)
├── tooling/                # Dev-time only, never bundled
│   ├── config/             # Shared tsconfig presets and the Vitest coverage preset
│   └── scripts/            # Worker size check; bootstrap and Pulumi → Wrangler sync to come
├── .claude/                # Agent rules, subagents, skills, and hooks (see below)
├── .devcontainer/          # Dev container with Mailpit sidecar
├── .github/
│   ├── workflows/          # CI, deploys, infra, PR title lint, scheduled quality
│   ├── dependabot.yml
│   ├── zizmor.yml
│   ├── CODEOWNERS
│   └── ISSUE_TEMPLATE/ + pull_request_template.md
├── docs/adr/               # Architecture decision records
├── CLAUDE.md
├── CONTRIBUTING.md
├── SECURITY.md
├── turbo.json
├── pnpm-workspace.yaml
└── biome.json
```

### apps vs. libs

| | `apps/*` | `libs/*` |
| --- | --- | --- |
| What it is | A deployable Worker | Source code shared between apps |
| Has `wrangler.jsonc` | Yes | No |
| Build output | A Worker bundle | None. Its TypeScript source is compiled by each app's bundler. |
| Turborepo tasks | `dev`, `build`, `deploy`, `test`, `typecheck`, `lint` | `test`, `typecheck`, `lint` |
| May depend on | libs | other libs |

Rules:

- **Libs are internal, source-only packages.** Each lib's `package.json` points `exports` at `src/*.ts`, and apps depend on it with `workspace:*`. With no separate build step, changes show up instantly in `pnpm dev`, and each app's bundler tree-shakes only what it uses.
- **Apps never import from other apps.** Apps talk to each other at runtime through service bindings, with the shared interface defined in `libs/contracts`.
- **Libs never import from apps,** and should not read bindings at module scope. Bindings are passed in by the app.
- **Boundaries are enforced in CI** with Turborepo boundaries and package tags (`app`, `lib`), so a disallowed import fails the build. 🚧
- **Every workspace package uses one npm scope** (`@flareling/web`, `@flareling/core`, and so on). `pnpm bootstrap` renames the scope for your project.
- `infra/` and `tooling/` sit outside this split. Infra holds Pulumi programs, not Workers. Tooling is dev-time configuration and scripts that never ship.

## Getting started

### Prerequisites

- Node.js 24 (see `.nvmrc`) and Corepack (`corepack enable`), or just the dev container
- A Cloudflare account
- Pulumi CLI (only if you manage infrastructure)
- Repo admin access (only to run `infra/github`)

### Create your project

1. Click **Use this template** on GitHub, or run:

   ```sh
   gh repo create my-suite --template SpencerAWill/flareling --private --clone
   cd my-suite
   ```

2. Open it in the dev container (recommended), or install locally:

   ```sh
   pnpm install
   pnpm bootstrap   # 🚧 renames the project, sets domain and account ID, copies .env.example files
   ```

3. Start everything locally:

   ```sh
   pnpm dev
   ```

   You do not need a Cloudflare account to develop locally. All bindings are emulated, and outgoing email is captured by Mailpit.

## Day-to-day development

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs all apps locally with bindings wired together |
| `pnpm dev --filter web` | Runs one app and the apps it binds to |
| `pnpm build` | Builds every package, cached by Turborepo |
| `pnpm verify` | Biome, sherif, knip, typecheck, tests, and boundaries: the same gate CI runs |
| `pnpm test` | Runs unit and integration tests in the Workers runtime |
| `pnpm test:e2e` | Builds, then runs Playwright with axe against the production build (desktop and mobile projects). The dev container installs the browsers; elsewhere run `pnpm --filter @flareling/web test:e2e:install` once. UI mode: `pnpm --filter @flareling/web test:e2e:ui`, on port 9323 |
| `pnpm size` | Builds, then fails if any Worker's gzip upload is over its budget (below the Free plan's 3 MB cap) |
| `pnpm lint` / `pnpm format` | Runs Biome |
| `pnpm cf-typegen` | Regenerates binding types from each `wrangler.jsonc` (`wrangler types`) |
| `pnpm db:generate` | Generates a D1 migration from schema changes |
| `pnpm db:migrate:local` | Applies migrations to the local D1 database |
| `pnpm db:studio` | Opens Drizzle Studio against local data |
| `pnpm test:coverage` | Runs the unit and integration tests with Istanbul coverage (a report, with no thresholds) |
| `pnpm test:mutation` | Runs Stryker over the pure modules listed in `stryker.config.mjs` (a report, never a gate) |
| `pnpm storybook` | Starts Storybook for `libs/ui` on port 6006 |
| `pnpm commit` | Guided Conventional Commit prompt (commitizen) |

Local configuration lives in each deployable's `.env.local`, copied from a committed `.env.example`. Wrangler v4 reads `.env` files natively. Every deployable validates its env at startup with a schema from `libs/env`, so a missing variable fails loudly instead of at the first request that needs it.

Pre-commit hooks scan staged changes for secrets with gitleaks and run `biome check --write --error-on-warnings` on staged files, and `commit-msg` enforces Conventional Commits. Decisions that shape the codebase are recorded in [`docs/adr/`](./docs/adr/README.md).

## Environments and deployment

| Environment | Trigger | Wrangler env | Data |
| --- | --- | --- | --- |
| Local | `pnpm dev` | top level | Miniflare, persisted in `.wrangler/` |
| Preview 🚧 | Pull request | top level, uploaded as a version | Shared `dev` resources |
| Dev | Merge to `main` | top level | Dev resources (`dev` Pulumi stack) |
| Production | Manual dispatch with approval | `env.production` | Production resources (`prod` Pulumi stack) |

Each deploy runs in a fixed order:

1. **`pulumi up`** on `infra/cloudflare` creates or updates long-lived resources.
2. **Sync IDs.** Pulumi stack outputs (D1 IDs, KV namespace IDs, bucket names) are written into each deployable's Wrangler config. Non-secret values are passed as `--var`, and secrets go through `wrangler-action`'s `secrets:`.
3. **`wrangler d1 migrations apply --remote`** runs migrations before any code that depends on them.
4. **`wrangler deploy`** deploys affected Workers only (Turborepo affected detection).
5. **Smoke E2E** runs Playwright against the deployed URL, and a failure blocks promotion.

Production deploys use the `prod` GitHub environment (with required reviewers where the plan allows; see [plan limits](#github-as-code)) and `concurrency` set to `cancel-in-progress: false` so a deploy is never cut off halfway. They also use Workers gradual deployments for percentage rollouts and instant rollback.

### GitHub Actions workflows

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | PRs (skips drafts) and pushes to `main` | Path filtering, `pnpm audit --prod`, a gitleaks scan of the full history, `pnpm verify`, a build, the Worker size budget, and Playwright with axe. 🚧 A `pulumi preview` of `infra/cloudflare` commented on the PR (skipped for forks) |
| `workflow-lint` job in `ci.yml` | Workflow changes, and every push to `main` | actionlint and zizmor, from checksum-verified release binaries |
| `lint-pr.yml` | PR opened, edited, or updated | Runs commitlint on the PR title, which becomes the squash commit on `main` |
| `preview.yml` 🚧 | PR opened or updated | Uploads preview versions of affected Workers and comments URLs |
| `deploy.yml` 🚧 | Merge to `main` (dev), dispatch (prod) | The five-step deploy above |
| `quality.yml` | Weekly schedule, and manual dispatch | Coverage and mutation testing reports as artifacts, with coverage in the run summary (informational, not gates) |

CI secrets are scoped per GitHub environment where the plan allows, and fall back to repository secrets otherwise. `infra/github` creates and writes all of them except `PULUMI_ACCESS_TOKEN`, which is set by hand once. See [GitHub as code](#github-as-code).

## Infrastructure (Pulumi)

`infra/` holds two Pulumi projects, both in TypeScript. They are kept separate because they need different credentials and change at different rates. Keeping them apart also means a mistake in one cannot touch the other.

| Project | Manages | Stacks | Runs from |
| --- | --- | --- | --- |
| `infra/cloudflare` | D1, R2, KV, Queues, and this suite's own hostnames (zone-wide settings and WAF only when the zone is dedicated) | `dev`, `prod` | CI (`pulumi up` in the deploy workflow) |
| `infra/github` | Repo settings, rulesets, environments, CI secrets, Cloudflare API tokens for CI | one per repo | A repo admin, locally. CI only previews it. |

### Cloudflare

Each stack (`dev`, `prod`) gets a baseline set of resources, all free at rest:

| Resource | Name | Purpose |
| --- | --- | --- |
| D1 database | `<prefix>` | Primary relational data |
| KV namespace | `<prefix>` | Config, flags, cached lookups |
| R2 bucket | `<prefix>-files` | Private uploads and exports |
| Queue | `<prefix>-jobs` | Background work for `apps/jobs` |
| Queue | `<prefix>-jobs-dlq` | Jobs that exhausted their retries |

`<prefix>` is `resourcePrefix` in the stack config (`flareling-dev`, `flareling-prod`). Data resources are `protect`ed in prod (`protectData`). The stack outputs (`d1DatabaseId`, `kvNamespaceId`, `r2FilesBucketName`, `jobsQueueName`, and so on) are the contract with Wrangler.

```sh
cd infra/cloudflare
pulumi stack init dev       # once; repeat for prod
pnpm preview
pnpm apply
```

The scripts run through `with-infra-token.sh`, which uses the same scoped infra token as CI by reading it from the `infra/github` stack. Nobody creates or copies a Cloudflare token for day-to-day work. An exported `CLOUDFLARE_API_TOKEN` takes precedence.

Guidelines:

- **Declare every stateful resource here,** not in the dashboard and not through Wrangler auto-provisioning.
- **Respect a shared zone.** flareling's hostnames are subdomains of `spencerwill.com`, a zone shared with other projects. In a shared zone this program only declares its own hostnames. A `ZoneSetting`, WAF rule, or other zone-wide resource would change behavior for every site in the zone, so those belong only in a repo that owns a dedicated zone.
- **Commit Wrangler configs with placeholder IDs.** `tooling/scripts/sync-env` replaces them with stack outputs at deploy time, so real IDs never need hand-editing. 🚧 This replaces the `sed` step used in ucmc with a typed script.
- **Deploy a Worker before attaching its domain.** A `WorkersCustomDomain` needs the Worker script to exist first, so a new app's hostname is added after its first Wrangler deploy.
- **Share across stacks with `StackReference`,** for example an email provider account owned by `prod`.

### GitHub as code

`infra/github` uses the Pulumi GitHub provider so every repo created from this template gets the same safeguards, set up by code and reviewed in PRs rather than clicked together in the settings UI.

It manages:

- **The repository itself:** description, visibility, template flag, squash-only merges titled from the PR (so `main` keeps Conventional Commits), delete branches after merge, and Dependabot alerts. The repo is `protect`ed in Pulumi and archived rather than deleted if it ever leaves the program.
- **A ruleset on the default branch:** no deletion or force pushes, linear history, PRs with resolved review threads, and required status checks once CI exists (`requiredChecks` in stack config). Repository admins can bypass, which keeps direct pushes working during setup and means nobody can be locked out.
- **Environments:** `dev` and `prod`, each deployable from `main` only. `prod` gets required reviewers (`prodReviewerIds`) where the plan allows.
- **CI secrets.** When `cloudflareAccountId` is set, Pulumi creates two least-privilege Cloudflare account tokens and writes them straight into GitHub. Nobody sees or copies a token, and destroying the stack revokes them. To rotate, run `pnpm apply --replace <token URN>`.
  - `CLOUDFLARE_API_TOKEN` is for Wrangler code deploys: Worker scripts, D1 migrations, routes.
  - `CLOUDFLARE_INFRA_API_TOKEN` is for `pulumi up` on `infra/cloudflare`.
  - `CLOUDFLARE_ACCOUNT_ID` is a plain repository variable.
  - The exact permissions live in `infra/github/src/cloudflare-tokens.ts`.

It does not manage:

- **Workflow files or `dependabot.yml`.** They already live in the repo.
- **`PULUMI_ACCESS_TOKEN`.** This is the one secret set by hand, because CI needs it before Pulumi can run.
- **Personal or organization settings.**

#### Plan limits

GitHub gates several of these features by plan and visibility. Set `plan` and `visibility` in the stack config, and the program decides what it can manage (`src/config.ts`). Anything unavailable is skipped instead of failing the run.

| Feature | Public repo | Private, Free | Private, Pro or Team | Private, Enterprise |
| --- | --- | --- | --- | --- |
| Repo settings, Dependabot alerts | ✓ | ✓ | ✓ | ✓ |
| Default-branch ruleset | ✓ | – | ✓ | ✓ |
| Environments, environment secrets, branch policies | ✓ | – (secrets go to repo level) | ✓ | ✓ |
| Required reviewers on `prod` | ✓ | – | – | ✓ (org repos) |
| Secret scanning and push protection | ✓ | – | – | With Secret Protection |

On a private personal repo, nothing can require a second person to approve `prod`. The practical safeguard there is that only `main` can deploy, and only collaborators with write access can trigger the dispatch.

#### Running it

The first time, create the stack and adopt the existing repository into it. `adopt` only imports into Pulumi state and changes nothing on GitHub.

```sh
cd infra/github
pulumi stack init main      # once per repo
pnpm adopt                  # once per repo: imports the existing repository
pnpm preview                # show the diff
pnpm apply                  # apply it
```

The scripts take the GitHub token from `gh auth token`, so a `gh auth login` with repo admin rights is all you need. To mint Cloudflare tokens, also run `pulumi config set cloudflareAccountId <id>` and `pulumi config set --secret cloudflare:apiToken <token>`, using a token that is allowed to create account API tokens.

Notes:

- **It runs locally by a repo admin, not in CI.** The Actions `GITHUB_TOKEN` cannot change repo settings or write secrets. CI should also never hold a credential that can loosen its own rules.
- **Changes made in the GitHub UI are reverted** on the next `pnpm apply`. Change the code instead.
- **Every repository setting is declared explicitly**, even ones that match GitHub's defaults. The provider treats an omitted optional field as "clear it."

## Data and storage

| Primitive | Use it for | Avoid it for |
| --- | --- | --- |
| **D1** | Relational product data, users, billing records, audit log | Hot counters, large blobs, unbounded single tables beyond the D1 size limit |
| **Durable Objects** | Realtime rooms, per-tenant state, locks, sequencing | General-purpose relational queries across entities |
| **R2** | Uploads, exports, backups. Use separate private and public buckets, and put the public one behind a cached custom domain. | Small, frequently updated values |
| **KV** | Feature flags, config, auth ceremony challenges, cached lookups | Anything that needs read-after-write consistency |
| **Queues** | Fire-and-forget work, fan-out, buffering spikes | Multi-step processes that need durable state between steps |
| **Workflows** | Onboarding flows, billing runs, long-running pipelines with retries and sleeps | Sub-second request/response work |
| **Rate limiting bindings** | Per-route and per-identity throttling | Exact global quotas (use a Durable Object) |

Migrations live in `libs/db/migrations` and are applied by CI before code deploys. Write migrations to be backward compatible (expand, deploy, contract) so a rollback never breaks the schema. A schema-drift test fails CI if the Drizzle schema and the migrations disagree.

## Cost efficiency

Defaults that keep the bill small:

- **Static assets are served free.** Marketing pages and app bundles use Workers static assets, with headers set in `public/_headers`.
- **Service bindings instead of HTTP.** Internal RPC calls skip the network and are not billed as extra requests.
- **Durable Objects use the WebSocket Hibernation API.** Idle connections do not accrue duration charges.
- **R2 has zero egress fees.** Serve public files from R2 through a cached custom domain.
- **Cache aggressively.** Use the Cache API and `Cache-Control` headers for anything public, and KV for read-heavy config.
- **Batch queue messages.** Consumers process messages in batches to reduce invocations.
- **Smart Placement where it helps.** Services that make many calls to a single backend can run close to it automatically.
- **Previews share dev resources.** PR previews never provision their own databases.
- **CI only does what changed.** Path filters and Turborepo remote caching skip untouched apps.
- **Budget alerts** are configured in Pulumi 🚧.

## Designing for scale

- **Shard by tenant early.** The Durable Object and D1 helpers accept a tenant key so you can move to per-tenant DOs or per-tenant D1 databases without rewriting call sites.
- **Keep Workers stateless.** All state lives in bindings, so Workers scale horizontally with no configuration.
- **Respect platform limits.** Track CPU time, subrequest counts, and D1 database size. Offload heavy work to Queues and Workflows.
- **Use D1 read replication** with the Sessions API for read-heavy paths.
- **Start in-process, split later.** Because server functions call `libs/core` rather than containing logic, moving a domain into its own app behind a service binding changes the call site, not the code.
- **Version contracts.** Once a domain becomes its own app, its RPC interface in `libs/contracts` is versioned so it can deploy independently of its callers.

## Testing

| Layer | Tooling | Notes |
| --- | --- | --- |
| Unit and integration | Vitest with `@cloudflare/vitest-plugin` | Runs in workerd with real D1, KV, R2, Queues, and DOs. Migrations are applied with `readD1Migrations`. Storage is isolated per test file. |
| Component | Storybook with `@storybook/addon-vitest` | Each story in `libs/ui` runs as a Vitest browser test in Chromium, with `play` interactions and an axe check (WCAG 2.1 A and AA) |
| Property-based | fast-check (`*.property.test.ts`) | For parsers, permissions, and anything with a large input space |
| E2E | Playwright, desktop and mobile projects | Runs against `vite preview` (the production build in workerd) in CI, and against a deployed URL with `E2E_BASE_URL`. Fails on console errors and uncaught exceptions. |
| Accessibility | `@axe-core/playwright` | Every E2E page check includes an axe scan against WCAG 2.1 A and AA |
| Contract | Vitest | Checks that internal apps satisfy the RPC interfaces their callers depend on (once any exist) |
| Mutation | Stryker (weekly, in `quality.yml`) | Pure modules only, in a plain-Node Vitest project (`vitest.mutation.config.ts`). Measures test quality and reports only |

## Security and supply chain

- **Release-age quarantine.** `minimumReleaseAge` in `pnpm-workspace.yaml` refuses packages published less than 7 days ago.
- **Trust policy.** `trustPolicy: no-downgrade` refuses a version whose publish provenance is weaker than an earlier one's. Exceptions are exact versions with a reason.
- **One version per dependency.** Every external version lives in the pnpm catalog (`catalogMode: strict`), and sherif checks the workspace for inconsistencies.
- **Secret scanning.** gitleaks scans staged changes in the pre-commit hook and the full history in CI. It's installed from a checksum-verified release in the dev container.
- **Explicit build scripts.** `allowBuilds` lists exactly which dependencies may run install scripts (esbuild, workerd, and so on).
- **Documented overrides.** Every security `overrides` entry cites its GHSA ID, and audit ignores are time-boxed.
- **Dependabot cooldowns.** Updates wait 7 days, or 30 for majors, and are grouped (TanStack, Cloudflare with Vitest, Pulumi, tooling). Actions, dev container features, and the Mailpit image are covered too.
- **Hardened Actions.** All actions are pinned to commit SHAs. `${{ }}` expressions never appear inside `run:` bodies; values pass through `env:`. zizmor and actionlint gate workflow changes.
- **Auth defaults.** `__Host-` cookies, Turnstile on public forms, rate-limiting bindings on auth routes, and RBAC permissions stored as data.
- `apps/admin` sits behind **Cloudflare Access**. WAF managed rules are declared in Pulumi.
- Secrets never touch the repo. Locally they live in gitignored `.env.local`. In CI they come from GitHub secrets that `infra/github` creates, or from Pulumi outputs.
- **Repo safeguards are code.** The default-branch ruleset, required checks, `prod` environment protection, and secret scanning are declared in `infra/github`, gated by what the GitHub plan supports.
- See [SECURITY.md](./SECURITY.md) for how to report vulnerabilities.

## Observability

- **Workers Logs** are enabled in every `wrangler.jsonc` (`observability.enabled`, with an explicit `head_sampling_rate`).
- **Structured JSON logs** come from `libs/log`, which redacts secrets and PII before anything is written.
- **Traces** use Workers' built-in tracing and can be exported over OpenTelemetry.
- **Analytics Engine** stores custom product and usage metrics cheaply.
- **Health endpoints** on each public Worker are used by the smoke tests.
- **An audit log table** in D1 records security-relevant actions.

## Working with AI agents

The repo is set up to work well with Claude Code and similar agents:

- **`CLAUDE.md`** holds the always-on rules: architecture invariants and platform gotchas.
- **`.claude/rules/*.md`** holds rules that load only for matching paths (for example auth, migrations, infra).
- **`.claude/agents/`** has reviewers for specific jobs: Pulumi changes, Worker deploy readiness, and PR preflight.
- **`.claude/skills/`** holds repeatable procedures, such as adding an app or writing a migration.
- **Hooks in `.claude/settings.json`** block edits to generated files (`*.gen.ts`, `worker-configuration.d.ts`).
- The dev container ships the Claude Code, Wrangler, Pulumi, and gh CLIs.

## Platform gotchas

Lessons learned the hard way:

- **D1 rejects statements with more than 100 bound parameters.** Chunk bulk inserts and large `IN (...)` lists.
- **Never read `env` at module scope.** Bindings are only available inside the request, queue, or scheduled handler.
- **Drizzle snapshots can drift** from the migrations directory. The schema-drift test catches this. If snapshots are already broken, write the migration SQL by hand rather than trusting `drizzle-kit generate`.
- **`wrangler-action` needs `environment: production`** for production. Without it, production secrets are uploaded to the default (dev) Worker.
- **pnpm 11 and later ignore `.npmrc`** for workspace settings. Put them in `pnpm-workspace.yaml`. Since pnpm 12, an unrecognized key there is a hard error (`ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`) because the repo pins its pnpm version, so typos fail fast instead of being silently ignored.
- **The pnpm store in dev containers.** `storeDir: node_modules/.store` in `pnpm-workspace.yaml` keeps the store on the `node_modules` volume, so packages hardlink instead of copying. pnpm 12 finds that spot on its own only when run from the repo root; run from a package directory, it would create a second full store at `/workspace/.pnpm-store` on the slow bind mount. The setting is relative, so it works from any directory, on the host, and in CI.
- **`catalogMode: strict` catalogs workspace packages too.** `pnpm add @flareling/config@workspace:*` writes `workspace:*` into the catalog and `"catalog:"` into `package.json`. Add workspace dependencies by editing `package.json` instead.
- **Upgrading from pnpm 11:** use `--no-frozen-lockfile` (`--frozen-lockfile false` was removed). Expect the first install to re-key some peer variants of cyclic dependencies once.

## Adding an app or lib

🚧 Generators are planned:

```sh
pnpm gen app <name> --type web       # TanStack Start app with public routes
pnpm gen app <name> --type internal  # Worker with a WorkerEntrypoint RPC class, no public routes
pnpm gen lib <name>                  # Source-only internal package
```

Until then, copy the closest existing app or lib.

For a new **app**:

1. Rename it in `package.json` and `wrangler.jsonc`, and tag it `app`.
2. Add any new resources to `infra/cloudflare`, and placeholder IDs to `wrangler.jsonc`.
3. Add an env schema in `libs/env` and an `.env.example`.
4. Run `pnpm cf-typegen`.
5. Add it to the deploy matrix in `.github/workflows/deploy.yml`.

For a new **lib**:

1. Rename it in `package.json`, tag it `lib`, and point `exports` at its `src/` entry files.
2. Add it as a `workspace:*` dependency of each app that uses it.

## Open decisions

Still being decided. Feedback welcome.

- **Authentication:** extract ucmc's magic link (Resend) and WebAuthn passkey implementation into `libs/auth`, or adopt Better Auth.
- **Lint stack:** Biome (as in www.spencerwill.com) or ESLint + Prettier (as in ucmc). This template defaults to Biome for speed and a single tool.
- **Preview deploys:** neither reference repo has per-PR previews yet. Decide whether they use Workers version preview URLs or a dedicated `preview` stack.
- **Public third-party API:** if the suite needs one, add `apps/public-api` with [Hono](https://hono.dev) and `@hono/zod-openapi` for versioned routes, API keys, and generated OpenAPI docs. Internal callers still use RPC.
- **Billing:** Stripe integration pattern (webhooks into Queues, entitlements in D1 or KV).
- **Multi-tenancy model:** shared D1 with tenant columns, or a D1 database per tenant.
- **Pulumi state backend:** Pulumi Cloud for now (the `infra/github` stack lives there). Self-managed R2 is still an option. Either way, `PULUMI_ACCESS_TOKEN` (or the R2 backend credentials) is the one CI secret set by hand.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). In short:

1. Create a branch from `main`.
2. Commit with Conventional Commits (`pnpm commit` helps).
3. Run `pnpm verify`.
4. Open a pull request with a semantic title. CI posts the Pulumi preview and preview URLs.

## License

[MIT](./LICENSE)
