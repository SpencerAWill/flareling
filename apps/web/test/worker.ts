// Test-only stand-in for wrangler.jsonc's `main`. See vitest.config.ts.
import { DurableObject } from "cloudflare:workers";

export { default } from "@tanstack/react-start/server-entry";

/**
 * Stands in for apps/realtime's WorkspaceRoom, which lives in another Worker
 * (and apps can't import each other). It accepts an upgrade and sends back
 * the identity headers web forwarded, and records what web pushes, so these
 * tests check web's side of the contract; apps/realtime tests the room.
 */
export class TestWorkspaceRoom extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    server.send(
      JSON.stringify({
        userId: request.headers.get("X-Realtime-User-Id"),
        sessionId: request.headers.get("X-Realtime-Session-Id"),
      }),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  async publish(event: unknown) {
    await this.record({ publish: event });
  }

  async closeUser(userId: string, code: number) {
    await this.record({ closeUser: userId, code });
    return 0;
  }

  async closeSession(sessionId: string) {
    await this.record({ closeSession: sessionId });
    return 0;
  }

  /** What web pushed to this room, oldest first. */
  async pushes(): Promise<unknown[]> {
    return (await this.ctx.storage.get<unknown[]>("pushes")) ?? [];
  }

  private async record(push: unknown) {
    await this.ctx.storage.put("pushes", [...(await this.pushes()), push]);
  }
}
