import { getDb, schema } from "./client.ts";

export interface AuditEntry {
  /** `namespace.verb_in_snake_case`, e.g. `role.assigned`. */
  readonly action: string;
  /** Who did it, or null for a system action. */
  readonly actorId: string | null;
  readonly targetType?: string;
  readonly targetId?: string;
  /** Non-PII context only: ids and enum values, never names, emails or free
   *  text. Stored as JSON. */
  readonly metadata?: Readonly<
    Record<string, string | number | boolean | null>
  >;
}

/** The row for `entry`, for adding an audit write to a larger `db.batch`. */
export function auditRow(
  entry: AuditEntry,
): typeof schema.auditLog.$inferInsert {
  return {
    action: entry.action,
    actorId: entry.actorId,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
  };
}

/**
 * Records one audit entry. When the audited change is itself a database
 * write, put `insert(auditLog).values(auditRow(entry))` in the same
 * `db.batch` instead, so the change and its record commit together.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  await getDb().insert(schema.auditLog).values(auditRow(entry));
}
