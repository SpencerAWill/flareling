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
