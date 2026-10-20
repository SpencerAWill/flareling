# 0021. One pipeline from check to prod, with prod behind an approval

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

CI ran in `ci.yml`, and deploys were planned as a separate `deploy.yml` (push for dev, dispatch for prod) with Wrangler environments for prod. Before building them we compared the shapes GitHub supports:

- **Separate deploy workflow on `push`:** either re-runs every check (twice the work) or deploys without waiting for them.
- **`workflow_run`:** fires only from the default branch's copy of the workflow, gets secrets and a write token even when the triggering run had neither, splits one pipeline across two run pages, and passes artifacts GitHub warns may contain executable code.
- **Deploy jobs in the CI workflow** (`needs:` the checks): deploys exactly what passed, in one run page, and "re-run failed jobs" re-runs only the deploy.

Promotion: a Workers version belongs to one Worker, so dev's version can't be "promoted" to prod's Worker; the honest equivalent is the same commit and lockfile rebuilt with prod config. GitHub environments can make a job wait for a reviewer, but on GitHub Free only in public repos, which also get Actions minutes free. The repo is going public for that reason.

## Decision

- **One workflow, `cicd.yml`**, for every PR and every push to `main`. Its `check:` jobs run on both; on `main`, `deploy: dev` follows them, then `deploy: prod`.
- **Prod is the same run, approved.** `deploy: prod` needs `deploy: dev` (deployed and smoke-tested) and waits on the `prod` environment's required reviewer. It runs only when infra/github reports that the reviewer requirement exists (`PROD_APPROVAL_REQUIRED`), so a repo without one never deploys prod unattended.
- **The deploy steps are a local composite action, `.github/actions/deploy`**, used by two ordinary jobs in `cicd.yml`, one per environment. Each job names its GitHub environment and passes that environment's secrets to the action as inputs, as ucmc.spencerwill.com does. The first version was a reusable workflow (`deploy.yml`), but environment secrets never reached it, declared as `workflow_call` secrets or not, so the first dev deploys ran with no Cloudflare token. Each deploy is **one job**: every job naming a protected environment asks for its own approval. Order: `pulumi up`, `sync-env`, build, D1 restore point, migrate, deploy `apps/jobs` then `apps/web`, smoke test, and on prod a `wrangler rollback` if the smoke test fails.
- **No Wrangler environments.** One `wrangler.jsonc` per app; `sync-env` points it at the stack.
- **Names:** check jobs `check: <what>`, deploy jobs `deploy: <environment>`. Grouping by workflow name ("CI / lint") is more common, but checks and deploys share a workflow here, and the prefixes keep them apart. The ruleset requires only `required`, an aggregate of every check, so renaming a check can't break it.
- **Off until it can work:** deploys run only when `DEPLOYS_ENABLED` is `true`. A deployed environment won't start without an email provider (ADR 0015).
- **Secrets:** Cloudflare tokens and app secrets are environment secrets (readable only by a job deploying to that environment, from `main`); the deploy jobs read them directly. Pulumi Cloud is reached through GitHub OIDC (`pulumi/auth-actions`, `id-token: write`), so no Pulumi token is stored (replaced the `PULUMI_ACCESS_TOKEN` repo secret on 2026-10-20).

## Consequences

- One run page shows a commit's checks, its dev deploy, and its prod approval and deploy. A run waiting for approval uses no runner time; approvals expire after 30 days.
- Each environment deploys one run at a time, never cancelled halfway (`cancel-in-progress: false`). Whether a newer run's waiting prod deploy replaces an older one, so only the latest commit is promoted, follows from GitHub's concurrency rules but is **unverified** until the first real runs.
- Migrations must only add (expand now, contract in a later release): prod migrates days after dev, rollback is code-only, and the D1 bookmark recorded before each migration (7 days of Time Travel on Free) is the only way back for data.
- Smoke tests can't sign in, since deployed sign-in emails go to real inboxes, so they cover health, headers, public pages and the signed-out redirect.
- PRs that touch infra get a `pulumi preview` of every stack, one sticky comment per stack (added 2026-10-19). They run in a separate `preview` environment with a read-only Cloudflare token and an OIDC-issued Pulumi token, behind a reviewer, because that Pulumi token can read every stack's secrets (README, "Pulumi previews on PRs").
- Not built yet: PR previews of `apps/web`, a manual "redeploy this commit" path, and alerting beyond GitHub's failure emails.
