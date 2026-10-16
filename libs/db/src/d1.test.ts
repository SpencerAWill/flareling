import { inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  containsText,
  D1_MAX_BOUND_PARAMS,
  getDb,
  inJsonArray,
  inSubquery,
  insertMany,
  insertStatements,
  isForeignKeyViolation,
  isUniqueViolation,
  notInJsonArray,
  notInSubquery,
  rowsPerInsertStatement,
  runBatch,
  schema,
} from "./index.ts";

const { auditLog } = schema;

/** Every message on an error's cause chain, so a wrapped driver error shows. */
function causeChain(err: unknown): string {
  const messages: string[] = [];
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    messages.push(e.message);
  }
  return messages.join(" | ");
}

/** Ids that match no row: these tests measure binding, not results. */
function ids(count: number, prefix = "probe"): string[] {
  return Array.from({ length: count }, (_unused, i) => `${prefix}_${i}`);
}

function selectIn(list: readonly string[]) {
  return getDb()
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(inArray(auditLog.id, [...list]));
}

async function seed(prefix: string, count: number): Promise<string[]> {
  const seeded = ids(count, prefix);
  await insertMany(
    auditLog,
    seeded.map((id) => ({ id, action: "test.seeded", actorId: null })),
  );
  return seeded;
}

describe("D1's bound-parameter ceiling", () => {
  it(`binds exactly ${D1_MAX_BOUND_PARAMS} parameters`, async () => {
    await expect(selectIn(ids(D1_MAX_BOUND_PARAMS))).resolves.toEqual([]);
  });

  it("refuses one more, which is why no statement may bind a list", async () => {
    // Asserting the reason, not just that it threw: a query failing for some
    // other reason would otherwise keep this green while the limit moved.
    await expect(selectIn(ids(D1_MAX_BOUND_PARAMS + 1))).rejects.toSatisfy(
      (err: unknown) => /too many SQL variables/i.test(causeChain(err)),
      "rejects with D1's too-many-variables error",
    );
  });
});

describe("inJsonArray / notInJsonArray", () => {
  it("binds any length as one parameter: 5000 values, far past the ceiling", async () => {
    const real = await seed("json_in", 3);
    const rows = await getDb()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(inJsonArray(auditLog.id, [...ids(4997), ...real]));
    expect(rows.map((r) => r.id).sort()).toEqual([...real].sort());
  });

  it("matches nothing for an empty list", async () => {
    await seed("json_empty", 2);
    const rows = await getDb()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(inJsonArray(auditLog.id, []));
    expect(rows).toEqual([]);
  });

  it("keeps integers integers, so a numeric column still matches", async () => {
    const rows = await getDb().all<{ n: number }>(
      sql`SELECT 7 AS n WHERE ${inJsonArray(sql`7`, [3, 7])}`,
    );
    expect(rows).toEqual([{ n: 7 }]);
  });

  it("excludes the listed values and nothing else, at any length", async () => {
    const seeded = await seed("json_notin", 4);
    const rows = await getDb()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(notInJsonArray(auditLog.id, [...ids(500), seeded[0] ?? ""]));
    const mine = rows.map((r) => r.id).filter((id) => seeded.includes(id));
    expect(mine.sort()).toEqual(seeded.slice(1).sort());
  });
});

describe("inSubquery / notInSubquery", () => {
  it("filters by a subquery without binding a list", async () => {
    const seeded = await seed("subq", 3);
    const marked = getDb()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(inJsonArray(auditLog.id, seeded.slice(0, 2)));
    const inside = await getDb()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(inSubquery(auditLog.id, marked));
    const outside = await getDb()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(notInSubquery(auditLog.id, marked));
    expect(inside.map((r) => r.id).sort()).toEqual(seeded.slice(0, 2).sort());
    expect(outside.map((r) => r.id)).toContain(seeded[2]);
    expect(outside.map((r) => r.id)).not.toContain(seeded[0]);
  });
});

