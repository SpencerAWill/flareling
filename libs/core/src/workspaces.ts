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
import { and, asc, eq, sql } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import { OWNED_WORKSPACE_LIMIT, WORKSPACE_NAME_MAX } from "./limits.ts";

const { workspaces, workspaceMembers } = schema;

import type { WorkspaceRole } from "./roles.ts";

/** Higher ranks can do everything lower ones can. */
const RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 };

/**
 * `name` as stored: NFC, control and bidi characters removed, whitespace
 * collapsed. Null if nothing is left or it's longer than WORKSPACE_NAME_MAX. Names
 * appear in invite emails, so they're kept to one plain line.
 */
function normalizeWorkspaceName(name: string): string | null {
  const normalized = name
    .normalize("NFC")
    .replace(/\p{Cc}/gu, " ")
    // Bidi controls could make a name read differently in an email.
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || [...normalized].length > WORKSPACE_NAME_MAX) return null;
  return normalized;
}

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
export async function ensurePersonalWorkspace(
  userId: string,
  now: Temporal.Instant,
): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.personalUserId, userId));
  if (existing[0]) return existing[0].id;

  const id = newId();
  const createdAt = new Date(now.epochMilliseconds);
  try {
    await db.batch([
      db
        .insert(workspaces)
        .values({ id, name: "Personal", personalUserId: userId, createdAt }),
      db
        .insert(workspaceMembers)
        .values({ workspaceId: id, userId, role: "owner", createdAt }),
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
    at: createdAt,
  });
  return id;
}

export type CreateWorkspaceResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: "invalid_name" | "limit_reached" };

/**
 * Creates a team workspace owned by the principal. Refused once they own
 * OWNED_WORKSPACE_LIMIT team workspaces. The limit is checked inside the
 * insert, so concurrent requests can't each see room for one more; the
 * owner row is inserted only if the workspace was.
 */
export async function createWorkspace(
  principal: Principal | null,
  name: string,
  now: Temporal.Instant,
): Promise<CreateWorkspaceResult> {
  const { userId } = requirePrincipal(principal);
  const normalized = normalizeWorkspaceName(name);
  if (!normalized) return { ok: false, reason: "invalid_name" };

  const db = getDb();
  const id = newId();
  // INSERT ... SELECT lists every column in table order, hence the explicit
  // nulls and created_at.
  const [created] = await db.batch([
    db.insert(workspaces).select(sql`
      SELECT ${id}, ${normalized}, NULL, ${now.epochMilliseconds}
      WHERE (
        SELECT count(*) FROM workspace_members m
        JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = ${userId} AND m.role = 'owner'
          AND w.personal_user_id IS NULL
      ) < ${OWNED_WORKSPACE_LIMIT}`),
    db.insert(workspaceMembers).select(sql`
      SELECT ${id}, ${userId}, 'owner', ${now.epochMilliseconds}
      WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ${id})`),
  ]);
  if (created.meta.changes === 0) return { ok: false, reason: "limit_reached" };

  await recordAudit({
    action: "workspace.created",
    actorId: userId,
    targetType: "workspace",
    targetId: id,
    metadata: { personal: false },
    at: new Date(now.epochMilliseconds),
  });
  return { ok: true, id };
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
