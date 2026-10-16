import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { coverage } from "@flareling/config/vitest/coverage";
import { defineConfig } from "vitest/config";

// Tests run in workerd against a real (Miniflare) D1. The migrations are read
// from disk once per run and handed to the runtime as TEST_MIGRATIONS, and
// test/apply-migrations.ts applies them before each test file. Storage is
// isolated per file, not per test, so a test that writes must use ids that
// can't collide with other tests in the same file.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "migrations"),
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
