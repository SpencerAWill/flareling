/**
 * The AuthContext libs/auth needs, built from this request: Start's cookie
 * helpers, the Worker's bindings and the validated env. One per request, so
 * libs/auth's per-request principal memo works.
 */

import { env } from "cloudflare:workers";
import type { AuthContext } from "@flareling/auth";
import { createEmailSender } from "@flareling/email";
import {
  deleteCookie,
  getCookie,
  getRequest,
  setCookie,
} from "@tanstack/react-start/server";
import { getEnv } from "#/env.ts";

const contexts = new WeakMap<Request, AuthContext>();

export function authContext(): AuthContext {
  const request = getRequest();
  const existing = contexts.get(request);
  if (existing) return existing;

  const vars = getEnv();
  const ctx: AuthContext = {
    config: {
      appBaseUrl: vars.APP_BASE_URL,
      appName: vars.APP_NAME,
      rpId: vars.WEBAUTHN_RP_ID,
      rateLimitBypass: vars.E2E_BYPASS_RATE_LIMIT === "1",
      ...(vars.TURNSTILE_SECRET_KEY
        ? { turnstileSecret: vars.TURNSTILE_SECRET_KEY }
        : {}),
    },
    cookies: {
      get: (name) => getCookie(name),
      set: (name, value, options) => setCookie(name, value, options),
      delete: (name, options) => deleteCookie(name, options),
    },
    // Set by Cloudflare's edge; can't be spoofed the way X-Forwarded-For can.
    clientIp: request.headers.get("cf-connecting-ip"),
    email: createEmailSender({
      from: vars.EMAIL_FROM,
      ...(vars.EMAIL_FROM_NAME ? { fromName: vars.EMAIL_FROM_NAME } : {}),
      ...(vars.MAILPIT_URL ? { mailpitUrl: vars.MAILPIT_URL } : {}),
    }),
    rateLimiter: env.AUTH_RATE_LIMITER,
  };
  contexts.set(request, ctx);
  return ctx;
}
