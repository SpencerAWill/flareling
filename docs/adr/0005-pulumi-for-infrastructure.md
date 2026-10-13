# 0005. Pulumi for infrastructure, as two projects

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

Every project created from the template needs the same Cloudflare resources (D1, KV, R2, Queues, hostnames) and the same GitHub safeguards (repo settings, rulesets, environments, CI secrets). Clicking them together in dashboards doesn't repeat reliably and leaves no review trail. Wrangler can auto-provision some resources, but only for Cloudflare, and outside any review.

## Decision

We will declare infrastructure in Pulumi with TypeScript, the same language and toolchain as the code, as two separate projects:

- `infra/cloudflare` (stacks `dev` and `prod`): long-lived resources and this suite's own hostnames. It runs in CI as the first step of a deploy.
- `infra/github` (one stack): repo settings, rulesets, environments, and the least-privilege Cloudflare tokens CI uses. A repo admin runs it locally, and CI only previews it.

They are separate because they need different credentials, change at different rates, and a mistake in one should not be able to touch the other. Wrangler configs carry placeholder IDs that are filled from stack outputs at deploy time.

## Consequences

- Every stateful resource is declared in code, never in the dashboard or through Wrangler auto-provisioning. Data resources are `protect`ed in prod.
- In a zone shared with other sites (`spencerwill.com` today), only this suite's hostnames are declared: no zone-wide settings or WAF rules, which would change every site in the zone.
- `PULUMI_ACCESS_TOKEN` is the one secret set by hand. The Pulumi GitHub provider clears optional fields that are left out, so every repo setting is declared explicitly.
- What GitHub can enforce depends on the plan, so rulesets and environment protection are gated on it in `infra/github/src/config.ts`.
