/**
 * Workspace roles and who may manage whom: pure, so the members page can
 * hide the controls libs/core would refuse (`@flareling/core/client`).
 */
export type WorkspaceRole = "owner" | "admin" | "member";

/**
 * Whether `actor` may change `target`'s membership (role or removal), or
 * give them `newRole`. Admins manage admins and members; only owners touch
 * owners or make new ones.
 */
export function mayManage(
  actor: WorkspaceRole,
  target: WorkspaceRole,
  newRole?: WorkspaceRole,
): boolean {
  if (actor === "owner") return true;
  return actor === "admin" && target !== "owner" && newRole !== "owner";
}
