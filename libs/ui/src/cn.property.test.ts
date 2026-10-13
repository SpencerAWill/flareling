import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cn } from "./cn.ts";

// Real Tailwind utilities, grouped by the property they set, so generated
// inputs exercise actual conflict resolution rather than unknown strings that
// tailwind-merge would pass through untouched.
const groups = {
  paddingX: ["px-0", "px-1", "px-2", "px-4", "px-8"],
  textSize: ["text-xs", "text-sm", "text-base", "text-lg"],
  rounded: ["rounded-none", "rounded", "rounded-md", "rounded-full"],
  display: ["block", "inline-flex", "flex", "hidden"],
} as const;
const allClasses = Object.values(groups).flat();
const className = fc.constantFrom(...allClasses);
const classList = fc.array(className, { minLength: 1, maxLength: 12 });

const tokens = (value: string) => value.split(" ").filter(Boolean);

describe("cn properties", () => {
  it("is idempotent", () => {
    fc.assert(
      fc.property(classList, (classes) => {
        const once = cn(...classes);
        expect(cn(once)).toBe(once);
      }),
    );
  });

  it("never invents a class that wasn't passed in", () => {
    fc.assert(
      fc.property(classList, (classes) => {
        const output = tokens(cn(...classes));
        // Anti-vacuity: a non-empty input of real utilities always leaves at
        // least one class, so an implementation returning "" can't pass.
        expect(output.length).toBeGreaterThan(0);
        for (const token of output) expect(classes).toContain(token);
      }),
    );
  });

  it("keeps exactly one class per group: the last one passed", () => {
    fc.assert(
      fc.property(classList, (classes) => {
        const output = tokens(cn(...classes));
        for (const members of Object.values(groups)) {
          const passed = classes.filter((c) =>
            (members as readonly string[]).includes(c),
          );
          const kept = output.filter((c) =>
            (members as readonly string[]).includes(c),
          );
          expect(kept).toEqual(passed.length > 0 ? [passed.at(-1)] : []);
        }
      }),
    );
  });
});
