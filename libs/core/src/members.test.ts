import { getDb, schema } from "@flareling/db";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { addMember, createUser, T0 } from "../test/users.ts";
import {
  changeRole,
  createWorkspace,
  ensurePersonalWorkspace,
  inviteMember,
  leaveWorkspace,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
} from "./index.ts";

async function teamOwnedBy(name = "Acme") {
  const owner = await createUser();
  const result = await createWorkspace(owner, name, T0);
  if (!result.ok) throw new Error("setup: workspace not created");
  return { owner, workspaceId: result.id };
}

describe("listMembers", () => {
  it("lists every member with their primary address and role, earliest first", async () => {
    const { owner, workspaceId } = await teamOwnedBy();
    const member = await createUser();
    // A minute after the owner, so "earliest first" has an answer.
    await addMember(
      workspaceId,
      member.userId,
      "member",
      new Date(T0.add({ minutes: 1 }).epochMilliseconds),
    );

    expect(await listMembers(member, workspaceId)).toEqual([
      {
        userId: owner.userId,
        email: owner.primaryEmail,
        role: "owner",
        joinedAt: expect.any(Date),
      },
      {
        userId: member.userId,
        email: member.primaryEmail,
        role: "member",
        joinedAt: expect.any(Date),
      },
    ]);
  });

  it("refuses a non-member, as if the workspace didn't exist", async () => {
    const { workspaceId } = await teamOwnedBy();
    await expect(
      listMembers(await createUser(), workspaceId),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

async function roles(workspaceId: string) {
  const rows = await getDb()
    .select({
      userId: schema.workspaceMembers.userId,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]));
}

/** A team with an owner, an admin and a member. */
async function staffedTeam() {
  const { owner, workspaceId } = await teamOwnedBy();
  const admin = await createUser();
  const member = await createUser();
  await addMember(workspaceId, admin.userId, "admin");
  await addMember(workspaceId, member.userId, "member");
  return { owner, admin, member, workspaceId };
}

describe("changeRole", () => {
  it("lets an admin move people between member and admin", async () => {
    const { admin, member, workspaceId } = await staffedTeam();
    expect(
      await changeRole(admin, workspaceId, member.userId, "admin"),
    ).toEqual({ ok: true });
    expect(
      await changeRole(admin, workspaceId, member.userId, "member"),
    ).toEqual({ ok: true });
    // Including themselves.
    expect(
      await changeRole(admin, workspaceId, admin.userId, "member"),
    ).toEqual({ ok: true });
    expect((await roles(workspaceId))[admin.userId]).toBe("member");

    const [audit] = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "workspace.member_role_changed"));
    expect(audit).toMatchObject({
      actorId: admin.userId,
      targetId: workspaceId,
    });
  });

  it("keeps owners' business to owners", async () => {
    const { owner, admin, member, workspaceId } = await staffedTeam();
    await expect(
      changeRole(admin, workspaceId, member.userId, "owner"),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(
      changeRole(admin, workspaceId, owner.userId, "member"),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(
      changeRole(member, workspaceId, member.userId, "admin"),
    ).rejects.toMatchObject({ name: "ForbiddenError" });

    expect(await changeRole(owner, workspaceId, admin.userId, "owner")).toEqual(
      { ok: true },
    );
    // Two owners now, so either can step down.
    expect(await changeRole(owner, workspaceId, owner.userId, "admin")).toEqual(
      { ok: true },
    );
    expect(await roles(workspaceId)).toEqual({
      [owner.userId]: "admin",
      [admin.userId]: "owner",
      [member.userId]: "member",
    });
  });

  it("never leaves a workspace without an owner", async () => {
    const { owner, workspaceId } = await staffedTeam();
    expect(await changeRole(owner, workspaceId, owner.userId, "admin")).toEqual(
      { ok: false, reason: "last_owner" },
    );
    expect((await roles(workspaceId))[owner.userId]).toBe("owner");
  });

  it("lets only one of two owners demote the other when they race", async () => {
    const { owner, admin, workspaceId } = await staffedTeam();
    await changeRole(owner, workspaceId, admin.userId, "owner");
    const second = { ...admin };

    const results = await Promise.all([
      changeRole(owner, workspaceId, second.userId, "member"),
      changeRole(second, workspaceId, owner.userId, "member"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const owners = Object.values(await roles(workspaceId)).filter(
      (r) => r === "owner",
    );
    expect(owners).toHaveLength(1);
  });

  it("refuses personal workspaces and non-members", async () => {
    const { owner, workspaceId } = await staffedTeam();
    expect(
      await changeRole(
        owner,
        workspaceId,
        (await createUser()).userId,
        "admin",
      ),
    ).toEqual({ ok: false, reason: "not_member" });

    const solo = await createUser();
    const personal = await ensurePersonalWorkspace(solo.userId, T0);
    expect(await changeRole(solo, personal, solo.userId, "admin")).toEqual({
      ok: false,
      reason: "personal",
    });
  });
});

describe("removeMember", () => {
  it("lets an admin remove admins and members, but not owners", async () => {
    const { owner, admin, member, workspaceId } = await staffedTeam();
    await expect(
      removeMember(admin, workspaceId, owner.userId),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(await removeMember(admin, workspaceId, member.userId)).toEqual({
      ok: true,
    });
    expect(await roles(workspaceId)).toEqual({
      [owner.userId]: "owner",
      [admin.userId]: "admin",
    });
    // Removed means removed: no more access.
    await expect(listMembers(member, workspaceId)).rejects.toMatchObject({
      name: "ForbiddenError",
    });
  });

  it("lets an owner remove another owner", async () => {
    const { owner, admin, workspaceId } = await staffedTeam();
    await changeRole(owner, workspaceId, admin.userId, "owner");
    expect(await removeMember(owner, workspaceId, admin.userId)).toEqual({
      ok: true,
    });
  });

  it("doesn't remove yourself (that's leaving) and refuses members", async () => {
    const { owner, admin, member, workspaceId } = await staffedTeam();
    await expect(
      removeMember(owner, workspaceId, owner.userId),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(
      removeMember(member, workspaceId, admin.userId),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(
      await removeMember(owner, workspaceId, (await createUser()).userId),
    ).toEqual({ ok: false, reason: "not_member" });
  });
});

describe("leaveWorkspace", () => {
  it("lets anyone but the last owner leave", async () => {
    const { owner, admin, member, workspaceId } = await staffedTeam();
    expect(await leaveWorkspace(member, workspaceId)).toEqual({ ok: true });
    expect(await leaveWorkspace(admin, workspaceId)).toEqual({ ok: true });
    expect(await leaveWorkspace(owner, workspaceId)).toEqual({
      ok: false,
      reason: "last_owner",
    });
    expect(await roles(workspaceId)).toEqual({ [owner.userId]: "owner" });
  });

  it("lets an owner leave once someone else owns it", async () => {
    const { owner, admin, workspaceId } = await staffedTeam();
    await changeRole(owner, workspaceId, admin.userId, "owner");
    expect(await leaveWorkspace(owner, workspaceId)).toEqual({ ok: true });
  });

  it("doesn't leave a personal workspace", async () => {
    const solo = await createUser();
    const personal = await ensurePersonalWorkspace(solo.userId, T0);
    expect(await leaveWorkspace(solo, personal)).toEqual({
      ok: false,
      reason: "personal",
    });
  });
});

describe("revokeInvite", () => {
  it("withdraws an open invite for admins, and only in its own workspace", async () => {
    const { owner, member, workspaceId } = await staffedTeam();
    const { owner: otherOwner, workspaceId: other } = await teamOwnedBy();
    const ctx = {
      appBaseUrl: "http://localhost:3000",
      appName: "Flareling",
      email: { send: async () => {} },
      seats: async () => 25,
    };
    const sent = await inviteMember(ctx, owner, {
      workspaceId,
      email: "withdrawn@example.com",
      role: "member",
    });
    if (!sent.ok) throw new Error("setup: invite not sent");

    await expect(
      revokeInvite(member, workspaceId, sent.inviteId, T0),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    // Another workspace's admin can't reach it through their own workspace.
    expect(await revokeInvite(otherOwner, other, sent.inviteId, T0)).toBe(
      false,
    );

    const at = Temporal.Instant.from("2026-01-02T03:04:05Z");
    expect(await revokeInvite(owner, workspaceId, sent.inviteId, at)).toBe(
      true,
    );
    const [row] = await getDb()
      .select({ revokedAt: schema.workspaceInvites.revokedAt })
      .from(schema.workspaceInvites)
      .where(eq(schema.workspaceInvites.id, sent.inviteId));
    expect(row?.revokedAt).toEqual(new Date(at.epochMilliseconds));
    // The audit row agrees with the change it records.
    const [audit] = await getDb()
      .select({ createdAt: schema.auditLog.createdAt })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "workspace.invite_revoked"));
    expect(audit?.createdAt).toEqual(new Date(at.epochMilliseconds));
    expect(await listInvites(owner, workspaceId)).toEqual([]);
    expect(await revokeInvite(owner, workspaceId, sent.inviteId, T0)).toBe(
      false,
    );
  });
});
