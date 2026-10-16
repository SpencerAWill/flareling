import { env } from "cloudflare:workers";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

export type Db = DrizzleD1Database<typeof schema>;

let db: Db | undefined;

/**
 * The Drizzle client over the `DB` binding, created on first use. Never at
 * module scope: bindings exist only inside a handler, and this module can end
 * up in a client bundle through a server function's imports.
 *
 * Two properties of the D1 driver that callers rely on, and that are not part
 * of Drizzle's cross-dialect contract: `db.batch([...])` is one request to D1,
 * and it runs as one transaction. Re-verify both before swapping drivers.
 */
export function getDb(): Db {
  db ??= drizzle((env as { DB: D1Database }).DB, { schema });
  return db;
}

export { schema };
