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
  try {
    await router.invalidate();
    await router.navigate({ to });
  } catch {
    // Superseded by another navigation.
  }
}
