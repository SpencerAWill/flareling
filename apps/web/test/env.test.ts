import { describe, expect, it } from "vitest";
import { configurationProblems } from "#/env.ts";

const local = {
  APP_BASE_URL: "http://localhost:3000",
  APP_NAME: "Flareling",
  WEBAUTHN_RP_ID: "localhost",
  EMAIL_FROM: "noreply@example.com",
  MAILPIT_URL: "http://mailpit:8025",
} as const;

describe("configurationProblems", () => {
  it("accepts local development with Mailpit", () => {
    expect(configurationProblems(local)).toEqual([]);
  });

  it("refuses a deployed environment with no email transport", () => {
    const { MAILPIT_URL: _, ...deployed } = local;
    expect(
      configurationProblems({
        ...deployed,
        APP_BASE_URL: "https://app.example.com",
      }),
    ).toEqual([expect.stringContaining("No email transport")]);
  });

  it("refuses Mailpit in a deployed environment", () => {
    expect(
      configurationProblems({
        ...local,
        APP_BASE_URL: "https://app.example.com",
      }),
    ).toEqual([expect.stringContaining("local development only")]);
  });

  it("refuses one Turnstile key without the other", () => {
    expect(
      configurationProblems({ ...local, TURNSTILE_SECRET_KEY: "s" }),
    ).toEqual([
      expect.stringContaining("TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY"),
    ]);
    expect(
      configurationProblems({
        ...local,
        TURNSTILE_SITE_KEY: "k",
        TURNSTILE_SECRET_KEY: "s",
      }),
    ).toEqual([]);
  });

  it("refuses one Stripe secret without the other", () => {
    expect(
      configurationProblems({ ...local, STRIPE_SECRET_KEY: "sk_test_1" }),
    ).toEqual([
      expect.stringContaining("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET"),
    ]);
    expect(
      configurationProblems({
        ...local,
        STRIPE_SECRET_KEY: "sk_test_1",
        STRIPE_WEBHOOK_SECRET: "whsec_1",
      }),
    ).toEqual([]);
  });

  it("refuses stripe-mock in a deployed environment", () => {
    const { MAILPIT_URL: _, ...rest } = local;
    expect(
      configurationProblems({
        ...rest,
        APP_BASE_URL: "https://app.example.com",
        STRIPE_API_BASE: "http://stripe-mock:12111",
      }),
    ).toEqual([
      expect.stringContaining("No email transport"),
      expect.stringContaining("STRIPE_API_BASE is for local development only"),
    ]);
  });

  describe("the dev outbox", () => {
    const { MAILPIT_URL: _, ...rest } = local;
    const deployed = { ...rest, APP_BASE_URL: "https://dev.example.com" };

    it("counts as an email transport for a deployed environment", () => {
      expect(
        configurationProblems({
          ...deployed,
          EMAIL_OUTBOX: "1",
          ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
          ACCESS_OUTBOX_AUD: "aud",
        }),
      ).toEqual([]);
    });

    it("needs both Access settings", () => {
      expect(
        configurationProblems({
          ...deployed,
          EMAIL_OUTBOX: "1",
          ACCESS_OUTBOX_AUD: "aud",
        }),
      ).toEqual([
        expect.stringContaining("ACCESS_TEAM_DOMAIN and ACCESS_OUTBOX_AUD"),
      ]);
    });
  });
});
