import { getDb, schema } from "@flareling/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nextRequest, testContext } from "../test/context.ts";
import { createUser } from "../test/users.ts";
import {
  currentSessionId,
  getPrincipal,
  loadPrincipal,
  signIn,
  signOut,
} from "./index.ts";

const { permissions, rolePermissions, roles } = schema;

async function grant(roleName: string, permissionName: string) {
  const db = getDb();
  const [permission] = await db
    .insert(permissions)
    .values({ name: permissionName })
    .onConflictDoNothing()
    .returning({ id: permissions.id });
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, roleName));
  await db
    .insert(rolePermissions)
    .values({ roleId: role?.id ?? "", permissionId: permission?.id ?? "" });
}

describe("loadPrincipal", () => {
  it("collects the account's emails, roles and the permissions they grant", async () => {
    await grant("member", "reports:view");
    const userId = await createUser("member@example.com", ["member"]);

    expect(await loadPrincipal(userId)).toEqual({
      userId,
      primaryEmail: "member@example.com",
      emails: ["member@example.com"],
      roles: ["member"],
      permissions: ["reports:view"],
      isSystemAdmin: false,
    });
  });

  it("gives a system admin every permission, granted or not", async () => {
    await getDb().insert(permissions).values({ name: "billing:refund" });
    const userId = await createUser("admin@example.com", ["system_admin"]);

    const principal = await loadPrincipal(userId);
    expect(principal?.isSystemAdmin).toBe(true);
    expect(principal?.permissions).toEqual(
      expect.arrayContaining([
        "billing:refund",
        "roles:assign",
        "roles:manage",
      ]),
    );
  });

  it("has no permissions without roles", async () => {
    const userId = await createUser("norole@example.com");
    expect(await loadPrincipal(userId)).toMatchObject({
      roles: [],
      permissions: [],
    });
  });

  it("is null for an account that doesn't exist", async () => {
    expect(await loadPrincipal("no-such-user")).toBeNull();
  });
});

describe("getPrincipal", () => {
  it("resolves the signed-in principal once per request", async () => {
    const userId = await createUser("memo@example.com", ["member"]);
    const ctx = testContext();
    await signIn(ctx, userId);

    const request = nextRequest(ctx);
    const first = getPrincipal(request);
    expect(getPrincipal(request)).toBe(first);
    expect((await first)?.userId).toBe(userId);
  });

  it("is null when no one is signed in", async () => {
    expect(await getPrincipal(testContext())).toBeNull();
  });
});

describe("currentSessionId", () => {
  it("names this browser's session, and is null once it signs out", async () => {
    const userId = await createUser("session-id@example.com");
    const phone = testContext();
    const laptop = testContext();
    await signIn(phone, userId);
    await signIn(laptop, userId);

    const phoneId = await currentSessionId(nextRequest(phone));
    const laptopId = await currentSessionId(nextRequest(laptop));
    expect(phoneId).toEqual(expect.any(String));
    expect(laptopId).toEqual(expect.any(String));
    expect(phoneId).not.toBe(laptopId);

    const request = nextRequest(phone);
    expect(await currentSessionId(request)).toBe(phoneId);
    await signOut(request);
    expect(await currentSessionId(request)).toBeNull();
    expect(await currentSessionId(nextRequest(phone))).toBeNull();
  });

  it("is null when no one is signed in", async () => {
    expect(await currentSessionId(testContext())).toBeNull();
  });
});
