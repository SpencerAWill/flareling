import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineEnv, EnvValidationError, logLevel, parseEnv } from "./index.ts";

const schema = {
  APP_BASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
  LOG_LEVEL: logLevel,
};

const valid = {
  APP_BASE_URL: "https://app.example.com",
  SESSION_SECRET: "a-session-secret-that-is-long-enough-xx",
};

describe("parseEnv", () => {
  it("returns typed values for a valid env", () => {
    const env = parseEnv(schema, { ...valid, LOG_LEVEL: "debug" });
    expect(env.APP_BASE_URL).toBe("https://app.example.com");
    expect(env.LOG_LEVEL).toBe("debug");
  });

  it("names every invalid variable", () => {
    expect(() => parseEnv(schema, { LOG_LEVEL: "verbose" })).toThrow(
      expect.objectContaining({
        name: "EnvValidationError",
        variables: ["APP_BASE_URL", "SESSION_SECRET", "LOG_LEVEL"],
      }),
    );
  });

  it("never puts a value in the error, since values are secrets", () => {
    const secret = "short-but-very-secret-value";
    let message = "";
    try {
      parseEnv(schema, { ...valid, SESSION_SECRET: secret });
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      message = (err as Error).message;
    }
    expect(message).toContain("SESSION_SECRET");
    expect(message).not.toContain(secret);
  });

  it("treats an empty string as unset, so an optional var's default applies", () => {
    const env = parseEnv(
      { MODE: z.enum(["a", "b"]).default("a") },
      { MODE: "" },
    );
    expect(env.MODE).toBe("a");
  });

  it("leaves the source object untouched", () => {
    // t3's emptyStringAsUndefined deletes keys from the object it is given;
    // handed the Worker's env binding, it would mutate it.
    const source = { ...valid, LOG_LEVEL: "", BINDING: { not: "a var" } };
    parseEnv(schema, source);
    expect(source).toEqual({
      ...valid,
      LOG_LEVEL: "",
      BINDING: { not: "a var" },
    });
  });

  it("ignores non-scalar values such as bindings", () => {
    expect(() =>
      parseEnv({ DB: z.string() }, { DB: { prepare: () => null } }),
    ).toThrow(expect.objectContaining({ variables: ["DB"] }));
  });
});

describe("defineEnv", () => {
  it("validates the Worker env on first use and caches the result", () => {
    // The test runtime binds no vars, so an all-optional schema parses.
    const getEnv = defineEnv({ LOG_LEVEL: logLevel });
    const first = getEnv();
    expect(first.LOG_LEVEL).toBeUndefined();
    expect(getEnv()).toBe(first);
  });

  it("throws on first use when a required var is missing", () => {
    const getEnv = defineEnv({ APP_BASE_URL: z.url() });
    expect(() => getEnv()).toThrow(EnvValidationError);
  });
});
