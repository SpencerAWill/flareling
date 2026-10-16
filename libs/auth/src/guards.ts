/**
 * Abuse controls for public auth endpoints: Cloudflare's Rate Limiting binding
 * and Turnstile. Run them before any database work, so a flood can't turn
 * into storage calls.
 */
import { errorMessage, log } from "@flareling/log";
import { type AuthContext, isSecure } from "./context.ts";

/**
 * Whether a request under `key` is within its limit. Keys are namespaced
 * (`ip:203.0.113.7`, `email:alice@example.com`) so each gets its own budget:
 * even with endless IPs, the per-email limit holds.
 *
 * Fails open: a missing binding (local development) or a binding error allows
 * the request. Rate limiting is one layer, and failing closed would let an
 * outage of it lock everyone out.
 */
export async function withinRateLimit(
  ctx: AuthContext,
  key: string,
): Promise<boolean> {
  // The E2E bypass never applies on https, so a misconfigured deploy can't
  // switch rate limiting off.
  if (ctx.config.rateLimitBypass && !isSecure(ctx.config)) return true;
  if (!ctx.rateLimiter) return true;
  try {
    return (await ctx.rateLimiter.limit({ key })).success;
  } catch (err) {
    log.warn("auth.rate_limit_unavailable", { error: errorMessage(err) });
    return true;
  }
}

/** The IP-scoped rate-limit key for this request. */
export function ipKey(ctx: AuthContext): string {
  return `ip:${ctx.clientIp ?? "local"}`;
}

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Whether `token` passes Turnstile. With no secret configured, every request
 * passes (local development). With one configured, a missing or empty token
 * fails. ucmc only verified when a token was present, so a bot that sent none
 * skipped the check.
 *
 * A network failure reaching Cloudflare passes (rate limiting is the next
 * layer); an error response fails.
 */
export async function passesTurnstile(
  ctx: AuthContext,
  token: string | undefined,
): Promise<boolean> {
  const secret = ctx.config.turnstileSecret;
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ctx.clientIp) body.set("remoteip", ctx.clientIp);
  let response: Response;
  try {
    response = await fetch(SITEVERIFY, { method: "POST", body });
  } catch (err) {
    log.warn("auth.turnstile_unreachable", { error: errorMessage(err) });
    return true;
  }
  if (!response.ok) {
    await response.text();
    log.warn("auth.turnstile_error", { status: response.status });
    return false;
  }
  const result = (await response.json()) as { success?: unknown };
  return result.success === true;
}
