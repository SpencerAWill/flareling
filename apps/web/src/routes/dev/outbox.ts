import { createFileRoute } from "@tanstack/react-router";

/** The dev email outbox. See src/server/outbox/outbox.server.ts. */
export const Route = createFileRoute("/dev/outbox")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getEnv } = await import("#/env.ts");
        const { handleOutbox } = await import(
          "#/server/outbox/outbox.server.ts"
        );
        const vars = getEnv();
        return handleOutbox(request, {
          enabled: vars.EMAIL_OUTBOX === "1",
          teamDomain: vars.ACCESS_TEAM_DOMAIN,
          aud: vars.ACCESS_OUTBOX_AUD,
          appBaseUrl: vars.APP_BASE_URL,
        });
      },
    },
  },
});
