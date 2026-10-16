/**
 * What libs/auth needs from the app, passed in rather than imported, so the
 * lib stays framework-free and testable: the app builds an AuthContext per
 * request (apps/web/src/server/auth), adapting its framework's cookies.
 */
import type { EmailSender } from "@flareling/email";
import { Temporal } from "temporal-polyfill";

export interface CookieOptions {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "lax" | "strict";
  readonly path: "/";
  /** Seconds. */
  readonly maxAge: number;
}

/** The request's cookies, read and written through the app's framework. */
export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, options: CookieOptions): void;
  delete(name: string, options: Pick<CookieOptions, "path" | "secure">): void;
}

export interface AuthConfig {
  /** The app's origin, e.g. `https://app.example.com`. Links, WebAuthn's
   *  expected origin, and whether cookies are Secure all come from it. */
  readonly appBaseUrl: string;
  /** The product name used in emails and the passkey prompt. */
  readonly appName: string;
  /** The hostname passkeys are bound to: the app's host or a parent of it. */
  readonly rpId: string;
  readonly sessionTtl?: Temporal.Duration;
  /** How long after the last extension a session is extended again. */
  readonly sessionRefreshAfter?: Temporal.Duration;
  readonly magicLinkTtl?: Temporal.Duration;
  readonly challengeTtl?: Temporal.Duration;
  /** Turnstile secret. When set, every magic-link request must carry a
   *  valid token; unset skips the check (local development). */
  readonly turnstileSecret?: string;
  /** Skip rate limits, for E2E suites. Ignored when the app is on https. */
  readonly rateLimitBypass?: boolean;
  /** Minimum response time for a magic-link request, plus random jitter, so
   *  timing doesn't reveal whether an address has an account. Tests set 0. */
  readonly magicLinkResponsePadding?: {
    readonly minMs: number;
    readonly jitterMs: number;
  };
}

/** Cloudflare's Rate Limiting binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AuthContext {
  readonly config: AuthConfig;
  readonly cookies: CookieJar;
  /** CF-Connecting-IP, or null (local development). */
  readonly clientIp: string | null;
  readonly email: EmailSender;
  readonly rateLimiter?: RateLimiter;
  /** The clock, injectable for tests. */
  readonly now?: () => Temporal.Instant;
}

export const DEFAULTS = {
  sessionTtl: Temporal.Duration.from({ hours: 24 * 30 }),
  sessionRefreshAfter: Temporal.Duration.from({ hours: 1 }),
  magicLinkTtl: Temporal.Duration.from({ minutes: 15 }),
  challengeTtl: Temporal.Duration.from({ minutes: 5 }),
} as const;

export function nowOf(ctx: AuthContext): Temporal.Instant {
  return ctx.now?.() ?? Temporal.Now.instant();
}

/** Whether cookies are Secure and `__Host-` prefixed (only over https). */
export function isSecure(config: AuthConfig): boolean {
  return config.appBaseUrl.startsWith("https://");
}

/**
 * A cookie name, `__Host-` prefixed over https. The prefix makes the browser
 * insist on Secure, Path=/ and no Domain, so no subdomain can set or shadow
 * it. Browsers reject Secure cookies over plain http, hence no prefix there.
 */
export function cookieName(config: AuthConfig, base: string): string {
  return isSecure(config) ? `__Host-${base}` : base;
}
