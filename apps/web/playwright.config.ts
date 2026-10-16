import { defineConfig, devices } from "@playwright/test";
import { STRIPE_WEBHOOK_SECRET } from "./e2e/stripe.ts";

// Same port as `preview` in vite.config.ts, published by the dev container.
const PREVIEW_PORT = 4173;

// Set to run the suite against a deployed URL (the post-deploy smoke test)
// instead of a local preview server.
const deployedUrl = process.env.E2E_BASE_URL;

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  // Against a deployed environment, only the post-deploy checks run: the rest
  // of the suite needs Mailpit, stripe-mock and the E2E rate-limit bypass.
  ...(deployedUrl ? { grep: /@smoke/ } : {}),
  fullyParallel: true,
  forbidOnly: isCI,
  // One retry in CI absorbs a rare flake without tripling a failing run.
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: deployedUrl ?? `http://localhost:${PREVIEW_PORT}`,
    trace: "on-first-retry",
  },

  // Desktop plus one phone per engine. WebKit is the closest Playwright gets
  // to iOS Safari, where layout and touch handling most often diverge.
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 15"] } },
  ],

  // `vite preview` serves the production build (dist/) through workerd, the
  // same artifact `wrangler deploy` ships, so these tests exercise the real
  // bundle rather than the dev server's on-demand transforms. Turborepo's
  // `test:e2e` task builds first.
  ...(deployedUrl
    ? {}
    : {
        webServer: {
          // Fresh local D1 schema, then the production build in workerd.
          command: "pnpm db:migrate:local && pnpm preview",
          url: `http://localhost:${PREVIEW_PORT}/api/health`,
          reuseExistingServer: !isCI,
          timeout: 60_000,
          // Passed into the Workers (CLOUDFLARE_INCLUDE_PROCESS_ENV): the
          // origin the app is served from, where to send email, the rate-limit
          // bypass, since the suite signs in more often than the limit allows,
          // and Stripe pointed at stripe-mock (apps/jobs reads the same vars).
          env: {
            CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
            APP_BASE_URL: `http://localhost:${PREVIEW_PORT}`,
            MAILPIT_URL: process.env.MAILPIT_URL ?? "http://mailpit:8025",
            E2E_BYPASS_RATE_LIMIT: "1",
            STRIPE_SECRET_KEY: "sk_test_e2e",
            STRIPE_WEBHOOK_SECRET,
            STRIPE_API_BASE:
              process.env.STRIPE_API_BASE ?? "http://stripe-mock:12111",
          },
        },
      }),
});
