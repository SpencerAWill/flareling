import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { coverage } from "@flareling/config/vitest/coverage";
import { defineConfig } from "vitest/config";

// Like libs/db: tests run in workerd against a D1 migrated with libs/db's
// migrations (test/apply-migrations.ts), isolated per test file.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "../db/migrations"),
          ),
        },
      },
    })),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
    coverage,
  },
});
