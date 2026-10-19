/**
 * A workspace's members. Every function takes the principal and checks their
 * role itself (requireWorkspaceRole), so callers can't forget to.
 */
import type { Principal } from "@flareling/auth";
import { getDb, schema } from "@flareling/db";
import { and, asc, eq } from "drizzle-orm";
import { requireWorkspaceRole, type WorkspaceRole } from "./workspaces.ts";

const { userEmails, workspaceMembers } = schema;

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
