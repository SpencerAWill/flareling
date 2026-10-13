/**
 * Shared Vitest coverage options. Spread into each package's `test.coverage`,
 * and only used by `test:coverage` (`vitest run --coverage`).
 *
 * The provider must stay `istanbul`: V8 coverage doesn't work in workerd, where
 * the Workers test pool runs, so switching to Vitest's faster default would
 * silently report nothing for server code.
 *
 * Coverage is a report, not a gate, so there are no thresholds. A number
 * picked before there is a baseline is arbitrary, and a failing threshold
 * rewards tests that execute lines over tests that assert behavior. The
 * weekly quality.yml workflow publishes the report.
 */
export const coverage = {
  provider: "istanbul" as const,
  reporter: ["text-summary", "html", "json-summary"],
  reportsDirectory: "coverage",
  exclude: [
    "**/*.gen.ts",
    "**/worker-configuration.d.ts",
    "**/*.{test,property.test,stories}.{ts,tsx}",
    "test/**",
    "e2e/**",
    "**/*.config.ts",
  ],
};
