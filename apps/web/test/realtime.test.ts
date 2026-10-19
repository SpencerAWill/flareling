import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { signedIn, workspaceWith } from "./session.ts";

// The upgrade route's checks, through Start's real fetch handler. The room is
// test/worker.ts's stand-in, which echoes the identity web forwarded.

const ORIGIN = "http://localhost:3000"; // wrangler.jsonc's APP_BASE_URL

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

function connect(
  workspaceId: string,
  headers: Record<string, string | undefined>,
) {
  return exports.default.fetch(
    `https://example.com/api/realtime/${workspaceId}`,
    {
      headers: Object.fromEntries(
        Object.entries({
          Upgrade: "websocket",
          Origin: ORIGIN,
          ...headers,
        }).filter((e): e is [string, string] => e[1] !== undefined),
      ),
    },
  );
}

describe("/api/realtime/$workspaceId", () => {
  it("hands a member's upgrade to the room with their identity", async () => {
    const { userId, sessionId, cookie } = await signedIn();
    const { id: workspaceId } = await workspaceWith(userId);

    const res = await connect(workspaceId, {
      Cookie: cookie,
      // A browser can't choose who it is.
      "X-Realtime-User-Id": "someone-else",
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (!ws) throw new Error("no socket");
    const identity = new Promise((resolve) =>
      ws.addEventListener("message", (e) =>
        resolve(JSON.parse(String(e.data))),
      ),
    );
    ws.accept();
    expect(await identity).toEqual({ userId, sessionId });
    ws.close(1000);
  });

  it("refuses another site's page (cross-site WebSocket hijacking)", async () => {
    const { userId, cookie } = await signedIn();
    const { id: workspaceId } = await workspaceWith(userId);
    for (const origin of ["https://evil.example", undefined]) {
      const res = await connect(workspaceId, {
        Cookie: cookie,
        Origin: origin,
      });
      expect(res.status, String(origin)).toBe(403);
    }
  });

  it("refuses the signed out, and treats non-members like a missing workspace", async () => {
    const { userId } = await signedIn();
    const { id: workspaceId } = await workspaceWith(userId);
    expect((await connect(workspaceId, {})).status).toBe(401);

    const outsider = await signedIn();
    expect(
      (await connect(workspaceId, { Cookie: outsider.cookie })).status,
    ).toBe(404);
    expect(
      (await connect("not-a-uuid", { Cookie: outsider.cookie })).status,
    ).toBe(404);
  });

  it("wants an upgrade", async () => {
    const { userId, cookie } = await signedIn();
    const { id: workspaceId } = await workspaceWith(userId);
    const res = await connect(workspaceId, {
      Cookie: cookie,
      Upgrade: undefined,
    });
    expect(res.status).toBe(426);
  });
});
