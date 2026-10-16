import type { Principal } from "@flareling/auth";
import { getDb, newId, schema } from "@flareling/db";
import { describe, expect, it } from "vitest";
import {
  ensurePersonalWorkspace,
  listWorkspaces,
  requireWorkspaceRole,
} from "./index.ts";

async function createUser(): Promise<Principal> {
  const userId = newId();
  await getDb().insert(schema.users).values({ id: userId });
  return {
    userId,
    primaryEmail: `${userId}@example.com`,
    emails: [],
    roles: [],
    permissions: [],
    isSystemAdmin: false,
  };
}

async function addMember(
  workspaceId: string,
  userId: string,
  role: "admin" | "member",
) {
  await getDb()
    .insert(schema.workspaceMembers)
    .values({ workspaceId, userId, role });
}

describe("personal workspaces", () => {
  it("creates one on first use, owned by the account, and reuses it after", async () => {
    const { userId } = await createUser();
    const first = await ensurePersonalWorkspace(userId);
    expect(await ensurePersonalWorkspace(userId)).toBe(first);
    expect(await listWorkspaces(userId)).toEqual([
      { id: first, name: "Personal", role: "owner", personal: true },
    ]);
  });

  it("creates exactly one when first requests race", async () => {
    const { userId } = await createUser();
    const ids = await Promise.all([
      ensurePersonalWorkspace(userId),
      ensurePersonalWorkspace(userId),
      ensurePersonalWorkspace(userId),
    ]);
    expect(new Set(ids).size).toBe(1);
    expect(await listWorkspaces(userId)).toHaveLength(1);
  });
});

describe("listWorkspaces", () => {
  it("lists the personal workspace first, then shared ones", async () => {
    const owner = await createUser();
    const member = await createUser();
    const shared = await ensurePersonalWorkspace(owner.userId);
    const own = await ensurePersonalWorkspace(member.userId);
    await addMember(shared, member.userId, "member");

    expect(await listWorkspaces(member.userId)).toEqual([
      { id: own, name: "Personal", role: "owner", personal: true },
      { id: shared, name: "Personal", role: "member", personal: false },
    ]);
  });
});

describe("requireWorkspaceRole", () => {
  it("allows a role at or above the minimum", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const workspaceId = await ensurePersonalWorkspace(owner.userId);
    await addMember(workspaceId, admin.userId, "admin");

    await expect(
      requireWorkspaceRole(owner, workspaceId, "admin"),
    ).resolves.toMatchObject({
      role: "owner",
    });
    await expect(
      requireWorkspaceRole(admin, workspaceId, "admin"),
    ).resolves.toMatchObject({
      role: "admin",
    });
  });

  it("refuses a lower role, and a non-member, the same way", async () => {
    const owner = await createUser();
    const member = await createUser();
    const outsider = await createUser();
    const workspaceId = await ensurePersonalWorkspace(owner.userId);
    await addMember(workspaceId, member.userId, "member");

    for (const who of [member, outsider]) {
      await expect(
        requireWorkspaceRole(who, workspaceId, "admin"),
      ).rejects.toMatchObject({
        name: "ForbiddenError",
      });
    }
  });

  it("gives a system admin no access to a workspace's data", async () => {
    const owner = await createUser();
    const staff = {
      ...(await createUser()),
      isSystemAdmin: true,
      roles: ["system_admin"],
    };
    const workspaceId = await ensurePersonalWorkspace(owner.userId);
    await expect(
      requireWorkspaceRole(staff, workspaceId, "member"),
    ).rejects.toMatchObject({
      name: "ForbiddenError",
    });
  });

  it("refuses an anonymous request", async () => {
    await expect(
      requireWorkspaceRole(null, "any", "member"),
    ).rejects.toMatchObject({
      name: "UnauthorizedError",
    });
  });
});
