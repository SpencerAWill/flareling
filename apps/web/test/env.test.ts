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
});
