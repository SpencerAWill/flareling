import { describe, expect, it } from "vitest";
import { newId } from "./index.ts";

describe("newId", () => {
  it("is a version 7, RFC 9562 variant UUID", () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("sorts by creation, even within one millisecond", () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts with the creation time", () => {
    const before = Date.now();
    const millis = Number.parseInt(
      newId().replaceAll("-", "").slice(0, 12),
      16,
    );
    expect(millis).toBeGreaterThanOrEqual(before);
    expect(millis).toBeLessThanOrEqual(Date.now());
  });
});
