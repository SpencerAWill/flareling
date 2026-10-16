import { createFileRoute } from "@tanstack/react-router";

/** Stripe's webhook endpoint. See src/server/billing/webhook.server.ts. */
export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleStripeWebhook } = await import(
          "#/server/billing/webhook.server.ts"
        );
        return handleStripeWebhook(request);
      },
    },
  },
});
