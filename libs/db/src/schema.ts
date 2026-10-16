/**
 * The Drizzle schema for the suite's D1 database. `pnpm --filter @flareling/db
 * db:generate` turns changes here into a migration in ../migrations, and CI's
 * drift check fails if this file and the migrations disagree.
 *
 * Migrations must stay backward compatible (expand, deploy, contract), because
 * they are applied before the code that uses them is deployed.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { newId } from "./id.ts";

/**
 * Security-relevant actions, kept for investigation (who changed what, when).
 *
 * Non-PII only, like log lines: ids, never names, emails or free text a user
 * typed. That keeps the table out of data-export and erasure requests, and
 * means it can be retained after the people in it are gone.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    // Who did it. Plain text for now; it becomes a foreign key to the users
    // table once authentication exists (ON DELETE SET NULL, so the row
    // outlives the account). Null for system actions such as a cron job.
    actorId: text("actor_id"),
    // `namespace.verb_in_snake_case`, like log event names (`role.assigned`).
    action: text("action").notNull(),
    // What it was done to. Loose text, because the kinds of target grow with
    // the features; the action says how to read them.
    targetType: text("target_type"),
    targetId: text("target_id"),
    // Non-PII context as JSON. See the table comment.
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    // Newest first, the default view.
    index("audit_log_created_at_idx").on(t.createdAt),
    // "What did this person do?" and "what happened to this thing?"
    index("audit_log_actor_idx").on(t.actorId),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_action_idx").on(t.action),
  ],
);
