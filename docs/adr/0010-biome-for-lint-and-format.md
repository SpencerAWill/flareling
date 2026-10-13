# 0010. Biome for linting and formatting

- **Status:** Proposed
- **Date:** 2026-10-12

## Context

The reference projects differ: www.spencerwill.com uses Biome, and ucmc.spencerwill.com uses ESLint and Prettier. ESLint has the larger plugin ecosystem (framework-specific rules, typescript-eslint's type-aware rules). Biome is one fast tool for linting, formatting, and import sorting, with one config file, and since 2.x it has its own type-aware rules such as `noFloatingPromises`.

This is still listed under "Open decisions" in the README. The template defaults to Biome until it's settled.

## Decision

Proposed: use Biome for linting, formatting, and import sorting everywhere, with the `recommended` preset plus type-aware promise rules (`noFloatingPromises`, `noMisusedPromises`). These matter on Workers, where a promise that is neither awaited nor passed to `ctx.waitUntil` is silently dropped. The pre-commit hook runs `biome check --write --error-on-warnings` on staged files.

## Consequences

- One tool and one config, fast enough to run on every save and commit.
- Rules that only exist as ESLint plugins aren't available. If one becomes essential, that is the trigger to revisit this decision rather than running both tools.
- The promise rules are in Biome's nursery group, so they may change between Biome versions.
