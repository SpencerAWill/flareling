import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    // Explicit rather than Vitest's default, which also matches *.spec.ts.
    // It also lets knip's Vitest plugin see these files as entry points: it
    // only derives test entries from a config that has a `test` block.
    include: ["src/**/*.test.ts"],
  },
});
