/**
 * Resolving who a request is: the session, then the account's emails, roles
 * and permissions. Loaded fresh on every request (memoized within one), so a
 * role change takes effect on the next request with nothing to invalidate.
 */
import { getDb, inJsonArray, schema } from "@flareling/db";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { AuthContext } from "./context.ts";
import type { Principal } from "./rbac.ts";
import { closeSession, loadSession, rotateSession } from "./session.ts";

const { userEmails, userRoles, roles, rolePermissions, permissions } = schema;

/** The role that implicitly holds every permission. */
export const SYSTEM_ADMIN_ROLE = "system_admin";

/**
 * The principal for `userId`, or null if the account doesn't exist. Two round
 * trips: emails and roles in one batch, then the permissions those roles
 * grant (every permission, for a system admin).
 */
export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const db = getDb();
  const [emailRows, roleRows] = await db.batch([
    db
      .select({ email: userEmails.email, isPrimary: userEmails.isPrimary })
      .from(userEmails)
      .where(eq(userEmails.userId, userId))
      .orderBy(desc(userEmails.isPrimary), asc(userEmails.createdAt)),
    db
      // Aliased: in a batch, D1 returns rows keyed by column name, so two
      // tables' `name` columns would overwrite each other.
      .select({
        id: roles.id,
        roleName: sql<string>`${roles.name}`.as("role_name"),
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId))
      .orderBy(asc(roles.position), asc(roles.name)),
  ]);

  const primary = emailRows.find((r) => r.isPrimary);
  if (!primary) return null;

  const roleNames = roleRows.map((r) => r.roleName);
  const isSystemAdmin = roleNames.includes(SYSTEM_ADMIN_ROLE);
  const permissionRows = isSystemAdmin
    ? await db.select({ name: permissions.name }).from(permissions)
    : roleRows.length === 0
      ? []
      : await db
          .selectDistinct({ name: permissions.name })
          .from(rolePermissions)
          .innerJoin(
            permissions,
            eq(permissions.id, rolePermissions.permissionId),
          )
          .where(
            inJsonArray(
              rolePermissions.roleId,
              roleRows.map((r) => r.id),
            ),
          );

  return {
    userId,
    primaryEmail: primary.email,
    emails: emailRows.map((r) => r.email),
    roles: roleNames,
    permissions: permissionRows.map((r) => r.name).sort(),
    isSystemAdmin,
  };
}

const principals = new WeakMap<AuthContext, Promise<Principal | null>>();

/**
 * The signed-in principal for this request, or null. Memoized per AuthContext,
 * which the app creates once per request, so a request that checks
 * permissions in several places loads them once.
 */
export function getPrincipal(ctx: AuthContext): Promise<Principal | null> {
  let principal = principals.get(ctx);
  if (!principal) {
    principal = loadSession(ctx).then((session) =>
      session ? loadPrincipal(session.userId) : null,
    );
    principals.set(ctx, principal);
  }
  return principal;
}

/**
 * Signs this browser in as `userId`: a fresh session (rotating out any
 * previous one) and a cleared principal memo, so the rest of the request sees
 * the new account.
 */
export async function signIn(ctx: AuthContext, userId: string): Promise<void> {
  await rotateSession(ctx, userId);
  principals.delete(ctx);
}

/** Signs this browser out. */
export async function signOut(ctx: AuthContext): Promise<void> {
  await closeSession(ctx);
  principals.delete(ctx);
}
