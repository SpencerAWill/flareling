import { runWithLogContext } from "@flareling/log";
import { createMiddleware, createStart } from "@tanstack/react-start";
import { getEnv } from "#/env.ts";
import { withSecurityHeaders } from "#/server/security-headers.ts";

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

/** Adds the security headers (src/server/security-headers.ts) to every response. */
const securityHeaders = createMiddleware().server(async ({ next }) => {
  const result = await next();
  withSecurityHeaders(result.response);
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders, requestContext],
}));
