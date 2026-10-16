import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { coverage } from "@flareling/config/vitest/coverage";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// Kept apart from vite.config.ts: `cloudflareTest()` takes the place of
// `cloudflare()` from @cloudflare/vite-plugin, and the two do not share a
// config. Tests run inside workerd with the bindings and compatibility settings
// from wrangler.jsonc.
export default defineConfig({
  plugins: [
    cloudflareTest({
      // wrangler.jsonc's `main` is a package specifier, which the test pool
      // would resolve as a path relative to this directory. This local module
      // re-exports the same entry.
      main: "./test/worker.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      // Secrets the app reads from .env.local in development. Stripe calls go
      // nowhere: the webhook tests only verify signatures and enqueue.
      miniflare: {
        bindings: {
          STRIPE_SECRET_KEY: "sk_test_123",
          STRIPE_WEBHOOK_SECRET: "whsec_test",
        },
      },
    }),
    // Provides the virtual modules (the route tree, the router entry) that
    // Start's server entry imports. Without it the Worker fails at load.
    tanstackStart(),
    // Not strictly required for SSR tests, but keeps the JSX transform the
    // same as the production build.
    viteReact(),
  ],
  test: {
    // The first request in a file also compiles Start's server entry. That
    // takes about a second here, but over 5 s (Vitest's default) on a CI
    // runner busy with every other package's tests.
    testTimeout: 30_000,
    // e2e/ is Playwright's (playwright.config.ts), run by `test:e2e`.
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage,
  },
});
