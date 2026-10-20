/**
 * Server functions for sign-in. Thin shells: validate input with zod, then
 * call libs/auth through a dynamic import, which keeps the server-only code
 * (D1, bindings, cookies) out of the client bundle.
 */
import type { AuthContext } from "@flareling/auth";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signInSchema } from "#/lib/schemas.ts";

/** The signed-in account, or null. Sent to that account's own browser. */
export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getPrincipal } = await import("@flareling/auth");
    const { authContext } = await import("./context.server.ts");
    return getPrincipal(authContext());
  },
);

/** What the sign-in form needs to render: Turnstile's public site key. */
export const getSignInConfigFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getEnv } = await import("#/env.ts");
    return { turnstileSiteKey: getEnv().TURNSTILE_SITE_KEY ?? null };
  },
);

export const requestMagicLinkFn = createServerFn({ method: "POST" })
  .validator(
    // The sign-in form's schema (src/lib/schemas.ts), plus what the page adds.
    signInSchema.extend({
      redirect: z.string().max(2048).optional(),
      turnstileToken: z.string().max(4096).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { requestMagicLink } = await import("@flareling/auth");
    const { authContext } = await import("./context.server.ts");
    return requestMagicLink(authContext(), data);
  });

/**
 * Runs a sign-in. Signing in rotates out this browser's previous session,
 * which takes that session's access with it, so its realtime sockets are
 * closed too (ADR 0025). Reading the previous session first is the lookup
 * every page request already does, so it adds nothing for abuse guards to
 * stop.
 */
async function signingIn<T extends { readonly ok: boolean }>(
  run: (ctx: AuthContext) => Promise<T>,
): Promise<T> {
  const { currentSessionId, getPrincipal } = await import("@flareling/auth");
  const { authContext } = await import("./context.server.ts");
  const ctx = authContext();
  const [previous, previousSessionId] = await Promise.all([
    getPrincipal(ctx),
    currentSessionId(ctx),
  ]);
  const result = await run(ctx);
  if (result.ok && previous && previousSessionId) {
    const { disconnectSession } = await import("../realtime/rooms.server.ts");
    await disconnectSession(previous.userId, previousSessionId);
  }
  return result;
}

export const consumeMagicLinkFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(16).max(128) }))
  .handler(async ({ data }) => {
    const { consumeMagicLink } = await import("@flareling/auth");
    return signingIn((ctx) => consumeMagicLink(ctx, data.token));
  });

export const signOutFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const { currentSessionId, getPrincipal, signOut } = await import(
      "@flareling/auth"
    );
    const { authContext } = await import("./context.server.ts");
    const ctx = authContext();
    const [principal, sessionId] = await Promise.all([
      getPrincipal(ctx),
      currentSessionId(ctx),
    ]);
    await signOut(ctx);
    // Realtime sockets this session opened outlive it otherwise (up to their
    // maximum age); close them in every workspace it could have open.
    if (principal && sessionId) {
      const { disconnectSession } = await import("../realtime/rooms.server.ts");
      await disconnectSession(principal.userId, sessionId);
    }
    return { ok: true as const };
  },
);

// ── Passkeys ────────────────────────────────────────────────────────────────
// The WebAuthn response is opaque JSON from the browser; @simplewebauthn
// validates its structure and signature, so zod only bounds its size.
const webauthnResponse = z
  .unknown()
  .refine((v) => JSON.stringify(v ?? null).length < 64_000, "too large");

async function signedIn() {
  const { getPrincipal } = await import("@flareling/auth");
  const { authContext } = await import("./context.server.ts");
  const ctx = authContext();
  return { ctx, principal: await getPrincipal(ctx) };
}

export const beginPasskeyRegistrationFn = createServerFn({
  method: "POST",
}).handler(async () => {
  const { beginPasskeyRegistration } = await import("@flareling/auth");
  const { ctx, principal } = await signedIn();
  if (!principal) return { ok: false as const, reason: "unauthorized" };
  const result = await beginPasskeyRegistration(ctx, principal);
  // WebAuthn options are JSON by design; sent as a string, they pass
  // Start's serializer as-is and the browser hands them straight back to
  // @simplewebauthn/browser.
  return result.ok
    ? { ok: true as const, optionsJSON: JSON.stringify(result.options) }
    : { ok: false as const, reason: result.reason };
});

export const finishPasskeyRegistrationFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      response: webauthnResponse,
      nickname: z.string().max(60).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { finishPasskeyRegistration } = await import("@flareling/auth");
    const { ctx, principal } = await signedIn();
    if (!principal)
      return { ok: false as const, reason: "unauthorized" as const };
    return finishPasskeyRegistration(ctx, principal, data);
  });

export const beginPasskeySignInFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const { beginPasskeyAuthentication } = await import("@flareling/auth");
    const { authContext } = await import("./context.server.ts");
    const result = await beginPasskeyAuthentication(authContext());
    return result.ok
      ? { ok: true as const, optionsJSON: JSON.stringify(result.options) }
      : { ok: false as const, reason: result.reason };
  },
);

export const finishPasskeySignInFn = createServerFn({ method: "POST" })
  .validator(z.object({ response: webauthnResponse }))
  .handler(async ({ data }) => {
    const { finishPasskeyAuthentication } = await import("@flareling/auth");
    return signingIn((ctx) => finishPasskeyAuthentication(ctx, data));
  });

export const listPasskeysFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const { listPasskeys } = await import("@flareling/auth");
    const { principal } = await signedIn();
    if (!principal) return [];
    return listPasskeys(principal.userId);
  },
);

export const removePasskeyFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().max(64) }))
  .handler(async ({ data }) => {
    const { removePasskey } = await import("@flareling/auth");
    const { principal } = await signedIn();
    if (!principal) return { ok: false as const };
    return { ok: await removePasskey(principal.userId, data.id) };
  });

// ── Workspaces ──────────────────────────────────────────────────────────────

/** The signed-in account's workspaces, creating its personal one on first use. */
export const listWorkspacesFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const { ensurePersonalWorkspace, listWorkspaces } = await import(
      "@flareling/core"
    );
    const { nowOf } = await import("@flareling/auth");
    const { ctx, principal } = await signedIn();
    if (!principal) return [];
    await ensurePersonalWorkspace(principal.userId, nowOf(ctx));
    return listWorkspaces(principal.userId);
  },
);
