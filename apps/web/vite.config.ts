import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Published to the host by .devcontainer/docker-compose.yml. Changing either
// number means changing it there too.
const DEV_PORT = 3000;
const PREVIEW_PORT = 4173;

export default defineConfig({
  // Order matters. `cloudflare()` comes before `tanstackStart()` so workerd
  // claims the SSR environment before Start configures it, and
  // `viteEnvironment.name: "ssr"` ties the two together. The effect is that
  // `pnpm dev` runs server code in workerd, the same runtime as production, so
  // a Node-only API fails locally instead of after deploy. The React plugin
  // must come after Start.
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // apps/jobs runs beside the app in `pnpm dev` and `vite preview`, so
      // messages the app queues (Stripe webhooks) are consumed locally too.
      // Each Worker still deploys on its own; this only shares a local
      // runtime (and its local D1 and queues) between them.
      auxiliaryWorkers: [{ configPath: "../jobs/wrangler.jsonc" }],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],

  server: {
    // 0.0.0.0, so the port published by the dev container reaches the server.
    // Vite's default 127.0.0.1 is the container's own loopback.
    host: true,
    port: DEV_PORT,
    // Fail loudly on a busy port. Vite would otherwise move to 3001, which is
    // apps/marketing's published port.
    strictPort: true,
  },

  preview: {
    host: true,
    port: PREVIEW_PORT,
    strictPort: true,
  },
});
