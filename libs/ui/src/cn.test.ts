import { describe, expect, it } from "vitest";
import { cn } from "./cn.ts";

describe("cn", () => {
  it("lets a later class override a conflicting earlier one", () => {
    expect(cn("px-4 py-2", "px-2")).toBe("py-2 px-2");
  });

  it("keeps classes that don't conflict", () => {
    expect(cn("rounded", "text-sm")).toBe("rounded text-sm");
  });

  it("drops falsy values and applies conditional objects", () => {
    expect(cn("a", false, null, undefined, { b: true, c: false })).toBe("a b");
  });
});
