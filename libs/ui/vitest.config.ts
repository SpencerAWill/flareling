import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { coverage } from "@flareling/config/vitest/coverage";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Two projects, because the code runs in two places. Components render in the
// browser, so stories run as tests in Chromium (Vitest browser mode through
// Playwright), with addon-a11y's axe check on each. Everything else runs in
// workerd, where apps also server-render these components, matching the rest
// of the workspace.
export default defineConfig({
  test: {
    coverage,
    projects: [
      {
        extends: true,
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: "2026-10-01",
              compatibilityFlags: ["nodejs_compat"],
            },
          }),
        ],
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        plugins: [storybookTest({ configDir: ".storybook" })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
