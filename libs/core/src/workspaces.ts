/**
 * Workspaces: the tenant. Every account belongs to at least one (its personal
 * workspace, created on first use), and product data and billing belong to a
 * workspace, not to a person. See docs/adr/0017-workspaces-as-tenants.md.
 */
import {
  ForbiddenError,
  type Principal,
  requirePrincipal,
} from "@flareling/auth";
import {
  getDb,
  isUniqueViolation,
  newId,
  recordAudit,
  schema,
} from "@flareling/db";
import { and, asc, eq } from "drizzle-orm";

const { workspaces, workspaceMembers } = schema;

export type WorkspaceRole = "owner" | "admin" | "member";

/** Higher ranks can do everything lower ones can. */
const RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 };

export interface WorkspaceMembership {
  readonly id: string;
  readonly name: string;
  readonly role: WorkspaceRole;
  readonly personal: boolean;
}

/** The workspaces `userId` belongs to, personal first, then by name. */
export async function listWorkspaces(
  userId: string,
): Promise<WorkspaceMembership[]> {
  const rows = await getDb()
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
      personalUserId: workspaces.personalUserId,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.name));
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      personal: r.personalUserId === userId,
    }))
    .sort((a, b) => Number(b.personal) - Number(a.personal));
}

/**
 * The id of `userId`'s personal workspace, creating it on first use. Safe to
 * call concurrently: the unique personal_user_id index lets only one creation
 * win, and the loser uses the winner's.
 */
export async function ensurePersonalWorkspace(userId: string): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.personalUserId, userId));
  if (existing[0]) return existing[0].id;

  const id = newId();
  try {
    await db.batch([
      db
        .insert(workspaces)
        .values({ id, name: "Personal", personalUserId: userId }),
      db
        .insert(workspaceMembers)
        .values({ workspaceId: id, userId, role: "owner" }),
    ]);
  } catch (err) {
    if (!isUniqueViolation(err, "workspaces.personal_user_id")) throw err;
    const [winner] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalUserId, userId));
    if (!winner) throw err;
    return winner.id;
  }
  await recordAudit({
    action: "workspace.created",
    actorId: userId,
    targetType: "workspace",
    targetId: id,
    metadata: { personal: true },
  });
  return id;
}

/** `userId`'s role in `workspaceId`, or null if they aren't a member. */
export async function workspaceRole(
  userId: string,
  workspaceId: string,
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
 * The principal and their role, if they hold at least `minimum` in the
 * workspace; otherwise Unauthorized (signed out) or Forbidden. Non-members get
 * the same ForbiddenError as members without the role, so a workspace id
 * doesn't reveal whether the workspace exists. Platform roles (system_admin)
 * grant nothing here: workspace data is the tenant's.
 */
export async function requireWorkspaceRole(
  principal: Principal | null,
  workspaceId: string,
  minimum: WorkspaceRole,
): Promise<{ principal: Principal; role: WorkspaceRole }> {
  const p = requirePrincipal(principal);
  const role = await workspaceRole(p.userId, workspaceId);
  if (!role || RANK[role] < RANK[minimum]) {
    throw new ForbiddenError(`workspace:${minimum}`);
  }
  return { principal: p, role };
}
