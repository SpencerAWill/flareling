import { env } from "cloudflare:workers";
import { hashToken, randomToken } from "@flareling/auth";

/**
 * Rows for tests that go through the app signed in: a user with a session,
 * and workspaces. Written with plain SQL against the test D1 (apps don't
 * depend on libs/db directly). The file applies the migrations first.
 */

/** A user with a session; returns its cookie. */
export async function signedIn() {
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

/** A team workspace with `userId` as a member; its internal and public ids. */
export async function workspaceWith(userId: string) {
  const id = crypto.randomUUID();
  const publicId = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO workspaces (id, public_id, name) VALUES (?, ?, 'Team')",
    ).bind(id, publicId),
    env.DB.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')",
    ).bind(id, userId),
  ]);
  return { id, publicId };
}
