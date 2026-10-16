import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isSafeRedirect, normalizeEmail } from "./index.ts";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });
});

describe("isSafeRedirect", () => {
  it.each(["/", "/account", "/search?q=//not-a-host", "/a/b#c"])(
    "accepts %s",
    (path) => {
      expect(isSafeRedirect(path)).toBe(true);
    },
  );

  it.each([
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "evil.com",
    "",
    "/\tevil",
    "/\n/evil.com",
    `/${"a".repeat(2048)}`,
  ])("refuses %j", (path) => {
    expect(isSafeRedirect(path)).toBe(false);
  });

  it("only ever accepts paths the browser resolves to this origin", () => {
    // The claim is about where the browser goes, so test that directly: for
    // any string, if it's accepted, URL resolution keeps the origin.
    const base = "https://app.example.com/sign-in";
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.string().map((s) => `/${s}`),
          fc.string().map((s) => `//${s}`),
          fc.string().map((s) => `/\\${s}`),
        ),
        (path) => {
          if (isSafeRedirect(path)) {
            expect(new URL(path, base).origin).toBe("https://app.example.com");
          }
        },
      ),
    );
  });
});
