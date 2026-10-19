import { describe, expect, it } from "vitest";
import { newId, newPublicId, PUBLIC_ID_LENGTH } from "./index.ts";

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

describe("newPublicId", () => {
  it("is short lowercase letters and digits", () => {
    for (let i = 0; i < 100; i++) {
      expect(newPublicId()).toMatch(
        new RegExp(`^[0-9a-z]{${PUBLIC_ID_LENGTH}}$`),
      );
    }
  });

  it("doesn't repeat, or favor any character", () => {
    const ids = Array.from({ length: 5000 }, () => newPublicId());
    expect(new Set(ids).size).toBe(ids.length);
    const counts = new Map<string, number>();
    for (const c of ids.join("")) counts.set(c, (counts.get(c) ?? 0) + 1);
    // 50,000 characters over 36: about 1,389 each. Bias from a plain
    // `byte % 36` would put some near 1,560 and others near 1,170.
    expect(counts.size).toBe(36);
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(1_200);
      expect(n).toBeLessThan(1_580);
    }
  });
});
