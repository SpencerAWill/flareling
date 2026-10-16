import { getDb, schema } from "@flareling/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nextRequest, testContext } from "../test/context.ts";
import { createUser } from "../test/users.ts";
import { getPrincipal, revokeUserSessions, signIn, signOut } from "./index.ts";
import { loadSession } from "./session.ts";
import { hashToken } from "./tokens.ts";

const { sessions, users } = schema;

async function sessionRows(userId: string) {
  return getDb().select().from(sessions).where(eq(sessions.userId, userId));
}

describe("signing in", () => {
  it("sets an HttpOnly, Lax session cookie and stores only the token's hash", async () => {
    const userId = await createUser("cookie@example.com");
    const ctx = testContext();
    await signIn(ctx, userId);

    const token = ctx.cookies.get("session") ?? "";
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ctx.cookies.lastSet.get("session")).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    const [row] = await sessionRows(userId);
    expect(row?.tokenHash).toBe(await hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("uses a Secure __Host- cookie over https", async () => {
    const userId = await createUser("secure@example.com");
    const ctx = testContext({
      config: { appBaseUrl: "https://app.example.com" },
    });
    await signIn(ctx, userId);
    expect(ctx.cookies.get("__Host-session")).toBeDefined();
    expect(ctx.cookies.lastSet.get("__Host-session")?.secure).toBe(true);
  });

  it("rotates out the browser's previous session", async () => {
    const first = await createUser("first@example.com");
    const second = await createUser("second@example.com");
    const ctx = testContext();
    await signIn(ctx, first);
    await signIn(nextRequest(ctx), second);

    expect(await sessionRows(first)).toEqual([]);
    expect(await sessionRows(second)).toHaveLength(1);
  });
});

describe("loading a session", () => {
  it("finds the signed-in account on the next request", async () => {
    const userId = await createUser("load@example.com");
    const ctx = testContext();
    await signIn(ctx, userId);
    expect(await loadSession(nextRequest(ctx))).toMatchObject({ userId });
  });

  it("clears an unknown token's cookie without writing to the database", async () => {
    const ctx = testContext();
    ctx.cookies.values.set("session", "not-a-real-token");
    // A junk cookie must not turn every request into a D1 write.
    const before = (await getDb().select().from(sessions)).length;
    expect(await loadSession(ctx)).toBeNull();
    expect((await getDb().select().from(sessions)).length).toBe(before);
    expect(ctx.cookies.deleted).toContain("session");
  });

  it("is null, and clears the cookie, for an unknown token", async () => {
    const ctx = testContext();
    ctx.cookies.values.set("session", "not-a-real-token");
    expect(await loadSession(ctx)).toBeNull();
    expect(ctx.cookies.deleted).toContain("session");
  });

  it("is null after 30 days without use, and deletes the expired row", async () => {
    const userId = await createUser("expired@example.com");
    const ctx = testContext();
    await signIn(ctx, userId);
    const later = nextRequest(ctx);
    later.advance({ hours: 24 * 30 + 1 });

    expect(await loadSession(later)).toBeNull();
    expect(await sessionRows(userId)).toEqual([]);
  });

  it("extends an active session, and re-sends the cookie with a fresh lifetime", async () => {
    const userId = await createUser("slide@example.com");
    const ctx = testContext();
    await signIn(ctx, userId);

    // Within the hour: nothing to do.
    const soon = nextRequest(ctx);
    soon.advance({ minutes: 30 });
    soon.cookies.lastSet.clear();
    await loadSession(soon);
    expect(soon.cookies.lastSet.size).toBe(0);

    // 29 days on: extended, and the browser told so (ucmc only updated the row).
    const later = nextRequest(soon);
    later.advance({ hours: 24 * 29 });
    expect(await loadSession(later)).toMatchObject({ userId });
    expect(later.cookies.lastSet.get("session")?.maxAge).toBe(
      30 * 24 * 60 * 60,
    );

    // So it survives past the original 30 days.
    const pastOriginal = nextRequest(later);
    pastOriginal.advance({ hours: 24 * 2 });
    expect(await loadSession(pastOriginal)).toMatchObject({ userId });
  });

  it("ends the sessions of a disabled account", async () => {
    const userId = await createUser("disabled@example.com");
    const ctx = testContext();
    await signIn(ctx, userId);
    await getDb()
      .update(users)
      .set({ disabledAt: new Date() })
      .where(eq(users.id, userId));

    expect(await loadSession(nextRequest(ctx))).toBeNull();
    expect(await sessionRows(userId)).toEqual([]);
  });
});

describe("signing out", () => {
  it("deletes the session and its cookie", async () => {
    const userId = await createUser("signout@example.com");
    const ctx = testContext();
    await signIn(ctx, userId);
    const out = nextRequest(ctx);
    expect(await getPrincipal(out)).not.toBeNull();

    await signOut(out);

    expect(await sessionRows(userId)).toEqual([]);
    expect(out.cookies.get("session")).toBeUndefined();
    expect(await getPrincipal(out)).toBeNull();
  });

  it("can revoke every other session of an account", async () => {
    const userId = await createUser("revoke@example.com");
    const laptop = testContext();
    const phone = testContext();
    await signIn(laptop, userId);
    await signIn(phone, userId);
    const current = await loadSession(nextRequest(laptop));

    const revoked = await revokeUserSessions(userId, {
      exceptSessionId: current?.sessionId ?? "",
    });

    expect(revoked).toBe(1);
    expect(await loadSession(nextRequest(laptop))).not.toBeNull();
    expect(await loadSession(nextRequest(phone))).toBeNull();
  });
});
