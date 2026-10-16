import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { coverage } from "@flareling/config/vitest/coverage";
import { defineConfig } from "vitest/config";
import { unstable_readConfig } from "wrangler";

// Tests run in workerd with the bindings from wrangler.jsonc, against a D1
// migrated with libs/db's migrations (test/apply-migrations.ts).
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          STRIPE_SECRET_KEY: "sk_test_123",
          STRIPE_API_BASE: "http://stripe.test",
          // So a test can check src/index.ts dispatches every cron declared.
          TEST_CRONS: unstable_readConfig({ config: "./wrangler.jsonc" })
            .triggers.crons,
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "../../libs/db/migrations"),
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
