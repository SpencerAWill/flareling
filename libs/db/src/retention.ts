/**
 * Deleting rows that have outlived their use (expired sessions, processed
 * webhook ids), for the daily sweep in apps/jobs.
 *
 * A backlog can be large (a first run, or a sweep that was off for a while),
 * and two D1 limits make one big DELETE unsafe: a statement may run for 30 s,
 * and an invocation may make 1,000 queries (Paid). So rows go in batches of
 * `batchSize`, picked by a subquery on the cutoff column, which must be
 * indexed (retention.test.ts checks the query plan), and a run stops after
 * `maxBatches`. What's left goes on the next run, and `complete: false` says
 * so.
 */
import { lt } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "./client.ts";
import { inSubquery } from "./d1.ts";

type TableWithId = SQLiteTable & { id: AnySQLiteColumn };

export interface DeleteBeforeOptions {
  /** Rows per DELETE. */
  readonly batchSize?: number;
  /** DELETEs per call; at the defaults, up to 10,000 rows. */
  readonly maxBatches?: number;
}

export interface DeleteBeforeResult {
  readonly deleted: number;
  /** False when the run stopped at `maxBatches` with rows possibly left. */
  readonly complete: boolean;
}

/** One batch: `DELETE ... WHERE id IN (SELECT id ... WHERE column < cutoff LIMIT n)`. */
export function deleteBeforeStatement(
  table: TableWithId,
  column: AnySQLiteColumn,
  cutoff: Date,
  limit: number,
) {
  const db = getDb();
  return db
    .delete(table)
    .where(
      inSubquery(
        table.id,
        db
          .select({ id: table.id })
          .from(table)
          .where(lt(column, cutoff))
          .limit(limit),
      ),
    )
    .returning({ id: table.id });
}

/** Deletes rows of `table` whose `column` is before `cutoff`, in bounded batches. */
export async function deleteBefore(
  table: TableWithId,
  column: AnySQLiteColumn,
  cutoff: Date,
  { batchSize = 500, maxBatches = 20 }: DeleteBeforeOptions = {},
): Promise<DeleteBeforeResult> {
  let deleted = 0;
  // Sequential on purpose: each batch's subquery has to see the previous
  // batch's deletes. Bounded by maxBatches, so the query count is too.
  for (let i = 0; i < maxBatches; i++) {
    const rows = await deleteBeforeStatement(table, column, cutoff, batchSize);
    deleted += rows.length;
    if (rows.length < batchSize) return { deleted, complete: true };
  }
  return { deleted, complete: false };
}
