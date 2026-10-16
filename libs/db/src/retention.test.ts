import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb, newId, schema } from "./index.ts";
import { deleteBefore, deleteBeforeStatement } from "./retention.ts";

const { sessions, users } = schema;
const HOUR = 60 * 60 * 1000;

async function seedSessions(userId: string, expiries: Date[]) {
  const now = new Date();
  for (const expiresAt of expiries) {
    await getDb().insert(sessions).values({
      tokenHash: newId(),
      userId,
      lastSeenAt: now,
      expiresAt,
    });
  }
}

async function remaining(userId: string) {
  return (await getDb().select().from(sessions)).filter(
    (s) => s.userId === userId,
  );
}

describe("deleteBefore", () => {
  it("deletes only rows before the cutoff", async () => {
    const userId = newId();
    await getDb().insert(users).values({ id: userId });
    const now = Date.now();
    await seedSessions(userId, [
      new Date(now - 2 * HOUR),
      new Date(now - HOUR),
      new Date(now + HOUR),
    ]);

    const result = await deleteBefore(
      sessions,
      sessions.expiresAt,
      new Date(now),
    );

    expect(result).toEqual({ deleted: 2, complete: true });
    expect((await remaining(userId)).map((s) => s.expiresAt.getTime())).toEqual(
      [now + HOUR],
    );
  });

  it("stops at maxBatches and says rows may remain, for the next run", async () => {
    const userId = newId();
    await getDb().insert(users).values({ id: userId });
    const past = new Date(Date.now() - HOUR);
    await seedSessions(
      userId,
      Array.from({ length: 7 }, () => past),
    );
    const cutoff = new Date();

    expect(
      await deleteBefore(sessions, sessions.expiresAt, cutoff, {
        batchSize: 2,
        maxBatches: 3,
      }),
    ).toEqual({ deleted: 6, complete: false });
    expect(await remaining(userId)).toHaveLength(1);
    expect(
      await deleteBefore(sessions, sessions.expiresAt, cutoff, {
        batchSize: 2,
        maxBatches: 3,
      }),
    ).toEqual({ deleted: 1, complete: true });
  });

  it.each([
    ["sessions", schema.sessions, schema.sessions.expiresAt],
    ["magic_links", schema.magicLinks, schema.magicLinks.expiresAt],
    [
      "webauthn_challenges",
      schema.webauthnChallenges,
      schema.webauthnChallenges.expiresAt,
    ],
    ["stripe_events", schema.stripeEvents, schema.stripeEvents.processedAt],
    ["email_outbox", schema.emailOutbox, schema.emailOutbox.createdAt],
  ] as const)(
    "finds %s rows by index, not a table scan",
    async (name, table, column) => {
      const { sql, params } = deleteBeforeStatement(
        table,
        column,
        new Date(),
        500,
      ).toSQL();
      const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...params)
        .all<{ detail: string }>();
      const details = plan.results.map((r) => r.detail);
      // A full scan reads as "SCAN <table>" with no "USING ... INDEX".
      expect(
        details.filter((d) => /^SCAN /.test(d) && !/USING/.test(d)),
        details.join("\n"),
      ).toEqual([]);
      expect(details.join("\n")).toContain(name);
    },
  );
});
