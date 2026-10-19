/**
 * The realtime protocol between the browser, apps/web and apps/realtime's
 * WorkspaceRoom (docs/adr/0025-realtime-through-web.md). Pure types and zod,
 * so all three can import it, the browser included.
 *
 * Events say only that something changed, never what: a client refetches
 * through the app's server functions, which check permissions. A socket is
 * never a second read path.
 */
import { z } from "zod";

/** The one message a client sends. The room answers it without waking. */
export const PING = "ping";
export const PONG = "pong";

/**
 * Close codes the room uses (4000-4999 are the application's). A client
 * reconnects after `expired`, and stops after `removed` or `signedOut`.
 */
export const CLOSE = {
  /** The connection reached its maximum age; reconnect, which re-checks. */
  expired: 4000,
  /** The session that opened it ended (sign-out). */
  signedOut: 4401,
  /** The user is no longer a member of the workspace. */
  removed: 4403,
} as const;

/**
 * Headers apps/web sets when it forwards an upgrade to the room. Only web
 * can reach the room (a Durable Object binding), and it overwrites any
 * copies a browser sent, so the room trusts them.
 */
export const CONNECTION_HEADERS = {
  userId: "X-Realtime-User-Id",
  sessionId: "X-Realtime-Session-Id",
} as const;

export const serverMessage = z.discriminatedUnion("type", [
  /** Who has the workspace open: user ids, once each however many tabs. */
  z.object({ type: z.literal("presence"), online: z.array(z.string()) }),
  /** Membership changed (an invite, a role, someone joined or left). */
  z.object({ type: z.literal("members_changed") }),
]);

export type ServerMessage = z.infer<typeof serverMessage>;

/** What apps/web may publish to a room. */
export type RoomEvent = Extract<ServerMessage, { type: "members_changed" }>;

/** The RPC methods apps/web calls on a WorkspaceRoom stub. */
export interface WorkspaceRoomApi {
  /** Sends `event` to every open socket. */
  publish(event: RoomEvent): void;
  /** Closes every socket `userId` has open here; returns how many. */
  closeUser(userId: string, code: number): number;
  /** Closes every socket opened by `sessionId`; returns how many. */
  closeSession(sessionId: string): number;
}
