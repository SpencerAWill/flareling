import { runWithLogContext } from "@flareling/log";
import { createMiddleware, createStart } from "@tanstack/react-start";
import { getEnv } from "#/env.ts";

/**
 * Runs around every request. It validates the env, so a missing or malformed
 * variable fails the first request loudly instead of whichever request first
 * reads it, and it puts the request's Cloudflare Ray ID on every log line
 * written while handling it.
 */
const requestContext = createMiddleware().server(({ next, request }) => {
  getEnv();
  return runWithLogContext(
    { rayId: request.headers.get("cf-ray") ?? null },
    () => next(),
  );
});

export const startInstance = createStart(() => ({
  requestMiddleware: [requestContext],
}));
