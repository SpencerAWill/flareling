import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  CLOSE,
  CONNECTION_HEADERS,
  type ServerMessage,
} from "@flareling/contracts";
import { describe, expect, it } from "vitest";
import { MAX_AGE_MS } from "./room.ts";

let rooms = 0;
/** A fresh room per test, so presence from one doesn't leak into another. */
const freshRoom = () => env.WORKSPACE_ROOM.getByName(`room-${++rooms}`);

type Room = ReturnType<typeof freshRoom>;

/** A client socket, collecting what the room sends it. */
async function connect(room: Room, userId: string, sessionId = `s-${userId}`) {
  const res = await room.fetch("https://room/", {
    headers: {
      Upgrade: "websocket",
      [CONNECTION_HEADERS.userId]: userId,
      [CONNECTION_HEADERS.sessionId]: sessionId,
    },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error("no socket");
  const messages: (ServerMessage | string)[] = [];
  let closed: { code: number } | null = null;
  const waiters: (() => void)[] = [];
  const notify = () => {
    for (const w of waiters.splice(0)) w();
  };
  ws.addEventListener("message", (event) => {
    const data = String(event.data);
    messages.push(data.startsWith("{") ? JSON.parse(data) : data);
    notify();
  });
  ws.addEventListener("close", (event) => {
    closed = { code: event.code };
    notify();
  });
  ws.accept();

  /** Waits until `check` passes on what's arrived so far. */
  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 2_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  };
  return {
    ws,
    messages,
    closed: () => closed,
    until,
    /** Waits for presence to list exactly `online`. */
    presence: (online: string[]) =>
      until(() => {
        const last = messages.findLast(
          (m): m is Extract<ServerMessage, { type: "presence" }> =>
            typeof m === "object" && m.type === "presence",
        );
        return JSON.stringify(last?.online) === JSON.stringify(online);
      }),
    closedWith: async (code: number) => {
      await until(() => closed !== null);
      expect(closed).toEqual({ code });
    },
  };
}

describe("WorkspaceRoom", () => {
  it("refuses anything but an upgrade carrying an identity", async () => {
    const room = freshRoom();
    expect((await room.fetch("https://room/")).status).toBe(426);
    expect(
      (await room.fetch("https://room/", { headers: { Upgrade: "websocket" } }))
        .status,
    ).toBe(400);
  });

  it("tells everyone who's here, once per person however many tabs", async () => {
    const room = freshRoom();
    const a = await connect(room, "a");
    await a.presence(["a"]);
    const b = await connect(room, "b");
    await a.presence(["a", "b"]);
    await b.presence(["a", "b"]);

    const aSecondTab = await connect(room, "a");
    await aSecondTab.presence(["a", "b"]);
    aSecondTab.ws.close(1000);
    // A still has a tab open.
    await b.until(() => b.messages.length >= 3);
    await b.presence(["a", "b"]);

    a.ws.close(1000);
    await b.presence(["b"]);
  });

  it("publishes an event to every socket", async () => {
    const room = freshRoom();
    const a = await connect(room, "a");
    const b = await connect(room, "b");
    await room.publish({ type: "members_changed" });
    for (const client of [a, b]) {
      await client.until(() =>
        client.messages.some(
          (m) => typeof m === "object" && m.type === "members_changed",
        ),
      );
    }
  });

  it("closes a removed user's sockets, every tab, and updates presence", async () => {
    const room = freshRoom();
    const a1 = await connect(room, "a");
    const a2 = await connect(room, "a");
    const b = await connect(room, "b");
    await b.presence(["a", "b"]);

    expect(await room.closeUser("a", CLOSE.removed)).toBe(2);
    await a1.until(() =>
      a1.messages.some(
        (m) =>
          typeof m === "object" &&
          m.type === "disconnect" &&
          m.reason === "removed",
      ),
    );
    await a1.closedWith(CLOSE.removed);
    await a2.closedWith(CLOSE.removed);
    await b.presence(["b"]);
    expect(await room.closeUser("a", CLOSE.removed)).toBe(0);
  });

  it("closes only the signed-out session's sockets", async () => {
    const room = freshRoom();
    const phone = await connect(room, "a", "phone");
    const laptop = await connect(room, "a", "laptop");

    expect(await room.closeSession("phone")).toBe(1);
    await phone.closedWith(CLOSE.signedOut);
    await laptop.presence(["a"]);
    expect(laptop.closed()).toBeNull();
  });

  it("answers pings without the room, and closes on anything else", async () => {
    const room = freshRoom();
    const a = await connect(room, "a");
    a.ws.send("ping");
    await a.until(() => a.messages.includes("pong"));

    a.ws.send(JSON.stringify({ type: "presence", online: ["forged"] }));
    await a.closedWith(1008);
  });

  it("closes sockets once they reach the maximum age, and keeps the rest", async () => {
    const room = freshRoom();
    const old = await connect(room, "old");
    const young = await connect(room, "young");
    await young.presence(["old", "young"]);

    await runInDurableObject(room, (_, state) => {
      for (const ws of state.getWebSockets("user:old")) {
        const a = ws.deserializeAttachment() as { connectedAt: number };
        ws.serializeAttachment({
          ...a,
          connectedAt: Date.now() - MAX_AGE_MS - 1,
        });
      }
    });
    expect(await runDurableObjectAlarm(room)).toBe(true);

    await old.closedWith(CLOSE.expired);
    await young.presence(["young"]);
    // The next alarm is for the young socket's expiry.
    const next = await runInDurableObject(room, (_, state) =>
      state.storage.getAlarm(),
    );
    expect(next).toBeGreaterThan(Date.now() + MAX_AGE_MS - 60_000);
  });
});
