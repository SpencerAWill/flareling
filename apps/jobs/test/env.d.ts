import type { D1Migration } from "@cloudflare/vitest-plugin";

// Bindings only the test runtime provides (vitest.config.ts).
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
