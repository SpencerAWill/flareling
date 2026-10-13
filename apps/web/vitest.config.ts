import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// Kept apart from vite.config.ts: `cloudflareTest()` takes the place of
// `cloudflare()` from @cloudflare/vite-plugin, and the two do not share a
// config. Tests run inside workerd with the bindings and compatibility settings
// from wrangler.jsonc.
export default defineConfig({
  plugins: [
    cloudflareTest({
      // wrangler.jsonc's `main` is a package specifier, which the test pool
      // would resolve as a path relative to this directory. This local module
      // re-exports the same entry.
      main: "./test/worker.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
    // Provides the virtual modules (the route tree, the router entry) that
    // Start's server entry imports. Without it the Worker fails at load.
    tanstackStart(),
    // Not strictly required for SSR tests, but keeps the JSX transform the
    // same as the production build.
    viteReact(),
  ],
  test: {
    // e2e/ is Playwright's (playwright.config.ts), run by `test:e2e`.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
