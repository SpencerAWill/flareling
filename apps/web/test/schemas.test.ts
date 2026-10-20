import { describe, expect, it } from "vitest";
import {
  inviteSchema,
  newWorkspaceSchema,
  signInSchema,
} from "#/lib/schemas.ts";

// The forms and the server functions validate with these same schemas, so
// what passes here is what both accept.

const messages = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) =>
  result.success ? [] : (result.error?.issues.map((i) => i.message) ?? []);

describe("signInSchema", () => {
  it("accepts an address, trimmed", () => {
    expect(signInSchema.parse({ email: "  ada@example.com " })).toEqual({
      email: "ada@example.com",
    });
  });

  it("says what's wrong with an empty or malformed address", () => {
    expect(messages(signInSchema.safeParse({ email: "" }))).toEqual([
      "Enter an email address.",
    ]);
    expect(messages(signInSchema.safeParse({ email: "ada@" }))).toEqual([
      "Enter a valid email address.",
    ]);
  });
});

describe("newWorkspaceSchema", () => {
  it("wants a name, of at most 60 characters", () => {
    expect(newWorkspaceSchema.parse({ name: " Acme " })).toEqual({
      name: "Acme",
    });
    expect(messages(newWorkspaceSchema.safeParse({ name: "   " }))).toEqual([
      "Give the workspace a name.",
    ]);
    expect(
      messages(newWorkspaceSchema.safeParse({ name: "x".repeat(61) })),
    ).toEqual(["Keep the name to 60 characters."]);
  });
});

describe("inviteSchema", () => {
  it("takes an address and a role that can be invited", () => {
    expect(
      inviteSchema.parse({ email: "b@example.com", role: "admin" }),
    ).toEqual({ email: "b@example.com", role: "admin" });
    // Ownership is granted to members, never by invite.
    expect(
      inviteSchema.safeParse({ email: "b@example.com", role: "owner" }).success,
    ).toBe(false);
  });
});
