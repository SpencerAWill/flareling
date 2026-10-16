import { getDb, newId, schema } from "@flareling/db";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { sweepExpiredAuthRows } from "./index.ts";

const { magicLinks, sessions, users, webauthnChallenges } = schema;

describe("sweepExpiredAuthRows", () => {
  it("deletes expired sessions, magic links and ceremonies, and keeps live ones", async () => {
    const now = Temporal.Instant.from("2026-10-16T12:00:00Z");
    const before = new Date(now.subtract({ minutes: 1 }).epochMilliseconds);
    const after = new Date(now.add({ minutes: 1 }).epochMilliseconds);
    const userId = newId();
    const db = getDb();
    await db.insert(users).values({ id: userId });
    for (const [label, expiresAt] of [
      ["old", before],
      ["live", after],
    ] as const) {
      await db.insert(sessions).values({
        id: `${label}-${userId}`,
        tokenHash: newId(),
        userId,
        lastSeenAt: before,
        expiresAt,
      });
      await db.insert(magicLinks).values({
        id: `${label}-${userId}`,
        tokenHash: newId(),
        email: `${userId}@example.com`,
        intent: "sign_in",
        expiresAt,
      });
      await db.insert(webauthnChallenges).values({
        id: `${label}-${userId}`,
        challenge: "c",
        type: "authenticate",
        expiresAt,
      });
    }

    const result = await sweepExpiredAuthRows(now);

    const done = { deleted: 1, complete: true };
    expect(result).toEqual({
      sessions: done,
      magicLinks: done,
      webauthnChallenges: done,
    });
    for (const table of [sessions, magicLinks, webauthnChallenges]) {
      const ids = (await db.select({ id: table.id }).from(table)).map(
        (r) => r.id,
      );
      expect(ids).toContain(`live-${userId}`);
      expect(ids).not.toContain(`old-${userId}`);
    }
  });
});
