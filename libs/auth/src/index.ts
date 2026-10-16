export type { AuthContext } from "./context.ts";
export { isSafeRedirect, normalizeEmail } from "./input.ts";
export { consumeMagicLink, requestMagicLink } from "./magic-link.ts";
export {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listPasskeys,
  removePasskey,
} from "./passkeys.ts";
export { getPrincipal, loadPrincipal, signIn, signOut } from "./principal.ts";
export {
  ForbiddenError,
  hasAnyPermission,
  hasPermission,
  type Principal,
  requireAnyPermission,
  requirePermission,
  requirePrincipal,
  UnauthorizedError,
} from "./rbac.ts";
export { revokeUserSessions } from "./session.ts";
