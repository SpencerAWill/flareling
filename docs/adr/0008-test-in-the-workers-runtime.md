# 0008. Test in the Workers runtime and against the production build

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

Workers differ from Node in ways tests run on Node won't catch: missing or flagged built-ins, request-scoped bindings, isolate behavior, and Cloudflare's storage APIs. Browser tests against `vite dev` exercise on-demand transforms rather than the bundle that ships, so a chunking or hydration problem in the real build stays hidden until deploy.

## Decision

We will run unit and integration tests with Vitest and `@cloudflare/vitest-plugin`, inside workerd with the bindings and compatibility settings from each app's `wrangler.jsonc` (libs set them in their Vitest config). App integration tests call the real fetch handler through `exports.default.fetch()`.

Components are the exception, because they render in the browser: `libs/ui`'s Storybook stories run as Vitest browser tests in Chromium (`@storybook/addon-vitest`), each with an axe check.

End-to-end tests use Playwright against `vite preview`, which serves the production build through workerd, on desktop Chromium plus mobile Chrome and mobile Safari (WebKit). Every E2E test also fails on console errors or uncaught exceptions, and pages are checked with axe against WCAG 2.1 A and AA. The same suite runs against a deployed URL through `E2E_BASE_URL`.

## Consequences

- Tests exercise the same runtime and artifact as production, at the cost of slower startup than Node-only unit tests.
- Vitest's version is tied to the range `@cloudflare/vitest-plugin` supports, so the two are upgraded together.
- Mutation testing (Stryker) can't afford a workerd boot per mutant, so it runs a plain-Node Vitest project over pure modules only.
- Coverage has to use Istanbul, since V8 coverage doesn't work in workerd. Storage is isolated per test file, so every response body has to be consumed.
- Playwright needs browser binaries: the dev container installs them into a volume, and elsewhere `pnpm --filter @flareling/web test:e2e:install` does. It also costs CI minutes, so it runs in the same job as the build.
