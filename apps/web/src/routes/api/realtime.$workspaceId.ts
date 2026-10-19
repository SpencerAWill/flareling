import { createFileRoute } from "@tanstack/react-router";

/** A workspace's realtime socket. See src/server/realtime/connect.server.ts. */
export const Route = createFileRoute("/api/realtime/$workspaceId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { connectRealtime } = await import(
          "#/server/realtime/connect.server.ts"
        );
        return connectRealtime(request, params.workspaceId);
      },
    },
  },
});
