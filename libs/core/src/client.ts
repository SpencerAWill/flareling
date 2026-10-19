/**
 * The browser-safe part of libs/core, for client code
 * (`@flareling/core/client`): constants and types, no database access. Never
 * import the main entry from client code; it pulls in D1.
 */
export { WORKSPACE_NAME_MAX } from "./limits.ts";
export { mayManage, type WorkspaceRole } from "./roles.ts";
