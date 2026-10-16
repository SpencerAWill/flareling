import type { EmailSender } from "@flareling/email";
import { Temporal } from "temporal-polyfill";
import type {
  AuthConfig,
  AuthContext,
  CookieJar,
  CookieOptions,
} from "../src/context.ts";

/** A cookie jar over a Map, recording what was set, for asserting on. */
export class TestCookieJar implements CookieJar {
  readonly values = new Map<string, string>();
  readonly lastSet = new Map<string, CookieOptions>();
  readonly deleted: string[] = [];

  get(name: string) {
    return this.values.get(name);
  }
  set(name: string, value: string, options: CookieOptions) {
    this.values.set(name, value);
    this.lastSet.set(name, options);
  }
  delete(name: string) {
    this.values.delete(name);
    this.deleted.push(name);
  }
}

export interface TestContext extends AuthContext {
  readonly cookies: TestCookieJar;
  readonly sent: Parameters<EmailSender["send"]>[0][];
  /** Moves the test clock forward. */
  advance(duration: Temporal.DurationLike): void;
}

/**
 * A fresh request context: a new cookie jar (pass `cookies` to keep one
 * browser across requests), a controllable clock, and an email sender that
 * records instead of sending.
 */
export function testContext(
  overrides: {
    config?: Partial<AuthConfig>;
    cookies?: TestCookieJar;
    clientIp?: string | null;
    start?: Temporal.Instant;
  } = {},
): TestContext {
  let now = overrides.start ?? Temporal.Instant.from("2026-10-16T12:00:00Z");
  const sent: TestContext["sent"] = [];
  return {
    config: {
      appBaseUrl: "http://localhost:3000",
      appName: "Flareling",
      rpId: "localhost",
      ...overrides.config,
    },
    cookies: overrides.cookies ?? new TestCookieJar(),
    clientIp: overrides.clientIp ?? "203.0.113.7",
    email: {
      send: async (message) => {
        sent.push(message);
      },
    },
    sent,
    now: () => now,
    advance(duration) {
      now = now.add(duration);
    },
  };
}

/** A context for another request from the same browser (same cookies, clock). */
export function nextRequest(previous: TestContext): TestContext {
  return testContext({
    config: previous.config,
    cookies: previous.cookies,
    clientIp: previous.clientIp,
    ...(previous.now ? { start: previous.now() } : {}),
  });
}
