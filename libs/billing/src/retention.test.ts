import { getDb, schema } from "@flareling/db";
import { describe, expect, it } from "vitest";
import { sweepStripeEvents } from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;

describe("sweepStripeEvents", () => {
  it("forgets event ids processed more than 30 days ago", async () => {
    const now = new Date("2026-10-16T12:00:00Z");
    await getDb()
      .insert(schema.stripeEvents)
      .values([
        {
          id: "evt_old",
          type: "invoice.paid",
          processedAt: new Date(now.getTime() - 31 * DAY),
        },
        {
          id: "evt_recent",
          type: "invoice.paid",
          processedAt: new Date(now.getTime() - 29 * DAY),
        },
      ]);

    expect(await sweepStripeEvents(now)).toEqual({
      deleted: 1,
      complete: true,
    });
    const ids = (await getDb().select().from(schema.stripeEvents)).map(
      (e) => e.id,
    );
    expect(ids).toContain("evt_recent");
    expect(ids).not.toContain("evt_old");
  });
});
