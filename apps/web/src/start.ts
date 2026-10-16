import { errorMessage, log, runWithLogContext } from "@flareling/log";
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { getEnv } from "#/env.ts";
import { withSecurityHeaders } from "#/server/security-headers.ts";

/**
 * Outermost: adds the security headers (src/server/security-headers.ts) to
 * every response, including the 403s and 500s produced further in. An error
 * that escapes the rest of the chain (a misconfigured env, say) is logged and
 * answered with a plain 500 that still carries the headers.
 */
const securityHeaders = createMiddleware().server(async ({ next }) => {
  try {
    const result = await next();
    return { ...result, response: withSecurityHeaders(result.response) };
  } catch (err) {
    log.error("request.failed", { error: errorMessage(err) });
    return withSecurityHeaders(
      new Response("Internal Server Error", { status: 500 }),
    );
  }
});

/**
 * Refuses cross-site calls to server functions (403). Start adds this itself
 * only when an app defines no request middleware; defining startInstance
 * replaces the default, so it has to be listed here. The default policy
 * accepts only `Sec-Fetch-Site: same-origin` (falling back to Origin, then
 * Referer), which also refuses sibling subdomains in a shared zone.
 */
const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

/**
 * Validates the env, so a missing or malformed variable fails the first
 * request loudly instead of whichever request first reads it, and puts the
 * request's Cloudflare Ray ID on every log line written while handling it.
 */
const requestContext = createMiddleware().server(({ next, request }) => {
  getEnv();
  return runWithLogContext(
    { rayId: request.headers.get("cf-ray") ?? null },
    () => next(),
  );
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders, csrf, requestContext],
}));
