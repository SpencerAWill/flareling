import type { Principal } from "@flareling/auth/client";
import { redirect } from "@tanstack/react-router";

/**
 * Route guard for `beforeLoad`: sends anonymous visitors to sign in, then
 * back here. Navigation UX only; the server functions a page calls check
 * the session themselves.
 */
export function requireSignedIn(
  principal: Principal | null,
  location: { readonly href: string },
): Principal {
  if (!principal) {
    throw redirect({ to: "/sign-in", search: { redirect: location.href } });
  }
  return principal;
}

/**
 * After signing in or out: reload route data for the new session, then go to
 * `to`. If the person navigates elsewhere before this finishes, the browser
 * aborts these requests, which is expected, not an error (WebKit otherwise
 * reports it as an uncaught "TypeError: Load failed").
 */
export async function afterSessionChange(
  router: {
    invalidate(): Promise<unknown>;
    navigate(opts: { to: string }): Promise<unknown>;
  },
  to: string,
): Promise<void> {
  cachedPrincipal = undefined;
  try {
    await router.invalidate();
    await router.navigate({ to });
  } catch {
    // Superseded by another navigation.
  }
}

const PRINCIPAL_STALE_MS = 60_000;
let cachedPrincipal: { principal: Principal | null; at: number } | undefined;

/**
 * The principal for route guards and UI. On the server it's loaded for each
 * request. In the browser, client-side navigations reuse it for a minute
 * instead of asking the Worker every time (each ask is a Worker request and
 * several D1 queries; see docs/platform-limits.md, R2), and
 * `afterSessionChange` drops it at once. A change made elsewhere (a role
 * granted, a session revoked) shows up in the UI within a minute; server
 * functions check the real session on every call regardless.
 */
export async function currentPrincipal(
  load: () => Promise<Principal | null>,
): Promise<Principal | null> {
  if (typeof window === "undefined") return load();
  if (cachedPrincipal && Date.now() - cachedPrincipal.at < PRINCIPAL_STALE_MS) {
    return cachedPrincipal.principal;
  }
  const principal = await load();
  cachedPrincipal = { principal, at: Date.now() };
  return principal;
}
