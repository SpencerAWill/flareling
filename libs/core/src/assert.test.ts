import { expect, it } from "vitest";
import { assertNever } from "./assert.ts";

it("assertNever throws with the unhandled value", () => {
  expect(() => assertNever({ kind: "unknown" } as never)).toThrow(
    'Unhandled value: {"kind":"unknown"}',
  );
});
