/**
 * Exhaustiveness check for discriminated unions: a `switch` whose `default`
 * calls this fails to typecheck when a new variant is added but not handled.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
}
