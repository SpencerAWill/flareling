import type { Principal } from "@flareling/auth";
import { getDb, newId, schema } from "@flareling/db";
import { Temporal } from "temporal-polyfill";
import type { WorkspaceRole } from "../src/roles.ts";

/**
 * A fixed time for tests that write workspace timestamps, so nothing they
 * assert depends on when they run.
 */
export const T0 = Temporal.Instant.from("2026-10-19T09:00:00Z");

/** An account with a verified primary email, as the principal it signs in as. */
export async function createUser(email?: string): Promise<Principal> {
  const db = getDb();
  const userId = newId();
  const address = email ?? `${userId}@example.com`;
  await db.batch([
    db.insert(schema.users).values({ id: userId }),
    db.insert(schema.userEmails).values({
      userId,
      email: address,
      isPrimary: true,
      verifiedAt: new Date(),
    }),
  ]);
  return {
    userId,
    primaryEmail: address,
    emails: [address],
    roles: [],
    permissions: [],
    isSystemAdmin: false,
  };
}

/** Adds `userId` to the workspace directly, as accepting an invite would. */
export async function addMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  joinedAt: Date = new Date(),
): Promise<void> {
  await getDb()
    .insert(schema.workspaceMembers)
    .values({ workspaceId, userId, role, createdAt: joinedAt });
}
