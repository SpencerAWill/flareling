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
