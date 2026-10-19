/**
 * apps/realtime: the WorkspaceRoom Durable Object, and nothing else. The
 * fetch handler exists because a Worker needs one; nothing routes here.
 */
export { WorkspaceRoom } from "./room.ts";

export default {
  fetch: () => new Response("Not found", { status: 404 }),
} satisfies ExportedHandler<Env>;
