# 0004. pnpm workspaces and Turborepo, with source-only libs

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

The apps, libs, tooling, and Pulumi programs need to share one lockfile and toolchain, and CI should only redo work that changed. Internal libraries that are compiled to `dist/` add a build step, source maps, and a class of "forgot to rebuild the lib" bugs, while every consumer is already a bundler (Vite or Wrangler).

## Decision

We will use pnpm workspaces with Turborepo, organized as `apps/*` (deployable Workers, tagged `app`), `libs/*` (tagged `lib`), `tooling/*` (dev-time only, tagged `tooling`), and `infra/*` (Pulumi, tagged `infra`). Boundary rules in the root `turbo.json` keep apps from depending on apps, and tooling from depending on apps or libs.

Libs are source-only: `exports` point at `src/*.ts`, there is no build step, and the consuming app's bundler compiles them. A `transit` task makes a lib change invalidate its dependents' caches. pnpm's version is pinned through `packageManager`, and Node through `.nvmrc`.

## Consequences

- No lib build step and no stale lib output. Editing a lib is immediately visible to every app.
- Libs must use syntax every consumer's bundler handles, and can't be published to npm as they are.
- Turborepo caching and `turbo boundaries` run in `pnpm verify` and in CI.
- Pulumi programs share the toolchain too, so they run on Node's type stripping (`typescript: false`) and must use erasable TypeScript syntax only.
