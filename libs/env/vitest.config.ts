import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { coverage } from "@flareling/config/vitest/coverage";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-01",
        // t3 checks `process.env` when given no runtimeEnv; ours always passes one.
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    coverage,
  },
});
