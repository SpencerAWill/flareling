import { describe, expect, it } from "vitest";
import { hashToken, randomToken } from "./tokens.ts";

describe("randomToken", () => {
  it("is 32 random bytes as unpadded base64url", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("doesn't repeat", () => {
    const tokens = new Set(Array.from({ length: 1000 }, randomToken));
    expect(tokens.size).toBe(1000);
  });
});

describe("hashToken", () => {
  it("is SHA-256 as base64url", async () => {
    // The standard SHA-256 test vector for "abc".
    expect(await hashToken("abc")).toBe(
      "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0",
    );
  });
});
