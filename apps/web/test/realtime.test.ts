import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { hashToken, randomToken } from "@flareling/auth";
import { beforeAll, describe, expect, it } from "vitest";

// The upgrade route's checks, through Start's real fetch handler. The room is
// test/worker.ts's stand-in, which echoes the identity web forwarded.

const ORIGIN = "http://localhost:3000"; // wrangler.jsonc's APP_BASE_URL

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** A user with a session; returns its cookie. */
async function signedIn() {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const token = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id) VALUES (?)").bind(userId),
    env.DB.prepare(
      "INSERT INTO user_emails (id, user_id, email, is_primary, verified_at) VALUES (?, ?, ?, 1, ?)",
    ).bind(crypto.randomUUID(), userId, `${userId}@example.com`, now),
    env.DB.prepare(
      "INSERT INTO sessions (id, token_hash, user_id, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(sessionId, await hashToken(token), userId, now, now + 3_600_000),
  ]);
  return { userId, sessionId, cookie: `session=${token}` };
}

async function workspaceWith(userId: string) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO workspaces (id, name) VALUES (?, 'Team')").bind(
      id,
    ),
    env.DB.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')",
    ).bind(id, userId),
  ]);
  return id;
}

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
    const workspaceId = await workspaceWith(userId);

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
    const workspaceId = await workspaceWith(userId);
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
    const workspaceId = await workspaceWith(userId);
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
    const workspaceId = await workspaceWith(userId);
    const res = await connect(workspaceId, {
      Cookie: cookie,
      Upgrade: undefined,
    });
    expect(res.status).toBe(426);
  });
});
