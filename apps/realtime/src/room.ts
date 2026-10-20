/**
 * One room per workspace: the WebSockets of everyone who has the workspace
 * open, and what's pushed to them.
 *
 * Built on the WebSocket Hibernation API, so a room with only idle sockets
 * is evicted from memory and bills no duration; sockets stay connected, and
 * each one's identity survives in its attachment. Pings are answered by the
 * runtime (`setWebSocketAutoResponse`) without waking the room.
 *
 * The room trusts the identity headers on an upgrade, because only apps/web
 * can reach it (a Durable Object binding) and web sets them after checking
 * the session and membership. It holds no data: presence is computed from
 * the open sockets, and events carry no content (see libs/contracts).
 */

import { DurableObject } from "cloudflare:workers";
import {
  CLOSE,
  CONNECTION_HEADERS,
  connectionIdentity,
  PING,
  PONG,
  type RoomEvent,
  reasonForCode,
  type ServerMessage,
  type WorkspaceRoomApi,
} from "@flareling/contracts";
import { z } from "zod";

/**
 * How long a socket may stay open. The session and membership are checked
 * only when it opens, so this bounds how long a change that wasn't pushed
 * (a session that simply expired) goes unnoticed. The client reconnects.
 */
export const MAX_AGE_MS = 60 * 60 * 1000;

/** What each socket carries through hibernation: who, and since when. */
const attachmentSchema = connectionIdentity.extend({
  connectedAt: z.number(),
});
type Attachment = z.infer<typeof attachmentSchema>;

const userTag = (userId: string) => `user:${userId}`;
const sessionTag = (sessionId: string) => `session:${sessionId}`;

export class WorkspaceRoom
  extends DurableObject<Env>
  implements WorkspaceRoomApi
{
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  /** Accepts an upgrade forwarded by apps/web. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const identity = connectionIdentity.safeParse({
      userId: request.headers.get(CONNECTION_HEADERS.userId),
      sessionId: request.headers.get(CONNECTION_HEADERS.sessionId),
    });
    if (!identity.success) {
      return new Response("Missing connection identity", { status: 400 });
    }
    const { userId, sessionId } = identity.data;

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [userTag(userId), sessionTag(sessionId)]);
    server.serializeAttachment({
      userId,
      sessionId,
      connectedAt: Date.now(),
    } satisfies Attachment);
    await this.scheduleExpiry();
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  publish(event: RoomEvent): void {
    this.broadcast(event);
  }

  closeUser(userId: string, code: number): number {
    return this.disconnect(this.ctx.getWebSockets(userTag(userId)), code);
  }

  closeSession(sessionId: string): number {
    return this.disconnect(
      this.ctx.getWebSockets(sessionTag(sessionId)),
      CLOSE.signedOut,
    );
  }

  /** Clients send only pings, which never reach here. Anything else ends it. */
  override webSocketMessage(ws: WebSocket): void {
    this.closeAll([ws], 1008, "Unexpected message");
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Completes the closing handshake (a no-op if the runtime already has).
    try {
      ws.close(code, reason);
    } catch {}
    this.broadcastPresence(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.broadcastPresence(ws);
  }

  /** Closes sockets past MAX_AGE_MS, then waits for the next one. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    const expired = this.ctx
      .getWebSockets()
      .filter((ws) => attachment(ws).connectedAt + MAX_AGE_MS <= now);
    this.disconnect(expired, CLOSE.expired);
    await this.scheduleExpiry();
  }

  /**
   * Closes `sockets` with one of CLOSE's codes, first telling each why in a
   * `disconnect` message, which arrives even where the close code doesn't.
   */
  private disconnect(sockets: readonly WebSocket[], code: number): number {
    const reason = reasonForCode(code);
    if (reason) {
      const text = JSON.stringify({
        type: "disconnect",
        reason,
      } satisfies ServerMessage);
      for (const ws of sockets) {
        try {
          ws.send(text);
        } catch {}
      }
    }
    return this.closeAll(sockets, code);
  }

  private closeAll(
    sockets: readonly WebSocket[],
    code: number,
    reason = "",
  ): number {
    const open = sockets.filter((ws) => ws.readyState === WebSocket.OPEN);
    for (const ws of open) ws.close(code, reason);
    if (open.length > 0) this.broadcastPresence();
    return open.length;
  }

  /** The alarm for the oldest open socket's expiry, or none. */
  private async scheduleExpiry(): Promise<void> {
    const oldest = Math.min(
      ...this.openSockets().map((ws) => attachment(ws).connectedAt),
    );
    if (Number.isFinite(oldest)) {
      await this.ctx.storage.setAlarm(oldest + MAX_AGE_MS);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private openSockets(except?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== except && ws.readyState === WebSocket.OPEN);
  }

  /** Who's here, once per person however many tabs they have open. */
  private broadcastPresence(except?: WebSocket): void {
    const online = [
      ...new Set(
        this.openSockets(except)
          .map((ws) => attachment(ws).userId)
          .filter(Boolean),
      ),
    ].sort();
    this.broadcast({ type: "presence", online }, except);
  }

  private broadcast(message: ServerMessage, except?: WebSocket): void {
    const text = JSON.stringify(message);
    for (const ws of this.openSockets(except)) {
      try {
        ws.send(text);
      } catch {
        // Closed between the check and the send; its close handler updates
        // everyone else.
      }
    }
  }
}

/**
 * The socket's attachment, parsed: a socket accepted by a different version
 * of this code could carry another shape. One that doesn't parse counts as
 * nobody (left out of presence) and as expired, so the next alarm closes
 * it, rather than breaking presence for everyone.
 */
function attachment(ws: WebSocket): Attachment {
  const parsed = attachmentSchema.safeParse(ws.deserializeAttachment());
  return parsed.success
    ? parsed.data
    : { userId: "", sessionId: "", connectedAt: 0 };
}
