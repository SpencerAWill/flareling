/**
 * Sign-in by emailed link. Requesting one always answers `{ ok: true }` and
 * takes about the same time, whether or not the address has an account, the
 * request was rate limited, or Turnstile failed, so the endpoint can't be used
 * to find out who has an account.
 *
 * Consuming a link is atomic and single use, and creates the account on first
 * sign-in. The app's callback page must not consume on load: it shows a button
 * that POSTs the token, because corporate email scanners fetch every link in
 * a message and would otherwise use it up before the person clicks.
 */
import {
  getDb,
  isUniqueViolation,
  newId,
  recordAudit,
  schema,
} from "@flareling/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import { type AuthContext, DEFAULTS, nowOf } from "./context.ts";
import { ipKey, passesTurnstile, withinRateLimit } from "./guards.ts";
import { isSafeRedirect, normalizeEmail } from "./input.ts";
import { signIn } from "./principal.ts";
import { hashToken, randomToken } from "./tokens.ts";

const { magicLinks, roles, userEmails, userRoles, users } = schema;

/** The role every new account gets. */
const DEFAULT_ROLE = "member";

const toDate = (instant: Temporal.Instant) =>
  new Date(instant.epochMilliseconds);

export interface MagicLinkRequest {
  readonly email: string;
  /** Where to go after signing in; dropped unless it's a path on this origin. */
  readonly redirect?: string | undefined;
  readonly turnstileToken?: string | undefined;
}

/** Emails a sign-in link to `email`, if the request passes the checks. */
export async function requestMagicLink(
  ctx: AuthContext,
  request: MagicLinkRequest,
): Promise<{ ok: true }> {
  const started = Date.now();
  try {
    const email = normalizeEmail(request.email);
    if (
      !(await passesTurnstile(ctx, request.turnstileToken)) ||
      !(await withinRateLimit(ctx, ipKey(ctx))) ||
      !(await withinRateLimit(ctx, `email:${email}`))
    ) {
      return { ok: true };
    }

    const token = randomToken();
    const now = nowOf(ctx);
    await getDb()
      .insert(magicLinks)
      .values({
        tokenHash: await hashToken(token),
        email,
        intent: "sign_in",
        expiresAt: toDate(
          now.add(ctx.config.magicLinkTtl ?? DEFAULTS.magicLinkTtl),
        ),
      });

    const url = new URL("/auth/callback", ctx.config.appBaseUrl);
    url.searchParams.set("token", token);
    if (request.redirect && isSafeRedirect(request.redirect)) {
      url.searchParams.set("redirect", request.redirect);
    }
    const minutes = (ctx.config.magicLinkTtl ?? DEFAULTS.magicLinkTtl).total(
      "minutes",
    );
    // A send failure propagates. That reveals nothing, since it happens the
    // same way for addresses with and without accounts.
    await ctx.email.send({
      kind: "auth.magic_link",
      to: email,
      subject: `Your ${ctx.config.appName} sign-in link`,
      text: [
        `Use this link to sign in to ${ctx.config.appName}. It expires in ${minutes} minutes and works once.`,
        "",
        url.toString(),
        "",
        "If you didn't ask for it, you can ignore this email.",
      ].join("\n"),
    });
    return { ok: true };
  } finally {
    const padding = ctx.config.magicLinkResponsePadding ?? {
      minMs: 500,
      jitterMs: 300,
    };
    const target = padding.minMs + Math.random() * padding.jitterMs;
    const remaining = target - (Date.now() - started);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  }
}

export type ConsumeResult =
  | { readonly ok: true; readonly userId: string; readonly isNewUser: boolean }
  | { readonly ok: false; readonly reason: "invalid" | "rate_limited" };

/**
 * Signs in with the link's token: marks it used, finds or creates the account
 * for its address, and starts a session. Unknown, used, expired and
 * disabled-account links all answer `invalid`.
 */
export async function consumeMagicLink(
  ctx: AuthContext,
  token: string,
): Promise<ConsumeResult> {
  if (!(await withinRateLimit(ctx, ipKey(ctx)))) {
    return { ok: false, reason: "rate_limited" };
  }

  const now = toDate(nowOf(ctx));
  // One statement claims the link: a concurrent second use, or an expired
  // link, matches nothing. (ucmc stamped expired links as used before checking.)
  const [link] = await getDb()
    .update(magicLinks)
    .set({ consumedAt: now })
    .where(
      and(
        eq(magicLinks.tokenHash, await hashToken(token)),
        eq(magicLinks.intent, "sign_in"),
        isNull(magicLinks.consumedAt),
        gt(magicLinks.expiresAt, now),
      ),
    )
    .returning({ email: magicLinks.email });
  if (!link) return { ok: false, reason: "invalid" };

  let account = await findAccount(link.email);
  let isNewUser = false;
  if (!account) {
    ({ account, created: isNewUser } = await createAccount(link.email, now));
  }
  if (account.disabledAt !== null) return { ok: false, reason: "invalid" };

  await signIn(ctx, account.userId);
  await recordAudit({
    action: isNewUser ? "auth.account_created" : "auth.signed_in",
    actorId: account.userId,
    metadata: { method: "magic_link" },
  });
  return { ok: true, userId: account.userId, isNewUser };
}

interface Account {
  readonly userId: string;
  readonly disabledAt: Date | null;
}

async function findAccount(email: string): Promise<Account | undefined> {
  const [row] = await getDb()
    .select({ userId: users.id, disabledAt: users.disabledAt })
    .from(userEmails)
    .innerJoin(users, eq(users.id, userEmails.userId))
    .where(eq(userEmails.email, email));
  return row;
}

/**
 * Creates an account for a verified address, with the default role. If a
 * concurrent sign-in created it first, the UNIQUE(email) constraint (the real
 * race boundary) fails this batch, and the existing account is used instead.
 */
async function createAccount(
  email: string,
  verifiedAt: Date,
): Promise<{ account: Account; created: boolean }> {
  const db = getDb();
  const userId = newId();
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, DEFAULT_ROLE));
  try {
    await db.batch([
      db.insert(users).values({ id: userId }),
      db
        .insert(userEmails)
        .values({ userId, email, isPrimary: true, verifiedAt }),
      ...(role
        ? [db.insert(userRoles).values({ userId, roleId: role.id })]
        : []),
    ]);
    return { account: { userId, disabledAt: null }, created: true };
  } catch (err) {
    if (!isUniqueViolation(err, "user_emails.email")) throw err;
    const existing = await findAccount(email);
    if (!existing) throw err;
    return { account: existing, created: false };
  }
}
