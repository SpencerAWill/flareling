/**
 * Mutation testing: Stryker changes the code in small ways (flips a
 * condition, drops a statement) and checks that some test fails for each
 * change. A surviving mutant is a behavior no test pins down. Run with
 * `pnpm test:mutation`, and weekly in quality.yml.
 *
 * A report, not a gate (`break: null`), like coverage. Adapted from
 * ucmc.spencerwill.com's setup, including its two settings that each cost a
 * failed run there (`plugins` and `vitest.related`, below).
 *
 * @type {import("@stryker-mutator/api/core").PartialStrykerOptions}
 */
export default {
  testRunner: "vitest",
  // Required: pnpm's strict node_modules hides plugins from Stryker's
  // auto-discovery, which fails with "no TestRunner plugins were loaded".
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: {
    configFile: "vitest.mutation.config.ts",
    // Required: `related` maps a mutated file back to its tests through
    // Vitest's module graph, which doesn't resolve workspace imports, so it
    // finds no tests and Stryker exits with "No tests were executed".
    related: false,
  },
  // Pure modules only; see vitest.mutation.config.ts for why. Adding a module
  // here means adding its tests there.
  mutate: [
    "libs/core/src/index.ts",
    "libs/log/src/redact.ts",
    "libs/ui/src/cn.ts",
  ],
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: ".stryker-tmp",
};
