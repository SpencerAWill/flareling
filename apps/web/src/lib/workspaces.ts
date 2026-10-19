import type { WorkspaceRole } from "@flareling/core/client";

/** How roles read in the UI. */
export const ROLE_NAMES: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/**
 * The current workspace's name, from the /w/$workspaceId layout's loader, for
 * a page's title. Head functions see every match's loader data, not just
 * their own route's.
 */
export function workspaceTitle(
  matches: readonly { routeId: string; loaderData?: unknown }[],
): string {
  const layout = matches.find((m) => m.routeId === "/w/$workspaceId");
  const data = layout?.loaderData as
    | { workspace?: { name: string } }
    | undefined;
  return data?.workspace?.name ?? "Workspace";
}
