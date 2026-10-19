/**
 * GET /api/realtime/$workspaceId: the WebSocket door to a workspace's room.
 *
 * Every check happens here, once, before the room sees the connection:
 *
 *   - Origin must be this app's. Browsers send cookies on cross-site
 *     WebSocket upgrades and the CSRF middleware covers only server
 *     functions, so without this any site could open a socket as the
 *     visitor (cross-site WebSocket hijacking).
 *   - A signed-in session, and membership of the workspace. Non-members get
 *     the same 404 as a workspace that doesn't exist.
 *   - A per-user rate limit, so a reconnect loop can't hammer D1.
 *
 * The room then holds the socket for up to an hour; removal and sign-out
 * close it sooner (rooms.server.ts).
 */
import {
  currentSessionId,
  ForbiddenError,
  getPrincipal,
  withinRateLimit,
} from "@flareling/auth";
import { requireWorkspaceRole } from "@flareling/core";
import { z } from "zod";
import { getEnv } from "#/env.ts";
import { authContext } from "../auth/context.server.ts";
import { forwardUpgrade } from "./rooms.server.ts";

const refuse = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export async function connectRealtime(
  request: Request,
  workspaceId: string,
): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return refuse(426, "Expected a WebSocket upgrade");
  }
  if (request.headers.get("Origin") !== new URL(getEnv().APP_BASE_URL).origin) {
    return refuse(403, "Forbidden");
  }
  if (!z.uuid().safeParse(workspaceId).success) {
    return refuse(404, "Not found");
  }

  const ctx = authContext();
  const [principal, sessionId] = await Promise.all([
    getPrincipal(ctx),
    currentSessionId(ctx),
  ]);
  if (!principal || !sessionId) return refuse(401, "Unauthorized");
  if (!(await withinRateLimit(ctx, `realtime:${principal.userId}`))) {
    return refuse(429, "Too many connections");
  }
  try {
    await requireWorkspaceRole(principal, workspaceId, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return refuse(404, "Not found");
    throw err;
  }

  return forwardUpgrade(request, workspaceId, {
    userId: principal.userId,
    sessionId,
  });
}
