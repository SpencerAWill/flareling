import { defineConfig, devices } from "@playwright/test";

// Same port as `preview` in vite.config.ts, published by the dev container.
const PREVIEW_PORT = 4173;

// Set to run the suite against a deployed URL (the post-deploy smoke test)
// instead of a local preview server.
const deployedUrl = process.env.E2E_BASE_URL;

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
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
          command: "pnpm preview",
          url: `http://localhost:${PREVIEW_PORT}/api/health`,
          reuseExistingServer: !isCI,
          timeout: 60_000,
        },
      }),
});
