import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { coverage } from "@flareling/config/vitest/coverage";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-01",
        // AsyncLocalStorage (log context) comes from node:async_hooks.
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    // fast-check's first `unit: "binary"` string costs about 250 ms to set up
    // here, and over Vitest's 5 s default on a CI runner busy with every
    // other package's tests (as in apps/web).
    testTimeout: 30_000,
    coverage,
  },
});
