import { getDb, newId, schema } from "@flareling/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createUser, T0 } from "../test/users.ts";
import { createWorkspace } from "./index.ts";
import { sweepWorkspaceInvites } from "./retention.ts";

const DAY = 24 * 60 * 60 * 1000;

describe("sweepWorkspaceInvites", () => {
  it("deletes invites a month after they expire, answered or not", async () => {
    const owner = await createUser();
    const created = await createWorkspace(owner, "Sweep", T0);
    if (!created.ok) throw new Error("setup");
    const now = new Date("2026-10-19T03:17:00Z");
    const invite = (email: string, expiredDaysAgo: number) => ({
      workspaceId: created.id,
      email,
      role: "member" as const,
      tokenHash: newId(),
      invitedBy: owner.userId,
      expiresAt: new Date(now.getTime() - expiredDaysAgo * DAY),
    });
    await getDb()
      .insert(schema.workspaceInvites)
      .values([
        invite("old@example.com", 31),
        { ...invite("old.accepted@example.com", 40), acceptedAt: new Date() },
        invite("recent@example.com", 29),
        invite("open@example.com", -3),
      ]);

    expect(await sweepWorkspaceInvites(now)).toEqual({
      deleted: 2,
      complete: true,
    });
    const left = await getDb()
      .select({ email: schema.workspaceInvites.email })
      .from(schema.workspaceInvites)
      .where(eq(schema.workspaceInvites.workspaceId, created.id));
    expect(left.map((r) => r.email).sort()).toEqual([
      "open@example.com",
      "recent@example.com",
    ]);
  });
});
