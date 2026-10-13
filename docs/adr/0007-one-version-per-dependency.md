# 0007. One version per dependency, through a strict catalog

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

As apps are added, each one tends to pick up its own version of React, TanStack, Wrangler, and so on. Mismatched copies cause subtle bugs (two Reacts, plugins built against a different Vite) and turn upgrades into one PR per app.

## Decision

We will keep every external dependency's version in the `catalog:` section of `pnpm-workspace.yaml`, and packages reference it as `"catalog:"`. `catalogMode: strict` makes `pnpm add` write new dependencies to the catalog, and refuse a version outside an existing entry's range instead of adding a second copy. sherif runs in `pnpm verify` to catch other workspace inconsistencies.

## Consequences

- One edit upgrades a dependency everywhere, and Dependabot proposes one bump per catalog entry.
- Moving one app to a new major means moving all of them, or deliberately adding a named catalog for the exception.
- The catalog is the single place to read the stack's versions, grouped by concern.
