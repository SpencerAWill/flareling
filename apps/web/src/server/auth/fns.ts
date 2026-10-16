/**
 * Server functions for sign-in. Thin shells: validate input with zod, then
 * call libs/auth through a dynamic import, which keeps the server-only code
 * (D1, bindings, cookies) out of the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
    z.object({
      email: z.email().max(254),
      redirect: z.string().max(2048).optional(),
      turnstileToken: z.string().max(4096).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { requestMagicLink } = await import("@flareling/auth");
    const { authContext } = await import("./context.server.ts");
    return requestMagicLink(authContext(), data);
  });

export const consumeMagicLinkFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(16).max(128) }))
  .handler(async ({ data }) => {
    const { consumeMagicLink } = await import("@flareling/auth");
    const { authContext } = await import("./context.server.ts");
    return consumeMagicLink(authContext(), data.token);
  });

export const signOutFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const { signOut } = await import("@flareling/auth");
    const { authContext } = await import("./context.server.ts");
    await signOut(authContext());
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
    const { authContext } = await import("./context.server.ts");
    return finishPasskeyAuthentication(authContext(), data);
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
    const { principal } = await signedIn();
    if (!principal) return [];
    await ensurePersonalWorkspace(principal.userId);
    return listWorkspaces(principal.userId);
  },
);
