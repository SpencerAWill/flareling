import { createFileRoute } from "@tanstack/react-router";

/**
 * Liveness check for the post-deploy smoke test. Deliberately does no I/O, so
 * it answers "is this Worker version serving requests" and nothing more. A
 * dependency check (D1, KV) belongs on a separate route when one is needed.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { status: "ok" },
          { headers: { "Cache-Control": "no-store" } },
        ),
    },
  },
});
