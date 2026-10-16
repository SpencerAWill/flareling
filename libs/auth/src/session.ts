/**
 * Sessions: a random token in an HttpOnly cookie, and a `sessions` row that
 * stores only its hash. No JWT and nothing signed: the token is the secret,
 * and revoking a session is deleting its row.
 *
 * Sessions slide: each use more than `sessionRefreshAfter` (1 hour) since the
 * last extension pushes the expiry out to `sessionTtl` (30 days) from now, and
 * re-sends the cookie with a fresh Max-Age. ucmc extended the row but not the
 * cookie, so active users were still signed out 30 days after signing in.
 */
import { getDb, schema } from "@flareling/db";
import { and, eq, ne } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import {
  type AuthContext,
  cookieName,
  DEFAULTS,
  isSecure,
  nowOf,
} from "./context.ts";
import { hashToken, randomToken } from "./tokens.ts";

const { sessions, users } = schema;
const SESSION_COOKIE = "session";

export interface Session {
  readonly sessionId: string;
  readonly userId: string;
  /** When this browser signed in. Rotation resets it; extending doesn't. */
  readonly createdAt: Date;
}

const toDate = (instant: Temporal.Instant) =>
  new Date(instant.epochMilliseconds);

function ttl(ctx: AuthContext): Temporal.Duration {
  return ctx.config.sessionTtl ?? DEFAULTS.sessionTtl;
}

function setSessionCookie(ctx: AuthContext, token: string): void {
  ctx.cookies.set(cookieName(ctx.config, SESSION_COOKIE), token, {
    httpOnly: true,
    secure: isSecure(ctx.config),
    // Lax, not Strict: following a link to the app from elsewhere (an email,
    // another site) should arrive signed in.
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ttl(ctx).total("seconds")),
  });
}

function clearSessionCookie(ctx: AuthContext): void {
  ctx.cookies.delete(cookieName(ctx.config, SESSION_COOKIE), {
    path: "/",
    secure: isSecure(ctx.config),
  });
}

function currentToken(ctx: AuthContext): string | undefined {
  return ctx.cookies.get(cookieName(ctx.config, SESSION_COOKIE));
}

/** Starts a session for `userId` and sets its cookie. */
async function openSession(ctx: AuthContext, userId: string): Promise<string> {
  const token = randomToken();
  const now = nowOf(ctx);
  const [row] = await getDb()
    .insert(sessions)
    .values({
      tokenHash: await hashToken(token),
      userId,
      // From the same clock as the expiry, not the database default, so the
      // recent-sign-in check compares like with like.
      createdAt: toDate(now),
      lastSeenAt: toDate(now),
      expiresAt: toDate(now.add(ttl(ctx))),
    })
    .returning({ id: sessions.id });
  setSessionCookie(ctx, token);
  return row?.id ?? "";
}

/**
 * Replaces this browser's session with a new one for `userId`, deleting the
 * old row. Call it at every privilege change (sign-in, adding a passkey), so a
 * session id planted before the change is worth nothing after it.
 */
export async function rotateSession(
  ctx: AuthContext,
  userId: string,
): Promise<string> {
  const previous = currentToken(ctx);
  const sessionId = await openSession(ctx, userId);
  if (previous) {
    await getDb()
      .delete(sessions)
      .where(eq(sessions.tokenHash, await hashToken(previous)));
  }
  return sessionId;
}

/**
 * This browser's session, or null. Expired sessions, sessions of disabled
 * accounts and unknown tokens are deleted along with the cookie. A live
 * session is extended (and its cookie re-sent) when due.
 */
export async function loadSession(ctx: AuthContext): Promise<Session | null> {
  const token = currentToken(ctx);
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const now = nowOf(ctx);
  const [row] = await getDb()
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash));

  // An unknown token (a stale or made-up cookie) costs no write: only a real
  // row that's expired, or belongs to a disabled account, is deleted.
  if (!row) {
    clearSessionCookie(ctx);
    return null;
  }
  if (
    row.expiresAt.getTime() <= now.epochMilliseconds ||
    row.disabledAt !== null
  ) {
    await getDb().delete(sessions).where(eq(sessions.id, row.sessionId));
    clearSessionCookie(ctx);
    return null;
  }

  const refreshAfter =
    ctx.config.sessionRefreshAfter ?? DEFAULTS.sessionRefreshAfter;
  if (
    now.epochMilliseconds - row.lastSeenAt.getTime() >
    refreshAfter.total("milliseconds")
  ) {
    await getDb()
      .update(sessions)
      .set({ lastSeenAt: toDate(now), expiresAt: toDate(now.add(ttl(ctx))) })
      .where(eq(sessions.id, row.sessionId));
    setSessionCookie(ctx, token);
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    createdAt: row.createdAt,
  };
}

/** Signs this browser out: deletes its session row and cookie. */
export async function closeSession(ctx: AuthContext): Promise<void> {
  const token = currentToken(ctx);
  if (token) {
    await getDb()
      .delete(sessions)
      .where(eq(sessions.tokenHash, await hashToken(token)));
  }
  clearSessionCookie(ctx);
}

/**
 * Deletes every session of `userId`, except `exceptSessionId` if given ("sign
 * out everywhere else"). Call it when an account is disabled or its primary
 * email changes. Returns how many were deleted.
 */
export async function revokeUserSessions(
  userId: string,
  options: { readonly exceptSessionId?: string } = {},
): Promise<number> {
  const deleted = await getDb()
    .delete(sessions)
    .where(
      options.exceptSessionId === undefined
        ? eq(sessions.userId, userId)
        : and(
            eq(sessions.userId, userId),
            ne(sessions.id, options.exceptSessionId),
          ),
    )
    .returning({ id: sessions.id });
  return deleted.length;
}
