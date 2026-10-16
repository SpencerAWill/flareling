import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  hasAnyPermission,
  hasPermission,
  type Principal,
  requireAnyPermission,
  requirePermission,
  requirePrincipal,
  UnauthorizedError,
} from "./index.ts";

const member: Principal = {
  userId: "u1",
  primaryEmail: "m@example.com",
  emails: ["m@example.com"],
  roles: ["member"],
  permissions: ["reports:view"],
  isSystemAdmin: false,
};
const admin: Principal = {
  ...member,
  roles: ["system_admin"],
  permissions: [],
  isSystemAdmin: true,
};

describe("permission checks", () => {
  it("grants what a principal's roles hold, and nothing else", () => {
    expect(hasPermission(member, "reports:view")).toBe(true);
    expect(hasPermission(member, "roles:manage")).toBe(false);
  });

  it("gives a system admin every permission, even one never granted", () => {
    expect(hasPermission(admin, "anything:at_all")).toBe(true);
  });

  it("grants nothing to an anonymous request", () => {
    expect(hasPermission(null, "reports:view")).toBe(false);
    expect(hasAnyPermission(null, ["reports:view"])).toBe(false);
  });

  it("accepts any of several permissions", () => {
    expect(hasAnyPermission(member, ["reports:edit", "reports:view"])).toBe(
      true,
    );
    expect(hasAnyPermission(member, [])).toBe(false);
  });
});

describe("requirements", () => {
  it("throws UnauthorizedError with no principal", () => {
    expect(() => requirePrincipal(null)).toThrow(UnauthorizedError);
    expect(() => requirePermission(null, "x:y")).toThrow(UnauthorizedError);
  });

  it("throws ForbiddenError naming the missing permission", () => {
    expect(() => requirePermission(member, "roles:manage")).toThrow(
      expect.objectContaining({
        name: "ForbiddenError",
        permission: "roles:manage",
      }),
    );
    expect(() => requireAnyPermission(member, ["a:b", "c:d"])).toThrow(
      ForbiddenError,
    );
  });

  it("returns the principal when satisfied", () => {
    expect(requirePermission(member, "reports:view")).toBe(member);
    expect(requireAnyPermission(admin, ["x:y"])).toBe(admin);
  });
});
