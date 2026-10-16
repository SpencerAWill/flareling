import { defineConfig } from "vitest/config";

// The test project Stryker runs once per mutant (stryker.config.mjs). It runs
// in plain Node rather than workerd: the Workers pool boots a runtime for every
// test file, which is unaffordable hundreds of times over, and its
// compatibility with Stryker is unverified. So only pure modules, with no
// `cloudflare:*` imports anywhere below them, can be mutated. Keep `include`
// in step with `mutate` in stryker.config.mjs. Not part of `pnpm test`, which
// already runs these files in their packages' own projects.
export default defineConfig({
  test: {
    include: [
      "libs/core/src/index.test.ts",
      "libs/log/src/redact*.test.ts",
      "libs/ui/src/cn*.test.ts",
    ],
  },
});
