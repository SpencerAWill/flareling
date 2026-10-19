/**
 * apps/realtime's WorkspaceRooms, as this app uses them: forwarding an
 * upgrade, and pushing events and closes from server functions.
 *
 * Pushes are best effort. A room that can't be reached (realtime mid-deploy,
 * say) must never fail the change that triggered the push, so failures are
 * logged and swallowed. Clients reconnect within the socket's maximum age
 * regardless.
 */
import { env } from "cloudflare:workers";
import {
  CONNECTION_HEADERS,
  type WorkspaceRoomApi,
} from "@flareling/contracts";

type RoomNamespace = DurableObjectNamespace<
  WorkspaceRoomApi & Rpc.DurableObjectBranded
>;

/** The room for `workspaceId`, created on first use. */
function room(workspaceId: string) {
  return (env.WORKSPACE_ROOM as RoomNamespace).getByName(workspaceId);
}

/**
 * Hands an already-authorized upgrade to the workspace's room, with the
 * identity it was authorized as. Any identity headers the browser sent are
 * overwritten.
 */
export function forwardUpgrade(
  request: Request,
  workspaceId: string,
  identity: { readonly userId: string; readonly sessionId: string },
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set(CONNECTION_HEADERS.userId, identity.userId);
  headers.set(CONNECTION_HEADERS.sessionId, identity.sessionId);
  return room(workspaceId).fetch(new Request(request, { headers }));
}
