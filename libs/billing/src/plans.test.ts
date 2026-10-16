import { describe, expect, it } from "vitest";
import { PLANS } from "./index.ts";
import { planForLookupKey } from "./plans.ts";

describe("planForLookupKey", () => {
  it("maps every price lookup key to its plan", () => {
    expect(planForLookupKey("pro_monthly")).toBe("pro");
    expect(planForLookupKey("pro_yearly")).toBe("pro");
  });

  it("knows nothing of unmapped or missing keys", () => {
    expect(planForLookupKey("enterprise_monthly")).toBeUndefined();
    expect(planForLookupKey(null)).toBeUndefined();
    expect(planForLookupKey(undefined)).toBeUndefined();
    expect(planForLookupKey("")).toBeUndefined();
  });

  it("uses each lookup key for one plan only", () => {
    const keys = Object.values(PLANS).flatMap((p) =>
      "prices" in p ? Object.values(p.prices) : [],
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
