/**
 * The browser-safe part of libs/auth: pure helpers with no database, binding
 * or cookie access, for client code (`@flareling/auth/client`). Never import
 * the main entry from client code; it pulls in D1 and cloudflare:workers.
 * Add `hasPermission` here when the first UI hides something by permission.
 */
export { isSafeRedirect } from "./input.ts";
export type { Principal } from "./rbac.ts";
