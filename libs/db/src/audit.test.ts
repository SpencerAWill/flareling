import { describe, expect, it } from "vitest";
import { auditRow, getDb, inJsonArray, recordAudit, schema } from "./index.ts";

describe("recordAudit", () => {
  it("writes the entry with an id and a database timestamp", async () => {
    const before = Date.now();
    await recordAudit({
      action: "role.assigned",
      actorId: "user_admin",
      targetType: "user",
      targetId: "user_member",
      metadata: { role: "editor", via: "admin_ui" },
    });

    const [row] = await getDb()
      .select()
      .from(schema.auditLog)
      .where(inJsonArray(schema.auditLog.targetId, ["user_member"]));

    expect(row).toMatchObject({
      action: "role.assigned",
      actorId: "user_admin",
      targetType: "user",
      targetId: "user_member",
      metadataJson: '{"role":"editor","via":"admin_ui"}',
    });
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    // unixepoch() has second precision, so allow the clock to have just ticked.
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("takes the caller's time when given one", async () => {
    const at = new Date("2026-01-02T03:04:05Z");
    await recordAudit({
      action: "role.assigned",
      actorId: "user_clocked",
      targetId: "clocked_target",
      at,
    });
    const [row] = await getDb()
      .select()
      .from(schema.auditLog)
      .where(inJsonArray(schema.auditLog.targetId, ["clocked_target"]));
    expect(row?.createdAt).toEqual(at);
  });

  it("stores system actions and missing targets as nulls", () => {
    expect(auditRow({ action: "retention.swept", actorId: null })).toEqual({
      action: "retention.swept",
      actorId: null,
      targetType: null,
      targetId: null,
      metadataJson: null,
    });
  });
});
