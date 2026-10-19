import { describe, expect, it } from "vitest";
import { serverMessage } from "./index.ts";

describe("serverMessage", () => {
  it("accepts the messages a room sends", () => {
    expect(
      serverMessage.parse({ type: "presence", online: ["u1", "u2"] }),
    ).toEqual({ type: "presence", online: ["u1", "u2"] });
    expect(serverMessage.parse({ type: "members_changed" })).toEqual({
      type: "members_changed",
    });
    expect(
      serverMessage.parse({ type: "disconnect", reason: "removed" }),
    ).toEqual({ type: "disconnect", reason: "removed" });
  });

  it("refuses anything else", () => {
    for (const bad of [
      { type: "presence" },
      { type: "presence", online: [1] },
      { type: "unknown" },
      { type: "disconnect", reason: "bored" },
      "pong",
      null,
    ]) {
      expect(serverMessage.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });
});
