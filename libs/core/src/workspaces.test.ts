import type { Principal } from "@flareling/auth";
import { getDb, newId, schema } from "@flareling/db";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
  createWorkspace,
  ensurePersonalWorkspace,
  listWorkspaces,
  OWNED_WORKSPACE_LIMIT,
  requireWorkspaceRole,
  WORKSPACE_NAME_MAX,
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

  it("stamps a new personal workspace with the given time", async () => {
    const { userId } = await createUser();
    const at = Temporal.Instant.from("2026-01-02T03:04:05Z");
    const id = await ensurePersonalWorkspace(userId, at);
    const [row] = await getDb()
      .select({ createdAt: schema.workspaces.createdAt })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id));
    expect(row?.createdAt).toEqual(new Date(at.epochMilliseconds));
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

describe("createWorkspace", () => {
  it("creates a team workspace owned by its creator", async () => {
    const creator = await createUser();
    const result = await createWorkspace(creator, "  Acme \n Corp ");
    expect(result).toEqual({ ok: true, id: expect.any(String) });
    if (!result.ok) return;

    expect(await listWorkspaces(creator.userId)).toEqual([
      { id: result.id, name: "Acme Corp", role: "owner", personal: false },
    ]);
    const [audit] = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, result.id));
    expect(audit).toMatchObject({
      action: "workspace.created",
      actorId: creator.userId,
      metadataJson: JSON.stringify({ personal: false }),
    });
  });

  it("stamps the workspace and its owner with the given time", async () => {
    const creator = await createUser();
    const at = Temporal.Instant.from("2026-01-02T03:04:05Z");
    const result = await createWorkspace(creator, "Clocked", at);
    if (!result.ok) throw new Error("not created");

    const [workspace] = await getDb()
      .select({ createdAt: schema.workspaces.createdAt })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, result.id));
    const [owner] = await getDb()
      .select({ createdAt: schema.workspaceMembers.createdAt })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, result.id));
    expect(workspace?.createdAt).toEqual(new Date(at.epochMilliseconds));
    expect(owner?.createdAt).toEqual(new Date(at.epochMilliseconds));
  });

  it("drops bidi controls, which could make a name read backwards in an email", async () => {
    const creator = await createUser();
    const result = await createWorkspace(creator, "Acme\u202Emoc.live");
    if (!result.ok) throw new Error("not created");
    const [workspace] = await listWorkspaces(creator.userId);
    expect(workspace?.name).toBe("Acmemoc.live");
  });

  it.each([
    ["empty", ""],
    ["only whitespace and control characters", " \u0000\t "],
    ["only bidi controls", "\u202E\u2066"],
    ["too long", "x".repeat(WORKSPACE_NAME_MAX + 1)],
  ])("refuses a name that's %s", async (_, name) => {
    expect(await createWorkspace(await createUser(), name)).toEqual({
      ok: false,
      reason: "invalid_name",
    });
  });

  it("stops at the limit, counting only team workspaces the account owns", async () => {
    const creator = await createUser();
    const other = await createUser();
    await ensurePersonalWorkspace(creator.userId);
    // Admin of someone else's workspace: not owned, so not counted.
    const theirs = await createWorkspace(other, "Theirs");
    if (!theirs.ok) throw new Error("setup");
    await addMember(theirs.id, creator.userId, "admin");

    for (let i = 0; i < OWNED_WORKSPACE_LIMIT; i++) {
      expect(await createWorkspace(creator, `Team ${i}`)).toMatchObject({
        ok: true,
      });
    }
    expect(await createWorkspace(creator, "One too many")).toEqual({
      ok: false,
      reason: "limit_reached",
    });
    expect(await listWorkspaces(creator.userId)).toHaveLength(
      OWNED_WORKSPACE_LIMIT + 2,
    );
  });

  it("can't be raced past the limit", async () => {
    const creator = await createUser();
    for (let i = 0; i < OWNED_WORKSPACE_LIMIT - 1; i++) {
      await createWorkspace(creator, `Team ${i}`);
    }
    const results = await Promise.all(
      [1, 2, 3].map((i) => createWorkspace(creator, `Race ${i}`)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const owned = await listWorkspaces(creator.userId);
    expect(owned).toHaveLength(OWNED_WORKSPACE_LIMIT);
  });

  it("refuses an anonymous request", async () => {
    await expect(createWorkspace(null, "Acme")).rejects.toMatchObject({
      name: "UnauthorizedError",
    });
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
