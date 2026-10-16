# Platform limits

Limits of Cloudflare and GitHub that can surface as runtime or CI failures, each from the official docs, with the source linked. Read on 2026-10-16. **Numbers change: re-check the source before relying on one, and update this page when you do.**

This template targets **Workers Paid** in deployed environments ([ADR 0016](./adr/0016-target-workers-paid.md)), so the Paid column is the one that applies there. Free values still matter for local accounts, and for anyone who adopts the template on Free.

"Applies": **now** means exercised by code or CI today; **later** means planned (README, infra) but not used yet; **no** means not relevant. **UNVERIFIED** means the docs don't say.

## How this repo handles the main risks

| Risk (details below) | Handling |
| --- | --- |
| R1: 10 ms CPU per request on Workers Free | Deployed environments are on Workers Free (ADR 0020, superseding 0016's Paid target), so this applies: keep server rendering lean and measure deployed CPU time. `limits.cpu_ms` is Paid-only and not set. Not detectable by local tests. |
| R2: a session request on every client navigation | The principal is cached on the client and refetched after sign-in or sign-out (`apps/web/src/lib/auth.ts`) |
| R3: no production email transport | Provider still to be chosen ([ADR 0015](./adr/0015-email-behind-an-interface.md)); a deployed (https) environment without one fails every request at startup, so a post-deploy smoke test catches it |
| R4, R5: Actions minutes and cache churn | PRs run desktop Chromium E2E only; all browsers on `main`. The turbo cache is saved only from `main`. Mutation testing is manual. |
| D1's 50-byte LIKE pattern limit | Text search uses `containsText` (`instr`), which has no pattern limit (`libs/db`) |
| R9: Worker size | `pnpm size` checks the real limit (64 MiB uncompressed) plus a gzip budget as a proxy for the 1 s startup limit |
| Static assets skip Worker middleware | `apps/web/public/_headers` sets their headers |
| R6, R7, R8, R10-R17 | Open: rules to follow, or work for the deploy pipeline. See each entry. |

## 1. Workers

Sources: L = https://developers.cloudflare.com/workers/platform/limits/ , P = https://developers.cloudflare.com/workers/platform/pricing/

| Limit | Free | Paid | Src | Applies |
|---|---|---|---|---|
| Requests | 100,000/day, resets 00:00 UTC. Over the limit: **Error 1027** (fail closed) or Worker bypassed (fail open, routes only) | 10M/month included, then $0.30/M | L, P | now |
| CPU time per HTTP request | **10 ms** | 30 s default, up to 5 min via `limits.cpu_ms` | L | **now** |
| CPU measurement | Only time spent running code; waiting on I/O (fetch, KV, D1) does not count. "Auth, SSR, or large payload parsing often use 10–20 ms." "Isolates tolerate occasional overruns. Consistent overruns get terminated" (1102, outcome `exceededCpu`) | same | L | now |
| Startup (global scope) | 1 s, separate from the CPU budget. Error **10021** "Script startup exceeded CPU time limit" | 1 s | L | now |
| CPU per Cron Trigger | 10 ms | 30 s (interval <1 h); 15 min (≥1 h) | L | later |
| Wall clock: HTTP | Unlimited while the client stays connected | same | L | now |
| Wall clock: Cron / Queue consumer / DO alarm | 15 min | 15 min | L | later |
| `ctx.waitUntil()` | Up to 30 s after the response is sent or the client disconnects | same | L | later |
| Memory | 128 MB per isolate (not per request); 1102 `exceededMemory`. Docs recommend Zod ≥ 4.5.0 (repo has ^4.6.5) | 128 MB | L | now |
| Subrequests (fetch and redirect hops) | **50** per invocation | 10,000 default (configurable up to 10M) | L | now |
| Subrequests to internal services (D1, KV, R2…) | 1,000 | matches configured limit | L | now |
| Simultaneous connections waiting for headers | 6 (a 7th is queued). Service-binding callees share the caller's limit | 6 | L | now |
| Request body | 100 MB (Free/Pro zone; this depends on the zone plan, not the Workers plan). 413 when exceeded | Business 200 MB, Enterprise more | L | later (R2 uploads) |
| Response body | No Worker limit; CDN cache object 512 MB | same | L | no |
| URL size | 16 KB | 16 KB | L | now (magic-link `redirect` param) |
| Request / response headers | 128 KB total each | same | L | now |
| Worker size | **64 MiB uncompressed. "There is no compressed size limit… The gzip value is shown for reference but is not a limit."** | 64 MiB | L | now (see Risk R9) |
| Workers per account | 100 | 500 | L | later (5 apps × dev/prod = 10) |
| Env vars + secrets per Worker | 64 | 128 | L | now (9 today) |
| Env var size | 5 KB each | 5 KB | L | now |
| Cron Triggers | **5 per account** | 250 | L | later |
| Routes per zone / custom domains per zone | 1,000 / 100 | same | L | later |
| Static asset files per version | 20,000 | 100,000 (Wrangler ≥ 4.34) | L | now |
| Static asset file size | 25 MiB | 25 MiB | L | now |
| `_headers` / `_redirects` | 100 rules, 2,000 chars per line / 2,000 static + 100 dynamic redirects | same | L | later |
| Static asset requests | "free and unlimited" (not billed as Worker requests) | same | P | now |
| Cache API | 50 calls per request on Free, 1,000 on Paid, shared with the subrequest quota; 512 MB object | | L | later |
| Log data per request | 256 KB (console, exceptions, metadata) | same | L | now |
| Same-zone Worker → Worker via global `fetch()` | Fails; use a Service Binding | same | L | later |
| `nodejs_compat` | `http2`, `vm`, `child_process`, `worker_threads`, `inspector`, `sqlite` and others are non-functional stubs. unenv polyfills "will either noop or will throw" (`[unenv] … is not implemented yet!`). AsyncLocalStorage is supported | same | https://developers.cloudflare.com/workers/runtime-apis/nodejs/ | now (libs/log uses ALS) |

### Workers Logs

Source: https://developers.cloudflare.com/workers/observability/logs/workers-logs/ and P.

| Limit | Free | Paid | Applies |
|---|---|---|---|
| Log events | **200,000/day** | 20M/month included, then $0.60/M | **now** (`head_sampling_rate: 1`) |
| Retention | 3 days | 7 days | now |
| Max size per log | 256 KB, then truncated (`$cloudflare.truncated`) | same | now |
| Account ceiling | 5 billion/day, then a 1% head sample | same | no |
| Behaviour after the Free 200k/day is used up | **UNVERIFIED** (not documented) | — | now |
| Pricing change | "Beginning December 1, 2026, Workers Logs will use Cloudflare Observability pricing" (new terms not documented: **UNVERIFIED**) | | **now (in 6 weeks)** |
| Version (preview) URLs | No logs through Workers Logs, `wrangler tail` or Logpush | | **now** |

---

## 2. D1

Sources: https://developers.cloudflare.com/d1/platform/limits/ , https://developers.cloudflare.com/d1/platform/pricing/ , https://developers.cloudflare.com/d1/worker-api/d1-database/ , https://developers.cloudflare.com/d1/best-practices/read-replication/

| Limit | Free | Paid | Applies |
|---|---|---|---|
| Databases per account | **10** | 50,000 | now (dev + prod) / later (per-tenant DBs) |
| Max database size | **500 MB** | 10 GB (cannot be raised) | now |
| Storage per account | 5 GB | 1 TB | now |
| Rows read | **5M/day**, counted as rows *scanned* (a full scan counts every row) | 25B/month, then $0.001/M | now |
| Rows written | **100,000/day**; each index on a written column adds +1 row written | 50M/month, then $1/M | **now** (audit_log has 4 indexes) |
| Over the daily limit | "queries fail" with limit-exceeded errors until 00:00 UTC | — | now |
| Queries per Worker invocation | **50** | 1,000 | now |
| Bound parameters per query | 100 (libs/db guards this) | 100 | now |
| SQL statement length | 100 KB | 100 KB | now (the `json_each` IN helper inlines JSON) |
| String / BLOB / row size | 2 MB | 2 MB | now |
| Query duration | 30 s, also for the whole `batch()` | 30 s | now |
| Columns per table | 100 | 100 | now |
| LIKE/GLOB pattern length | **50 bytes** | same | **now** (`likeContains` adds 2 `%` and escapes) |
| Args per SQL function | 32 | 32 | now |
| Simultaneous connections per invocation | 6 | 6 | now |
| Concurrency | Single-threaded per DB. A full queue returns "overloaded" | same | now |
| `batch()` | A SQL transaction: runs sequentially and rolls back the whole batch on error. Per-statement limits apply to each statement. Whether each statement counts toward the 50 queries/invocation: **UNVERIFIED** | same | now |
| Time Travel | 7 days (10 restores per 10 min) | 30 days | now |
| Read replication | Only through the Sessions API (`withSession`); otherwise everything goes to the primary. Replicas "may be arbitrarily out of date". Writes go to the primary. Turning it off takes up to 24 h. Free-plan availability **UNVERIFIED** | | later |
| Versions vs data | D1 state is not versioned with the Worker. Rollback is blocked if bound resources were modified or deleted (https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/) | | now |

## 3. KV

Sources: https://developers.cloudflare.com/kv/platform/limits/ , https://developers.cloudflare.com/kv/platform/pricing/ , https://developers.cloudflare.com/kv/concepts/how-kv-works/

| Limit | Free | Paid | Applies |
|---|---|---|---|
| Reads | 100,000/day | unlimited (billed) | later |
| Writes (different keys) / deletes / lists | **1,000/day each**; further ops "fail with an error" | unlimited | later |
| Writes to the same key | **1 per second** | 1/s | later |
| Ops per invocation | 1,000 (a bulk request counts as 1) | 1,000 | later |
| Key / metadata / value | 512 B / 1,024 B / 25 MiB | same | later |
| Storage | 1 GB | unlimited | later |
| Min `cacheTtl` | 30 s | 30 s | later |
| Consistency | "Changes may take up to 60 seconds or more to be visible in other … locations"; negative lookups are cached too | same | later |

## 4. R2, Queues, Durable Objects, Workflows, Rate Limiting, Turnstile, Email

### R2 (https://developers.cloudflare.com/r2/platform/limits/ , https://developers.cloudflare.com/r2/pricing/)

| Limit | Value | Applies |
|---|---|---|
| Free tier | 10 GB-month storage, 1M Class A, 10M Class B per month, free egress. Beyond that it is billed. Whether enabling R2 needs a payment method: **UNVERIFIED** (the pricing page doesn't say) | now (bucket created by Pulumi) |
| Object size / single PUT | 5 TiB / 5 GiB (multipart up to 10,000 parts) | later |
| Same-key writes | 1/s, else 429 | later |
| Key / metadata | 1,024 B / 8,192 B | later |
| Bucket management ops | 50/s per bucket | later |
| r2.dev | Rate limited, "not intended for production" | later |

### Queues (https://developers.cloudflare.com/queues/platform/limits/ , https://developers.cloudflare.com/queues/platform/pricing/)

| Limit | Free | Paid | Applies |
|---|---|---|---|
| Availability | Yes, on Free | | later (queues created by Pulumi) |
| Operations | **10,000/day** (write, read and delete each count, per 64 KB, so about 3 ops per message, about 3,300 messages/day). Over-limit behaviour **UNVERIFIED** | 1M/month, then $0.40/M | later |
| Retention | **24 h, fixed** (DLQ included) | up to 14 days | later |
| Message size | 128 KB (about 100 B of metadata included) | same | later |
| `sendBatch` | 100 messages or 256 KB | same | later |
| Consumer batch | 100 messages, 60 s max wait | same | later |
| Retries | 100 | same | later |
| `delaySeconds` | 24 h | same | later |
| Throughput | 5,000 msg/s per queue (throws "Too Many Requests") | same | later |
| Backlog | 25 GB per queue | same | later |
| Concurrent consumers | 250 | same | later |
| Consumer CPU / wall clock | 30 s default (up to 5 min) / 15 min | same | later |

### Durable Objects (https://developers.cloudflare.com/durable-objects/platform/limits/ , https://developers.cloudflare.com/durable-objects/platform/pricing/)

| Limit | Free | Paid | Applies |
|---|---|---|---|
| Backend | SQLite-backed only | SQLite (+ KV backend only on legacy accounts) | later |
| Requests / duration per day | 100,000 req, 13,000 GB-s; over the limit "operations… fail with an error" | billed | later |
| SQLite rows read / written | 5M / 100k per day | billed | later |
| Storage | 5 GB per account; per object 10 GB (table) vs "1 GB on the Free plan" (another section). **Docs conflict** | per object 10 GB | later |
| Classes | 100 | 500 | later |
| Key + value | 2 MB | same | later |
| SQL limits | 100 bound params, 100 KB statement, 2 MB row, 100 columns | same | later |
| CPU per request | 30 s default (up to 5 min) | same | later |
| WS message received | 32 MiB | same | later |
| Throughput | Soft limit of 1,000 req/s per object (single-threaded), then "overloaded" | same | later |
| WS billing | Incoming messages billed 20:1. Hibernation API stops duration billing once handlers finish | | later |
| Version URLs | Not generated for Workers that implement a DO | | later (apps/realtime is internal anyway) |

### Workflows (https://developers.cloudflare.com/workflows/reference/limits/)

| Limit | Free | Paid | Applies |
|---|---|---|---|
| Steps per instance | 1,024 (`step.sleep` excluded) | 10,000 (up to 25,000) | later |
| CPU per step | **10 ms** | 30 s (up to 5 min) | later |
| Step return / event payload | 1 MiB / 1 MiB | same | later |
| Persisted state per instance | 100 MB | 1 GB | later |
| Concurrent instances | 100 per account (waiting ones excluded) | 50,000 (the page also says 10,000: **docs conflict**) | later |
| Creation rate | 100/s | 300/s per account, 100/s per workflow | later |
| Completed instance retention | 3 days | 30 days | later |
| Max sleep | 365 days | same | later |
| "Max script size" | 3 MB | 10 MB (**contradicts** the Workers page's "no compressed size limit") | later |

### Rate Limiting binding (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

| Limit / behaviour | Value | Applies |
|---|---|---|
| `period` | Only 10 or 60 seconds | now (60) |
| Scope | Per Cloudflare location, per key | now |
| Accuracy | "Permissive, eventually consistent"; can briefly exceed the limit under concurrency | now |
| `namespace_id` | A positive integer as a string, unique per account. The same id **shares counters across Workers** | now ("1001") |
| Key guidance | Docs advise **against IP addresses** as keys (shared by many users) | now (`ip:` key) |
| Max namespaces | Not stated (**UNVERIFIED**) | — |
| Dashboard | Not shown in the dashboard; monitor 429s yourself | now |
| Wrangler | ≥ 4.36.0 | now (repo ^4.149) |
| Free-plan availability / local (Miniflare) behaviour | Not stated (**UNVERIFIED**) | now |

### Turnstile (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ , https://developers.cloudflare.com/turnstile/plans/)

| Limit | Value | Applies |
|---|---|---|
| Token lifetime | 300 s, single use (`timeout-or-duplicate`) | now |
| Widgets (Free) | 20, unlimited challenges | now |
| Siteverify rate limit | **UNVERIFIED** (not documented) | now |

### Email Service (https://developers.cloudflare.com/email-service/platform/pricing/ , https://developers.cloudflare.com/email-service/platform/limits/)

| Limit | Free | Paid | Applies |
|---|---|---|---|
| Sending to arbitrary recipients | **"Not available"** ("requires the Workers Paid plan") | 3,000/month included, then $0.35 per 1,000 | **now** (magic links) |
| Sending to verified destination addresses | Free on all plans | free | now (testing only) |
| Daily quota | "New accounts start with a conservative daily quota" (number not published: **UNVERIFIED**) | same | now |
| Message size | 5 MiB (25 MiB to verified destinations) | same | now |
| Recipients per message | 50 (to + cc + bcc) | same | now |
| Sender domain | Must be onboarded to Email Service | same | now |

## 5. Cloudflare account and API

| Limit | Value | Source | Applies |
|---|---|---|---|
| API rate limit | 1,200 requests per 5 min per user/token (dashboard + API combined); 200 req/s per IP; over the limit **all calls are blocked for 5 min** (429 + `retry-after`) | https://developers.cloudflare.com/fundamentals/api/reference/limits/ | now (Pulumi + wrangler) |
| API tokens | 50 user tokens, 500 account tokens | same | now (infra/github mints tokens) |
| Versions | Wrangler lists the 100 most recent; a deployment holds 1 or 2 versions (gradual split) | https://developers.cloudflare.com/workers/configuration/versions-and-deployments/ | now |
| Rollback | Only to the **100 most recently published versions**. Blocked if bound resources changed or were deleted, or a DO class lifecycle changed. Data is not rolled back | https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/ | now |
| Version (preview) URLs | Always on `*.workers.dev`; **public** unless Access protects them. An explicit `preview_urls` overrides the `workers_dev` default. Alias + "-" + Worker name ≤ 63 chars. Only the 1,000 most recent aliases are kept. No Workers Logs or tail. Not generated for DO Workers | https://developers.cloudflare.com/workers/configuration/previews/ | **now** |
| Cron propagation | Up to 15 min after deploy; times in UTC; local trigger `/cdn-cgi/local/scheduled` | https://developers.cloudflare.com/workers/configuration/cron-triggers/ | later |
| TanStack Start | Rsbuild is unsupported. Prerender uses local env/bindings at build time (`CLOUDFLARE_INCLUDE_PROCESS_ENV`). A custom server entry is needed for queue/scheduled/DO/Workflow exports | https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/ | now / later |
| Vite plugin and assets | Assets are served without running the Worker, so Start middleware (security headers) does not touch them; use `public/_headers`. Assets are reachable only from the entry Worker | https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/ | now |

## 6. GitHub (private repo, personal account, GitHub Free)

| Limit | Value | Source | Applies |
|---|---|---|---|
| Actions minutes | **2,000/month** (resets monthly); public repos are free | https://docs.github.com/en/billing/concepts/product-billing/github-actions | **now** |
| Exhausted quota | "If your account does not have a valid payment method on file, usage is blocked once you use up your quota" | same | now |
| Rounding | Each job is **rounded up to the next whole minute** | https://docs.github.com/en/billing/reference/actions-runner-pricing | **now** |
| Multipliers | Linux 1×, Windows 2×, macOS 10× | same | now (Linux only) |
| Artifact storage | 500 MB | billing page | now |
| Cache storage | 10 GB per repo. Entries unused for 7 days are evicted. Over the cap, the oldest-accessed entries are evicted first. PR caches can't be restored by base or sibling PRs | https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching | **now** |
| Artifact/log retention | Default 90 days, up to 400 days for private repos. From 2026-10-01 it also applies to checks and runs | https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization | now |
| Job / run time | 6 h per job; 35 days per run | https://docs.github.com/en/actions/reference/limits | now |
| Concurrency | 20 concurrent jobs (5 macOS) | same | now |
| Matrix | 256 jobs | same | no |
| `GITHUB_TOKEN` API | 1,000 req/h per repo | same | now |
| Workflow file | > 500 KB won't run | same | no |
| Scheduled-workflow auto-disable | "In a **public** repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days." Private repos: not stated (so not affected per docs). Forks of public repos have schedules disabled by default | https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows | later (repos made from the template, if public) |
| Dependabot-triggered runs | **Actions secrets are not available**; only Dependabot secrets. The `GITHUB_TOKEN` is read-only. Treated like a fork PR | https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-on-github-actions | later (deploy previews) |
| Default `GITHUB_TOKEN` | Read-only (`contents`, `packages`) for new personal-account repos; workflows can't create or approve PRs by default | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository | now |
| Fork PRs (private) | Off unless "Run workflows from fork pull requests" is enabled; write token and secrets are separate opt-ins | same | no (solo) |
| Rulesets / branch protection | Public repos only on Free; private needs **Pro/Team/Enterprise** | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets (+ search result for plan wording) | now (infra gates on `features.rulesets`) |
| Environments on Free private | Environment secrets, required reviewers, wait timers: **public only**. Deployment branch policies: Pro/Team for private | https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments | now (gated by `features.environments`) |
| Dependabot open PRs | Version updates: default 5 (repo sets 10). Security updates: a separate fixed 10. **Cooldown does not apply to security updates** | https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference | **now** |
| Per-semver cooldown | npm yes; GitHub Actions, devcontainers, docker-compose default-days only | same | now (already handled) |
| REST API | 5,000/h authenticated user; 60/h unauthenticated; secondary: 100 concurrent, 900 points/min, 80 content-creating/min and 500/h; 403/429 | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api | now (Pulumi GitHub provider, gh) |

---

## 7. Tests and Miniflare versus production

| Difference | Status |
|---|---|
| Free-plan 10 ms CPU, the 50-subrequest cap and 50 D1 queries per invocation are not enforced by `vite dev`/`vite preview`/vitest-pool-workers | **UNVERIFIED** (not documented; the known-issues page is silent). Assume tests will not catch them |
| Daily quotas (requests, D1 rows, KV writes, Logs, Queues ops) | Not emulated locally (**UNVERIFIED**, not documented) |
| KV eventual consistency, 1 write/s per key | Local is effectively consistent (**UNVERIFIED**) |
| Rate Limiting binding locally | Not documented (**UNVERIFIED**). E2E bypasses it with `E2E_BYPASS_RATE_LIMIT` |
| Fake timers don't affect the KV/R2/cache simulators; dynamic `import()` fails inside `exports.default.fetch()` handlers; storage is isolated per test file; native V8 coverage is unsupported | Documented: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/ |
| Version URL logs | Absent in production (documented); preview E2E failures cannot be tailed |
| Startup time | Measured on upload; Wrangler reports `startup_time_ms` (L). Local dev does not enforce the 1 s |

---

## Risks for this codebase, ranked

**R1. Free-plan 10 ms CPU on every SSR request (now, high likelihood).**
- *Exposed:* every page render. `__root.tsx` `beforeLoad` → `getSessionFn` → `loadSession` (SHA-256, Drizzle query build, row mapping) → `loadPrincipal` (a `db.batch` plus a permissions query), then React 19 SSR of the route tree, TanStack router serialization, and zod validation in server functions. Start middleware (ALS, header copy) adds to that. Cloudflare's own page says "Auth, SSR… often use 10–20 ms." The two cheap parts are WebCrypto SHA-256 (native, tiny) and `getEnv()` (zod parse cached per isolate).
- *Symptom:* intermittent then persistent **Error 1102** "Worker exceeded resource limits" (`exceededCpu`), a 5xx page. It looks fine at low traffic because occasional overruns are tolerated.
- *Detect locally:* no (UNVERIFIED but assume).
- *Protection:*
  - (a) Decided: stay on **Workers Free** for now (ADR 0020). Paid ($5/mo) remains the fix if CPU overruns appear, and would also unlock Email Service (R3).
  - (b) On Paid, set `limits.cpu_ms` (for example 50–100) as a runaway guard.
  - (c) Add a CPU budget check: an E2E/smoke job that hits `/`, `/my/account` and `/sign-in` on the deployed preview and reads `cpuTimeMs` from Workers Logs invocation events, or the Workers Analytics GraphQL `cpuTimeP50/P99`. Fail above about 8 ms p50 (Free) or a chosen p99 (Paid).
  - (d) Locally, profile one SSR request with DevTools (`vite preview`, inspector) and record a baseline in docs.
  - (e) Prerender or cache public pages (marketing) so they are served as free static assets.

**R2. Request quota and per-navigation server calls (now, medium).**
- *Exposed:* root `beforeLoad` runs on **every client-side navigation** too, so each navigation is an extra Worker request plus 2–4 D1 queries, against 100k requests/day and 5M rows read/day.
- *Symptom:* **Error 1027** after the daily cap, or D1 "limit exceeded" errors until 00:00 UTC.
- *Detect locally:* no.
- *Protection:* cache the principal in router context with a staleTime, or only refetch on auth-changing actions. Set route fail mode deliberately. Add a Cloudflare usage notification or budget alert (README lists budget alerts as 🚧).

**R3. Magic-link email cannot be sent in production on Workers Free (now, certain if deployed).**
- *Exposed:* `libs/email` has only a Mailpit transport. With no `MAILPIT_URL` in production, `send` rejects with `EmailNotConfiguredError`, so `requestMagicLink` throws and the server function returns 500. The response padding still runs in `finally`.
- *Why it matters:* Cloudflare Email Service to arbitrary recipients is **"Not available"** on Workers Free (Paid: 3,000/month). There is also an unpublished "conservative daily quota" for new accounts.
- *Protection:*
  - Pick a provider (CF Email Service on Paid, or a third party) before the first production deploy.
  - Add an env rule: in a secure (https) environment, require a configured transport (fail `getEnv()` at the first request instead of at sign-in).
  - Send through a Queue (README intends this) so provider outages and quotas don't fail the request. Mind the Free Queues limits: 10k ops/day, 24 h retention.

**R4. GitHub Actions minutes: 2,000/month, and each job is rounded up (now, high).**
- *Estimate:* per PR push, `paths` 1 + `audit` about 2 + `secrets` 1 + `verify` about 10–15 (apt `install-deps` for chromium+webkit on every run, Storybook browser tests, build, E2E across 3 Playwright projects with `retries: 2`) + `workflow-lint` 1 (when triggered) + `lint-pr` about 1–2, which also runs on every title or body `edited`. That is roughly **16–22 billable minutes per push**, and pushes to main re-run everything.
- At weekly Dependabot (npm groups plus 3 other ecosystems, often 6–10 PRs), with rebases and merges, Dependabot alone can use **≈1,000–1,500 min/month**. `quality.yml` adds about 4 × 35 min (mutation testing can be long).
- *Symptom:* runs blocked for the rest of the month (no payment method), and required checks never report.
- *Protection:*
  - Add a minutes report: the `gh api` billing usage endpoint in a weekly job, or check monthly.
  - Run `lint-pr` with `types: [opened, edited, reopened]` only, and without `pnpm install` (cache it or use npx commitlint with a lockfile-cached store).
  - Skip E2E mobile projects on PRs (desktop-chromium only) and run all 3 on main.
  - Set Playwright `retries: 1`.
  - Set Dependabot npm to `interval: monthly` or merge the groups into fewer PRs.
  - Make `quality.yml` monthly, or gate mutation testing on `workflow_dispatch` only.
  - Keep repo private, or consider public, where minutes are free.

**R5. Actions cache thrash: 10 GB cap, 7-day eviction, PR cache isolation (now, medium).**
- *Exposed:* `turbo-${{ github.sha }}` saves a new entry on **every run** (PR caches can't be shared across PRs), alongside the pnpm store cache and the Playwright browser cache. Eviction is by last access. It can push the Playwright and pnpm caches out, and every run then re-downloads browsers, adding about 1–3 min.
- *Protection:* save the turbo cache only on `push` to main (`actions/cache/restore` on PRs, `actions/cache/save` on main), or prune old `turbo-` keys with `gh cache delete` in a weekly job. Watch `gh cache list` size.

**R6. Dependabot security updates ignore `cooldown`, so `minimumReleaseAge` makes install fail (now, medium).**
- *Exposed:* `pnpm-workspace.yaml` `minimumReleaseAge: 10080`. Security PRs (separate limit of 10) can propose a version younger than 7 days.
- *Symptom:* `pnpm install --frozen-lockfile` fails with a release-age error on those PRs.
- *Protection:* document that the fix is to wait for the version to age (or add a temporary `minimumReleaseAgeExclude` entry with a reason). Optionally add a CI step that detects that error and posts a clear message.

**R7. Dependabot PRs have no Actions secrets and a read-only token (later, certain when deploy previews land).**
- *Exposed:* a future PR-preview deploy (wrangler `versions upload --preview-alias`) needs `CLOUDFLARE_API_TOKEN`, which is not available in Dependabot runs.
- *Symptom:* the preview deploy fails, blocking a required check.
- *Protection:* either duplicate the preview token as a **Dependabot secret** (managed by infra/github Pulumi via `github.DependabotSecret`), or skip preview jobs with `if: github.actor != 'dependabot[bot]'` and keep them non-required. Never switch to `pull_request_target` with checkout of PR code.

**R8. Workers Logs volume and the Dec 1, 2026 pricing change (now, medium).**
- *Exposed:* `head_sampling_rate: 1` plus `console.info` events (`email.sent`, warnings) plus invocation logs, against 200k events/day on Free. At the 100k requests/day cap, that is 2+ events per request. Over-quota behaviour on Free: UNVERIFIED. The Observability pricing change is 6 weeks out.
- *Protection:* make `head_sampling_rate` per environment (prod around 0.1–0.25; errors are still visible via analytics). Make `LOG_LEVEL=warn` the prod default. Add a unit test that the logger emits nothing below threshold (exists). Add a code rule of no per-row logging. Re-check pricing after Dec 1.

**R9. Worker size guard is calibrated to a limit that no longer exists (now, low runtime risk, wrong doc).**
- *Exposed:* `tooling/scripts/src/check-worker-size.ts` and the `ci.yml` comment say "Free plan caps a Worker at 3 MB compressed (Paid: 10 MB)". The Workers limits page (updated 2026-10-12) says **64 MiB uncompressed, no compressed limit**. The Workflows page still lists 3 MB/10 MB "max script size" (docs conflict).
- *Protection:* keep a gzip budget as a **startup-time/perf proxy** (startup is limited to 1 s, error 10021). Add an uncompressed check against 64 MiB, and record `startup_time_ms` from `wrangler deploy`/`versions upload` output in CI. Fix the comments to cite the current page.

**R10. D1 daily writes and table growth (now, low→medium).**
- *Exposed:* the sign-in path writes about 12–16 rows-written. Examples: a magic_links insert (+2 indexes), a sessions insert (+3), audit_log (+4 indexes), session deletes, user/email/role inserts for new users. `loadSession` refreshes `expires_at` (indexed). `magic_links`, `sessions`, `webauthn_challenges` and `audit_log` grow without cleanup, toward the 500 MB per DB on Free.
- *Protection:*
  - ✅ A daily cleanup Cron in apps/jobs (`17 3 * * *`, `runRetentionSweeps`) deletes expired sessions, magic links and WebAuthn ceremonies, and Stripe event ids older than 30 days, in bounded batches. One trigger per deployed Worker, but Free allows 5 per account and ucmc uses 4, so `sync-env` strips the cron from deployed configs for now (ADR 0020); run the sweep by hand until then.
  - ✅ Keep the `expires_at` indexes (present); `libs/db/src/retention.test.ts` checks each sweep's delete uses its index (`EXPLAIN QUERY PLAN`).
  - Add a test that every query on hot paths uses an index (`EXPLAIN QUERY PLAN` in vitest-pool-workers asserts no `SCAN`). This catches full-scan rows-read blowups locally.

**R11. D1 queries per invocation (50 Free) and subrequests (50 fetch on Free) (later, low now).**
- *Today:* the heaviest path (`consumeMagicLink`) is about 8–10 D1 calls plus 0 fetches. `requestMagicLink` makes 1 Turnstile fetch and 1 email fetch. Fine today; N+1 loops in future libs/core are the risk.
- *Symptom:* "Too many API requests by single worker invocation" / subrequest errors.
- *Detect locally:* no (UNVERIFIED).
- *Protection:* wrap `getDb()` with a Drizzle logger that counts queries per request (ALS context already exists) and log `dbQueries` in the request log. Add a vitest helper `expectQueryCount(fn, max)`. Code rule: no awaited queries in loops; use `batch`/`inJsonArray`.

**R12. Rate-limit semantics (now, low).**
- IP keys are discouraged (shared NAT, CGNAT, mobile carriers), so legitimate users get silently no-op'd. `requestMagicLink` returns `{ok:true}` without sending, which is confusing but by design.
- Limits are per location and eventually consistent, so an attacker using many PoPs gets N× the limit.
- `withinRateLimit` fails open on binding errors.
- `namespace_id "1001"`: every future Worker that reuses it **shares counters**.
- *Protection:* a namespace-id registry in docs/infra (unique per binding). Rely on per-email keys plus Turnstile for real protection. Add an alert on the `auth.rate_limit_unavailable` log.

**R13. Version (preview) URLs are public, on workers.dev, and without logs (now, medium for security and debugging).**
- `preview_urls: true` exposes every uploaded version publicly (sharing the **dev** D1).
- Previews can't be tailed.
- Alias + "flareling-web" must be ≤ 63 chars, and only the last 1,000 aliases are kept.
- *Protection:* put Cloudflare Access on version URLs (Pulumi). Use short `pr-<n>` aliases. Have E2E-on-preview upload the Playwright trace as an artifact instead of relying on logs.

**R14. Rollbacks and migrations (later, medium).**
- Rollback is limited to the last 100 versions and is blocked when bound resources change. D1 data/schema is never rolled back.
- *Protection:* a doc rule for expand/contract migrations (code N-1 must run on schema N). Run migrations before deploy, and add a CI check that the previous release's tests pass against the new migrations.

**R15. Cloudflare API 1,200 req per 5 min per token (later, low).**
- Pulumi `refresh/up` over many resources, run in parallel with several wrangler deploys under one token, can trigger a **5-minute total block**.
- *Protection:* separate tokens per job kind (infra/github already mints per-kind tokens), serialize deploy jobs with `concurrency`, and use Pulumi `--parallel` defaults conservatively.

**R16. GitHub Free private: no rulesets/branch protection, no environment secrets or reviewers (now, governance).**
- infra/github already gates these (`features`). The consequence is that prod deploy secrets must be repo-level and readable by any workflow on any branch, and nothing enforces required checks.
- *Protection:* deploy workflows trigger only on `push` to `main` with `if: github.ref == 'refs/heads/main'`. Document this, and consider GitHub Pro ($4/mo) when deploys go live.

**R17. Other "later" traps to encode as doc rules now:**
- KV is 1 write/s per key and 1,000 writes/day on Free, so never use it for counters or sessions.
- Queues Free retention is 24 h, including the DLQ, so a DLQ is not durable storage on Free.
- Workflows Free has 10 ms CPU per step and 100 concurrent instances.
- DO Free is SQLite-only with 100k requests/day, and DO Workers get no version URLs.
- Cron triggers are 5 per **account** on Free.
- `waitUntil` gets 30 s after the response.
- Same-zone Worker-to-Worker `fetch()` fails, so use service bindings.
- Static assets bypass Start middleware, so security headers for assets must go in `public/_headers` (≤100 rules).
- `nodejs_compat` stubs (`child_process`, `vm`, `worker_threads`…) can import fine and then throw at runtime. Keep the existing "dev runs in workerd" plus E2E-on-preview gate.
