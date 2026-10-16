import { getDb, newId, schema } from "@flareling/db";
import { eq } from "drizzle-orm";

/** Creates an account with a verified primary email, and optional roles. */
export async function createUser(
  email: string,
  roleNames: readonly string[] = [],
): Promise<string> {
  const db = getDb();
  const userId = newId();
  await db.batch([
    db.insert(schema.users).values({ id: userId }),
    db.insert(schema.userEmails).values({
      userId,
      email,
      isPrimary: true,
      verifiedAt: new Date(),
    }),
  ]);
  for (const name of roleNames) {
    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, name));
    if (!role) throw new Error(`no role ${name}`);
    await db.insert(schema.userRoles).values({ userId, roleId: role.id });
  }
  return userId;
}
