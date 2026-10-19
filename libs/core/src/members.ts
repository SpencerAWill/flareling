/**
 * A workspace's members. Every function takes the principal and checks their
 * role itself (requireWorkspaceRole), so callers can't forget to.
 */
import { ForbiddenError, type Principal } from "@flareling/auth";
import { getDb, recordAudit, schema } from "@flareling/db";
import { and, asc, eq, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { requireWorkspaceRole, type WorkspaceRole } from "./workspaces.ts";

const { userEmails, workspaceInvites, workspaceMembers, workspaces } = schema;

export interface Member {
  readonly userId: string;
  /** Their primary address. Members see each other's. */
  readonly email: string;
  readonly role: WorkspaceRole;
  readonly joinedAt: Date;
}

/** The workspace's members, earliest to join first. Any member may list them. */
export async function listMembers(
  principal: Principal | null,
  workspaceId: string,
): Promise<Member[]> {
  await requireWorkspaceRole(principal, workspaceId, "member");
  return getDb()
    .select({
      userId: workspaceMembers.userId,
      email: userEmails.email,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(
      userEmails,
      and(
        eq(userEmails.userId, workspaceMembers.userId),
        eq(userEmails.isPrimary, true),
      ),
    )
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt), asc(userEmails.email));
}

/**
 * True unless this change would leave the workspace with no owner: the row
 * being changed isn't an owner, or another owner remains. Part of the
 * statement that writes, so two owners demoting each other at once can't
 * both succeed.
 */
function anotherOwnerRemains(workspaceId: string, userId: string): SQL {
  return or(
    ne(workspaceMembers.role, "owner"),
    sql`(SELECT count(*) FROM workspace_members
         WHERE workspace_id = ${workspaceId} AND role = 'owner'
           AND user_id != ${userId}) > 0`,
  ) as SQL;
}

async function isPersonal(workspaceId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ personalUserId: workspaces.personalUserId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return row?.personalUserId != null;
}

async function memberRole(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await getDb()
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    );
  return row?.role ?? null;
}

/**
 * Whether `actor` may change `target`'s membership (role or removal). Admins
 * manage admins and members; only owners touch owners or make new ones.
 */
function mayManage(
  actor: WorkspaceRole,
  target: WorkspaceRole,
  newRole?: WorkspaceRole,
): boolean {
  if (actor === "owner") return true;
  return actor === "admin" && target !== "owner" && newRole !== "owner";
}

export type MembershipResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "personal" | "not_member" | "last_owner" | "changed";
    };

/**
 * Why a guarded write changed nothing: the member is gone, their role
 * changed since it was read (someone else got there first), or they're the
 * last owner.
 */
async function whyUnchanged(
  workspaceId: string,
  userId: string,
  expected: WorkspaceRole,
): Promise<MembershipResult> {
  const role = await memberRole(workspaceId, userId);
  if (!role) return { ok: false, reason: "not_member" };
  return { ok: false, reason: role === expected ? "last_owner" : "changed" };
}

/**
 * Changes a member's role. Admins can move people between member and admin;
 * owners can also make or unmake owners, themselves included, as long as
 * one owner remains. Anything else is a ForbiddenError.
 */
export async function changeRole(
  principal: Principal | null,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<MembershipResult> {
  const { principal: actor, role: actorRole } = await requireWorkspaceRole(
    principal,
    workspaceId,
    "admin",
  );
  if (await isPersonal(workspaceId)) return { ok: false, reason: "personal" };
  const current = await memberRole(workspaceId, userId);
  if (!current) return { ok: false, reason: "not_member" };
  if (!mayManage(actorRole, current, role)) {
    throw new ForbiddenError("workspace:manage_member");
  }
  if (current === role) return { ok: true };

  const [updated] = await getDb()
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        // Unchanged since it was read, so the permission check still holds.
        eq(workspaceMembers.role, current),
        anotherOwnerRemains(workspaceId, userId),
      ),
    )
    .returning({ userId: workspaceMembers.userId });
  if (!updated) return whyUnchanged(workspaceId, userId, current);

  await recordAudit({
    action: "workspace.member_role_changed",
    actorId: actor.userId,
    targetType: "workspace",
    targetId: workspaceId,
    metadata: { userId, from: current, to: role },
  });
  return { ok: true };
}

/**
 * Removes someone else from the workspace. Admins can remove admins and
 * members; owners can remove anyone. To remove yourself, leave.
 */
export async function removeMember(
  principal: Principal | null,
  workspaceId: string,
  userId: string,
): Promise<MembershipResult> {
  const { principal: actor, role: actorRole } = await requireWorkspaceRole(
    principal,
    workspaceId,
    "admin",
  );
  if (userId === actor.userId) {
    throw new ForbiddenError("workspace:remove_self");
  }
  if (await isPersonal(workspaceId)) return { ok: false, reason: "personal" };
  const current = await memberRole(workspaceId, userId);
  if (!current) return { ok: false, reason: "not_member" };
  if (!mayManage(actorRole, current)) {
    throw new ForbiddenError("workspace:manage_member");
  }

  const [removed] = await getDb()
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, current),
        anotherOwnerRemains(workspaceId, userId),
      ),
    )
    .returning({ userId: workspaceMembers.userId });
  if (!removed) return whyUnchanged(workspaceId, userId, current);

  await recordAudit({
    action: "workspace.member_removed",
    actorId: actor.userId,
    targetType: "workspace",
    targetId: workspaceId,
    metadata: { userId, role: current },
  });
  return { ok: true };
}

/**
 * Leaves the workspace. The last owner can't: they hand ownership to
 * someone first. Nor can anyone leave their personal workspace.
 */
export async function leaveWorkspace(
  principal: Principal | null,
  workspaceId: string,
): Promise<MembershipResult> {
  const { principal: member, role } = await requireWorkspaceRole(
    principal,
    workspaceId,
    "member",
  );
  if (await isPersonal(workspaceId)) return { ok: false, reason: "personal" };

  const [left] = await getDb()
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, member.userId),
        anotherOwnerRemains(workspaceId, member.userId),
      ),
    )
    .returning({ userId: workspaceMembers.userId });
  if (!left) return whyUnchanged(workspaceId, member.userId, role);

  await recordAudit({
    action: "workspace.member_left",
    actorId: member.userId,
    targetType: "workspace",
    targetId: workspaceId,
    metadata: { role },
  });
  return { ok: true };
}

/**
 * Withdraws an open invite, so its link stops working and its seat is
 * free. Admins and owners may. False if it's not open in this workspace.
 */
export async function revokeInvite(
  principal: Principal | null,
  workspaceId: string,
  inviteId: string,
): Promise<boolean> {
  const { principal: actor } = await requireWorkspaceRole(
    principal,
    workspaceId,
    "admin",
  );
  const [revoked] = await getDb()
    .update(workspaceInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvites.id, inviteId),
        eq(workspaceInvites.workspaceId, workspaceId),
        isNull(workspaceInvites.acceptedAt),
        isNull(workspaceInvites.declinedAt),
        isNull(workspaceInvites.revokedAt),
      ),
    )
    .returning({ id: workspaceInvites.id });
  if (!revoked) return false;

  await recordAudit({
    action: "workspace.invite_revoked",
    actorId: actor.userId,
    targetType: "workspace",
    targetId: workspaceId,
    metadata: { inviteId },
  });
  return true;
}
