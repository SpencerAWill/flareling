/**
 * D1-specific helpers, ported from ucmc.spencerwill.com, where each one exists
 * because of a production failure. The rules they encode:
 *
 * **No statement may bind a number of parameters that grows with the data.**
 * D1 binds at most 100 per statement (D1_MAX_BOUND_PARAMS, pinned against
 * real D1 in d1.test.ts), and the two shapes that grow reach it in ordinary
 * use: `inArray(col, list)` binds one per element, and
 * `insert().values(rows)` binds one per column per row (an audit row binds 7,
 * so 15 rows in one statement fail). In order of preference:
 *
 *   1. A subquery or join, when the list came out of the database. No list
 *      parameters at all; write it with `inSubquery` / `notInSubquery`.
 *   2. `inJsonArray` / `notInJsonArray`, when the list came from the caller.
 *      One JSON parameter expanded by `json_each`, at any length.
 *   3. `insertStatements` / `insertMany` for multi-row writes. They split the
 *      rows into statements that fit and run them in one atomic batch.
 *
 * Don't use `inArray` / `notInArray` from drizzle-orm with a list.
 *
 * **Constraint errors arrive wrapped.** Drizzle and D1 each wrap SQLite's
 * error, so `isUniqueViolation` / `isForeignKeyViolation` walk the cause chain.
 */
