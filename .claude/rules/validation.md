---
paths:
  - "apps/**/src/**"
  - "libs/**/src/**"
  - "tooling/scripts/src/**"
---

# Validating input with zod

Anything that crosses into this code from outside is parsed with a zod schema, never cast (`as T`) or checked field by field. "Outside" means:
- request bodies, search params and headers
- server function inputs
- queue messages and WebSocket messages
- third-party API responses
- JSON stored in a database column
- CLI or tool output
- env vars

## Where the schemas live

- **Server function inputs** use `.validator(schema)`. When a form submits it, the form and the server share the schema from `apps/web/src/lib/schemas.ts`.
- **Forms** use the kit in `apps/web/src/components/form.tsx` (TanStack Form), with that same schema as the `onChange` validator.
- **Messages between apps** (queue bodies, realtime messages, connection identity) live with their producer: `libs/billing`'s `stripeEventMessage`, and `libs/contracts`. The consumer parses with them.
- **Env vars** go through `defineEnv` (`libs/env`).

## How to parse

- **Use `safeParse` where a bad value has a sensible fallback,** and decide that fallback deliberately. Fail closed for anything security-relevant (Turnstile), drop for hints (passkey transports), and send it to the dead-letter queue for queue messages.
- **Write messages for people** when they can reach a form.

## Not parsed

These are trusted rather than re-validated:
- the database's own typed rows (Drizzle)
- data passed between functions in the same process
- WebAuthn payloads, which `@simplewebauthn` verifies cryptographically