describe("insertStatements / insertMany", () => {
  it("sizes a statement by the columns that will bind", () => {
    // 7 columns, but created_at's SQL default is inlined when omitted: 6
    // bound, so 16 rows per statement.
    expect(rowsPerInsertStatement(auditLog)).toBe(16);
    // Supplied, created_at binds like any other column: 7, so 14 rows.
    expect(
      rowsPerInsertStatement(auditLog, [
        { action: "a.b", actorId: null, createdAt: new Date() },
      ]),
    ).toBe(14);
  });

  it("writes 300 rows in one atomic batch of fitting statements", async () => {
    const rows = ids(300, "bulk").map((id) => ({
      id,
      action: "test.bulk",
      actorId: null,
    }));
    expect(insertStatements(auditLog, rows)).toHaveLength(19);

    await insertMany(auditLog, rows);

    const written = await getDb()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        inJsonArray(
          auditLog.id,
          rows.map((r) => r.id),
        ),
      );
    expect(written).toHaveLength(300);
  });

  it("rolls back every statement when one fails", async () => {
    const good = ids(20, "rollback").map((id) => ({
      id,
      action: "test.rollback",
      actorId: null,
    }));
    // The last row repeats the first's primary key, so the second statement
    // fails after the first has run.
    const rows = [...good, { ...good[0], action: "test.dupe" }] as typeof good;

    await expect(insertMany(auditLog, rows)).rejects.toSatisfy((err) =>
      isUniqueViolation(err, "audit_log.id"),
    );

    const written = await getDb()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        inJsonArray(
          auditLog.id,
          good.map((r) => r.id),
        ),
      );
    expect(written).toEqual([]);
  });

  it("does nothing for no rows", async () => {
    await expect(insertMany(auditLog, [])).resolves.toBeUndefined();
    await expect(runBatch([])).resolves.toBeUndefined();
  });

  it("skips colliding rows with onConflictDoNothing", async () => {
    const [id] = await seed("conflict", 1);
    await insertMany(
      auditLog,
      [{ id: id ?? "", action: "test.replaced", actorId: null }],
      { onConflictDoNothing: true },
    );
    const [row] = await getDb()
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(inJsonArray(auditLog.id, [id ?? ""]));
    expect(row?.action).toBe("test.seeded");
  });
});

describe("constraint errors", () => {
  it("recognizes a unique violation through D1's and Drizzle's wrappers", async () => {
    const [id] = await seed("unique", 1);
    const err = await getDb()
      .insert(auditLog)
      .values({ id: id ?? "", action: "test.dupe", actorId: null })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
    expect(isUniqueViolation(err, "audit_log.id")).toBe(true);
    expect(isUniqueViolation(err, "audit_log.action")).toBe(false);
    expect(isForeignKeyViolation(err)).toBe(false);
  });

  it("recognizes a foreign key violation", async () => {
    await getDb().run(sql`PRAGMA foreign_keys = ON`);
    await getDb().run(
      sql`CREATE TABLE IF NOT EXISTS fk_parent (id TEXT PRIMARY KEY)`,
    );
    await getDb().run(
      sql`CREATE TABLE IF NOT EXISTS fk_child (parent_id TEXT REFERENCES fk_parent(id))`,
    );
    const err = await getDb()
      .run(sql`INSERT INTO fk_child (parent_id) VALUES ('missing')`)
      .catch((e: unknown) => e);
    expect(isForeignKeyViolation(err)).toBe(true);
    expect(isUniqueViolation(err)).toBe(false);
  });

  it("is false for anything that isn't a constraint error", () => {
    expect(isUniqueViolation(new Error("network down"))).toBe(false);
    expect(isUniqueViolation("UNIQUE constraint failed")).toBe(false);
  });
});

describe("containsText", () => {
  const find = async (query: string) =>
    (
      await getDb()
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(containsText(auditLog.targetId, query))
    ).map((r) => r.id);

  it("matches literally, wildcards included, ignoring ASCII case", async () => {
    await insertMany(auditLog, [
      {
        id: "text_pct",
        action: "test.text",
        actorId: null,
        targetId: "50% OFF",
      },
      {
        id: "text_any",
        action: "test.text",
        actorId: null,
        targetId: "500 off",
      },
      { id: "text_us", action: "test.text", actorId: null, targetId: "a_b" },
      { id: "text_ab", action: "test.text", actorId: null, targetId: "axb" },
    ]);
    expect(await find("50% off")).toEqual(["text_pct"]);
    expect(await find("a_b")).toEqual(["text_us"]);
  });

  it("takes a query far past D1's 50-byte LIKE pattern limit", async () => {
    const long = "x".repeat(500);
    await insertMany(auditLog, [
      {
        id: "text_long",
        action: "test.text",
        actorId: null,
        targetId: `-${long}-`,
      },
    ]);
    expect(await find(long)).toEqual(["text_long"]);
  });
});