import {
  getTableColumns,
  is,
  type SQL,
  SQL as SQLExpression,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type {
  AnySQLiteColumn,
  IndexColumn,
  SQLiteInsertValue,
  SQLiteTable,
  SQLiteUpdateSetSource,
} from "drizzle-orm/sqlite-core";
import { type Db, getDb } from "./client.ts";

/**
 * D1's per-statement limit on bound parameters: 100 binds, 101 fails with
 * "too many SQL variables". A platform limit, not a tuning knob. d1.test.ts
 * pins it, so a change surfaces as a failing test rather than a 500.
 */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * `column IN (...values)`, binding the whole list as one JSON parameter and
 * expanding it with `json_each`, the pattern D1's docs give for this. Use it
 * when the values come from the caller; when they came out of a query, write
 * the subquery instead. An empty list matches nothing. Values compare as JSON
 * scalars, so strings stay TEXT and integers stay INTEGER; convert anything
 * else (booleans, dates) to its stored form first.
 */
export function inJsonArray(
  column: AnySQLiteColumn | SQL,
  values: readonly (string | number)[],
): SQL {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

/** `column NOT IN (...values)`; see `inJsonArray`. An empty list excludes nothing. */
export function notInJsonArray(
  column: AnySQLiteColumn | SQL,
  values: readonly (string | number)[],
): SQL {
  return sql`${column} NOT IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

/**
 * `column IN (subquery)`: `inArray` narrowed to the form that binds no list.
 * It takes a query builder, and an array isn't one, so it can't be handed the
 * shape the rule above forbids.
 */
export function inSubquery(
  column: AnySQLiteColumn | SQL,
  subquery: SQLWrapper,
): SQL {
  return sql`${column} in ${subquery}`;
}

/** `column NOT IN (subquery)`; see `inSubquery`. */
export function notInSubquery(
  column: AnySQLiteColumn | SQL,
  subquery: SQLWrapper,
): SQL {
  return sql`${column} not in ${subquery}`;
}

/**
 * How many rows one multi-row INSERT into `table` can carry.
 *
 * Every column counts as bound, except one with a SQL-expression default
 * (`created_at` defaulting to `unixepoch() * 1000`) that no row supplies:
 * Drizzle inlines that default only when the value is left out, so pass the
 * rows you're about to insert. An omitted column without a default still
 * counts (Drizzle writes a literal null), so the figure can only overcount,
 * which costs an extra statement rather than a failed query. Assumes the
 * statement binds nothing else, so an upsert's `set` must read `excluded.*`.
 */
export function rowsPerInsertStatement(
  table: SQLiteTable,
  rows: readonly Record<string, unknown>[] = [],
): number {
  const supplied = new Set(
    rows.flatMap((row) =>
      Object.entries(row)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key),
    ),
  );
  const columns = Object.entries(getTableColumns(table)).filter(
    ([key, column]) => !is(column.default, SQLExpression) || supplied.has(key),
  ).length;
  return Math.floor(D1_MAX_BOUND_PARAMS / columns);
}

function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_unused, i) =>
    rows.slice(i * size, (i + 1) * size),
  );
}

type BatchStatement = Parameters<Db["batch"]>[0][number];

/**
 * The INSERT statements that write `rows` without any one binding more than
 * D1 accepts. Spread them into a `db.batch([...])` with the rest of a
 * mutation, or use `insertMany` on their own. D1 applies its limits per
 * statement and runs a batch as one transaction, so the write stays atomic.
 */
export function insertStatements<TTable extends SQLiteTable>(
  table: TTable,
  rows: readonly SQLiteInsertValue<TTable>[],
  options: {
    /** `INSERT ... ON CONFLICT DO NOTHING`, per statement. */
    readonly onConflictDoNothing?: boolean;
    /** Upsert, per statement. `set` must read `excluded.*`; a bound JS value
     *  there adds parameters the sizing doesn't count. */
    readonly onConflictDoUpdate?: {
      readonly target: IndexColumn | IndexColumn[];
      readonly set: SQLiteUpdateSetSource<TTable>;
    };
  } = {},
): BatchStatement[] {
  const db = getDb();
  const { onConflictDoNothing, onConflictDoUpdate } = options;
  return chunkRows(rows, rowsPerInsertStatement(table, rows)).map((part) => {
    const insert = db.insert(table).values(part);
    if (onConflictDoUpdate) {
      return insert.onConflictDoUpdate({
        target: onConflictDoUpdate.target,
        set: onConflictDoUpdate.set,
      });
    }
    return onConflictDoNothing ? insert.onConflictDoNothing() : insert;
  });
}

/**
 * `db.batch` over a list that may be empty. Drizzle types a batch as a
 * non-empty tuple, and an empty one fails at runtime.
 */
export async function runBatch(
  statements: readonly BatchStatement[],
): Promise<void> {
  const first = statements.at(0);
  if (first === undefined) {
    return;
  }
  await getDb().batch([first, ...statements.slice(1)]);
}

/** Inserts any number of rows atomically. See `insertStatements`. */
export async function insertMany<TTable extends SQLiteTable>(
  table: TTable,
  rows: readonly SQLiteInsertValue<TTable>[],
  options: Parameters<typeof insertStatements<TTable>>[2] = {},
): Promise<void> {
  await runBatch(insertStatements(table, rows, options));
}

function causeChainIncludes(err: unknown, ...fragments: string[]): boolean {
  let current: unknown = err;
  while (current instanceof Error) {
    if (
      fragments.every(
        (f) => current instanceof Error && current.message.includes(f),
      )
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/**
 * Whether `err` is a UNIQUE constraint failure, optionally on one index
 * (`isUniqueViolation(err, "audit_log.id")`). A pre-check before an insert is
 * only UX; this is the real safety net when two requests race past it.
 */
export function isUniqueViolation(
  err: unknown,
  indexFragment?: string,
): boolean {
  return indexFragment === undefined
    ? causeChainIncludes(err, "UNIQUE constraint failed")
    : causeChainIncludes(err, "UNIQUE constraint failed", indexFragment);
}

/** Whether `err` is a FOREIGN KEY constraint failure (a RESTRICT on delete). */
export function isForeignKeyViolation(err: unknown): boolean {
  return causeChainIncludes(err, "FOREIGN KEY constraint failed");
}

/**
 * Case-insensitive substring match: `column` contains `query`.
 *
 * Deliberately not `LIKE '%query%'`. D1 caps a LIKE pattern at 50 bytes, so
 * ordinary search input fails at runtime once it's long enough, and LIKE needs
 * its `%` and `_` escaped (with an explicit ESCAPE clause, which Drizzle's
 * `like()` never emits). `instr` has neither problem. Case folding is the same
 * as LIKE's: SQLite's `lower()` folds ASCII only, without ICU.
 */
export function containsText(
  column: AnySQLiteColumn | SQL,
  query: string,
): SQL {
  return sql`instr(lower(${column}), lower(${query})) > 0`;
}
