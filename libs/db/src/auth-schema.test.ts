import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb, isUniqueViolation, newId, schema } from "./index.ts";

const {
  users,
  userEmails,
  sessions,
  passkeyCredentials,
  roles,
  permissions,
  userRoles,
} = schema;
const now = () => new Date();

async function createUser(email: string, isPrimary = true) {
  const userId = newId();
  await getDb().batch([
    getDb().insert(users).values({ id: userId }),
    getDb()
      .insert(userEmails)
      .values({ userId, email, isPrimary, verifiedAt: now() }),
  ]);
  return userId;
}

// These constraints are the race boundaries libs/auth relies on, so they are
// pinned against real D1 rather than assumed from the schema file.
describe("auth schema constraints", () => {
  it("gives an address to exactly one account", async () => {
    await createUser("taken@example.com");
    const err = await createUser("taken@example.com").catch((e: unknown) => e);
    expect(isUniqueViolation(err, "user_emails.email")).toBe(true);
  });

  it("allows one primary address per account, and any number of others", async () => {
    const userId = await createUser("primary@example.com");
    await getDb().insert(userEmails).values({
      userId,
      email: "secondary@example.com",
      isPrimary: false,
      verifiedAt: now(),
    });
    const err = await getDb()
      .insert(userEmails)
      .values({
        userId,
        email: "second-primary@example.com",
        isPrimary: true,
        verifiedAt: now(),
      })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("deletes an account's emails, sessions, passkeys and role grants with it", async () => {
    const userId = await createUser("leaving@example.com");
    const [member] = await getDb()
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, "member"));
    await getDb().batch([
      getDb()
        .insert(sessions)
        .values({
          userId,
          tokenHash: `hash-${newId()}`,
          lastSeenAt: now(),
          expiresAt: now(),
        }),
      getDb()
        .insert(passkeyCredentials)
        .values({
          userId,
          credentialId: `cred-${newId()}`,
          publicKey: "key",
        }),
      getDb()
        .insert(userRoles)
        .values({ userId, roleId: member?.id ?? "" }),
    ]);

    await getDb().delete(users).where(eq(users.id, userId));

    const remaining = await getDb().all<{ n: number }>(sql`
      SELECT (SELECT count(*) FROM user_emails WHERE user_id = ${userId})
           + (SELECT count(*) FROM sessions WHERE user_id = ${userId})
           + (SELECT count(*) FROM passkey_credentials WHERE user_id = ${userId})
           + (SELECT count(*) FROM user_roles WHERE user_id = ${userId}) AS n`);
    expect(remaining).toEqual([{ n: 0 }]);
  });

  it("refuses a session for an account that doesn't exist", async () => {
    await expect(
      getDb()
        .insert(sessions)
        .values({
          userId: "no-such-user",
          tokenHash: `hash-${newId()}`,
          lastSeenAt: now(),
          expiresAt: now(),
        }),
    ).rejects.toThrow();
  });
});

describe("the RBAC seed", () => {
  it("creates the system roles and the role permissions", async () => {
    const roleNames = await getDb().select({ name: roles.name }).from(roles);
    const permissionNames = await getDb()
      .select({ name: permissions.name })
      .from(permissions);
    expect(roleNames.map((r) => r.name).sort()).toEqual([
      "member",
      "system_admin",
    ]);
    expect(permissionNames.map((p) => p.name).sort()).toEqual([
      "roles:assign",
      "roles:manage",
    ]);
  });
});
