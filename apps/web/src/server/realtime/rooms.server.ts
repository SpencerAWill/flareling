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
  CLOSE,
  CONNECTION_HEADERS,
  type WorkspaceRoomApi,
} from "@flareling/contracts";
import { errorMessage, log } from "@flareling/log";

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

async function bestEffort(what: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    log.warn("realtime.push_failed", { what, error: errorMessage(err) });
  }
}

/** Tells the workspace's open tabs its membership changed. */
export function membersChanged(workspaceId: string): Promise<void> {
  return bestEffort("members_changed", () =>
    room(workspaceId).publish({ type: "members_changed" }),
  );
}

/** Closes `userId`'s sockets in a workspace they no longer belong to. */
export function disconnectMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  return bestEffort("close_user", () =>
    room(workspaceId).closeUser(userId, CLOSE.removed),
  );
}

/** Closes the sockets a session opened, in each of `workspaceIds`. */
export function disconnectSession(
  workspaceIds: readonly string[],
  sessionId: string,
): Promise<void> {
  return bestEffort("close_session", () =>
    Promise.all(workspaceIds.map((id) => room(id).closeSession(sessionId))),
  );
}
