/**
 * Passkeys (WebAuthn), through @simplewebauthn/server. An optional shortcut
 * next to magic links, never the only way in: email stays the recovery path.
 *
 * Each ceremony is begin → browser → finish. Begin stores a challenge in
 * `webauthn_challenges` under a random id, sent as a short-lived Strict
 * cookie. Finish claims it with DELETE ... RETURNING before doing anything
 * else, so a challenge can be used once, even by concurrent requests and on
 * every failure path. (ucmc kept challenges in KV, where read-then-delete
 * isn't atomic.)
 *
 * Settings, from ucmc: discoverable credentials (resident keys required), so
 * sign-in needs no username; user verification preferred but not required, so
 * a security key without a PIN still works, the same assurance as access to
 * the inbox; attestation "none", so no certificate chains are fetched or
 * parsed.
 */
import { getDb, isUniqueViolation, recordAudit, schema } from "@flareling/db";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { and, eq, gt } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import { z } from "zod";
import {
  type AuthContext,
  cookieName,
  DEFAULTS,
  isSecure,
  nowOf,
} from "./context.ts";
import { ipKey, withinRateLimit } from "./guards.ts";
import { signIn } from "./principal.ts";
import type { Principal } from "./rbac.ts";
import { loadSession } from "./session.ts";
import { randomToken } from "./tokens.ts";

/** The transport names verification takes. */
type Transports = NonNullable<
  Parameters<typeof verifyAuthenticationResponse>[0]["credential"]["transports"]
>;

/** The transports column: a JSON array of the browser's transport names. */
const storedTransports = z.array(z.string());

/**
 * The stored transports, for verification. They only hint which way to
 * reach the authenticator, so a row that doesn't parse (written by an older
 * version, or edited by hand) just leaves them out.
 */
function transportsOf(column: string | null): { transports?: Transports } {
  if (!column) return {};
  try {
    const parsed = storedTransports.safeParse(JSON.parse(column));
    return parsed.success ? { transports: parsed.data as Transports } : {};
  } catch {
    return {};
  }
}

const { passkeyCredentials, users, webauthnChallenges } = schema;
const CEREMONY_COOKIE = "webauthn";

const toDate = (instant: Temporal.Instant) =>
  new Date(instant.epochMilliseconds);

type CeremonyType = "register" | "authenticate";

async function startCeremony(
  ctx: AuthContext,
  type: CeremonyType,
  challenge: string,
  userId: string | null,
): Promise<void> {
  const id = randomToken();
  const ttl = ctx.config.challengeTtl ?? DEFAULTS.challengeTtl;
  await getDb()
    .insert(webauthnChallenges)
    .values({
      id,
      challenge,
      type,
      userId,
      expiresAt: toDate(nowOf(ctx).add(ttl)),
    });
  ctx.cookies.set(cookieName(ctx.config, CEREMONY_COOKIE), id, {
    httpOnly: true,
    secure: isSecure(ctx.config),
    // Ceremonies are always first-party.
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(ttl.total("seconds")),
  });
}

/** Takes this browser's ceremony, if it's live and of `type`, and clears it. */
async function claimCeremony(ctx: AuthContext, type: CeremonyType) {
  const name = cookieName(ctx.config, CEREMONY_COOKIE);
  const id = ctx.cookies.get(name);
  ctx.cookies.delete(name, { path: "/", secure: isSecure(ctx.config) });
  if (!id) return undefined;
  const [row] = await getDb()
    .delete(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.id, id),
        gt(webauthnChallenges.expiresAt, toDate(nowOf(ctx))),
      ),
    )
    .returning();
  return row?.type === type ? row : undefined;
}

/** WebAuthn's expected origin: APP_BASE_URL's origin, exactly. */
function expectedOrigin(ctx: AuthContext): string {
  return new URL(ctx.config.appBaseUrl).origin;
}

// ── Registration (signed in) ────────────────────────────────────────────────
//
// Adding a passkey needs a recent sign-in, not just a live session: a passkey
// outlives the session it was added from, so a stolen session cookie must not
// be able to turn itself into a permanent way back in.

async function signedInRecently(ctx: AuthContext, principal: Principal) {
  const session = await loadSession(ctx);
  if (!session || session.userId !== principal.userId) return false;
  const window = ctx.config.recentSignIn ?? DEFAULTS.recentSignIn;
  return (
    nowOf(ctx).epochMilliseconds - session.createdAt.getTime() <=
    window.total("milliseconds")
  );
}

export async function beginPasskeyRegistration(
  ctx: AuthContext,
  principal: Principal,
) {
  if (!(await withinRateLimit(ctx, ipKey(ctx)))) {
    return { ok: false as const, reason: "rate_limited" as const };
  }
  if (!(await signedInRecently(ctx, principal))) {
    return { ok: false as const, reason: "reauthenticate" as const };
  }
  const existing = await getDb()
    .select({ credentialId: passkeyCredentials.credentialId })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.userId, principal.userId));
  const options = await generateRegistrationOptions({
    rpName: ctx.config.appName,
    rpID: ctx.config.rpId,
    userName: principal.primaryEmail,
    userID: isoUint8Array.fromUTF8String(principal.userId),
    attestationType: "none",
    // Stops the browser registering a second passkey on an authenticator
    // that already has one for this account.
    excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });
  await startCeremony(ctx, "register", options.challenge, principal.userId);
  return { ok: true as const, options };
}

export async function finishPasskeyRegistration(
  ctx: AuthContext,
  principal: Principal,
  input: { readonly response: unknown; readonly nickname?: string | undefined },
) {
  if (!(await withinRateLimit(ctx, ipKey(ctx)))) {
    return { ok: false as const, reason: "rate_limited" as const };
  }
  if (!(await signedInRecently(ctx, principal))) {
    return { ok: false as const, reason: "reauthenticate" as const };
  }
  const ceremony = await claimCeremony(ctx, "register");
  if (!ceremony) return { ok: false as const, reason: "no_ceremony" as const };
  // A ceremony begun by one account can't finish on another's session.
  if (ceremony.userId !== principal.userId) {
    return { ok: false as const, reason: "verification_failed" as const };
  }

  const response = input.response as RegistrationResponseJSON;
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: expectedOrigin(ctx),
    expectedRPID: ctx.config.rpId,
    requireUserVerification: false,
  }).catch(() => undefined);
  if (!verification?.verified) {
    return { ok: false as const, reason: "verification_failed" as const };
  }

  const info = verification.registrationInfo;
  const nickname = input.nickname?.trim().slice(0, 60) || null;
  // With attestation "none" a client chooses the credential id, so a
  // duplicate (another account's, or a replay) is a failed registration, not
  // a server error.
  const inserted = await getDb()
    .insert(passkeyCredentials)
    .values({
      userId: principal.userId,
      credentialId: info.credential.id,
      publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
      counter: info.credential.counter,
      transports: response.response.transports
        ? JSON.stringify(response.response.transports)
        : null,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      nickname,
    })
    .returning({ id: passkeyCredentials.id })
    .then(
      (rows) => rows,
      (err: unknown) => {
        if (isUniqueViolation(err, "passkey_credentials.credential_id"))
          return null;
        throw err;
      },
    );
  if (!inserted) {
    return { ok: false as const, reason: "verification_failed" as const };
  }
  const [row] = inserted;
  await recordAudit({
    action: "passkey.added",
    actorId: principal.userId,
    targetType: "passkey",
    targetId: row?.id ?? "",
  });
  // Adding a way to sign in is a privilege change: rotate the session.
  await signIn(ctx, principal.userId);
  return { ok: true as const, id: row?.id ?? "" };
}

// ── Authentication (public) ─────────────────────────────────────────────────

export async function beginPasskeyAuthentication(ctx: AuthContext) {
  if (!(await withinRateLimit(ctx, ipKey(ctx)))) {
    return { ok: false as const, reason: "rate_limited" as const };
  }
  // No allowCredentials: the authenticator offers its discoverable
  // credentials, so no username is needed.
  const options = await generateAuthenticationOptions({
    rpID: ctx.config.rpId,
    userVerification: "preferred",
  });
  await startCeremony(ctx, "authenticate", options.challenge, null);
  return { ok: true as const, options };
}

export async function finishPasskeyAuthentication(
  ctx: AuthContext,
  input: { readonly response: unknown },
) {
  if (!(await withinRateLimit(ctx, ipKey(ctx)))) {
    return { ok: false as const, reason: "rate_limited" as const };
  }
  const ceremony = await claimCeremony(ctx, "authenticate");
  if (!ceremony) return { ok: false as const, reason: "no_ceremony" as const };

  const response = input.response as AuthenticationResponseJSON;
  const [credential] = await getDb()
    .select({
      id: passkeyCredentials.id,
      userId: passkeyCredentials.userId,
      credentialId: passkeyCredentials.credentialId,
      publicKey: passkeyCredentials.publicKey,
      counter: passkeyCredentials.counter,
      transports: passkeyCredentials.transports,
      disabledAt: users.disabledAt,
    })
    .from(passkeyCredentials)
    .innerJoin(users, eq(users.id, passkeyCredentials.userId))
    .where(eq(passkeyCredentials.credentialId, String(response?.id ?? "")));
  // Unknown credential, failed check and disabled account all look alike.
  if (!credential || credential.disabledAt !== null) {
    return { ok: false as const, reason: "invalid" as const };
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: expectedOrigin(ctx),
    expectedRPID: ctx.config.rpId,
    credential: {
      id: credential.credentialId,
      publicKey: isoBase64URL.toBuffer(credential.publicKey),
      counter: credential.counter,
      ...transportsOf(credential.transports),
    },
    requireUserVerification: false,
  }).catch(() => undefined);
  if (!verification?.verified) {
    return { ok: false as const, reason: "invalid" as const };
  }

  // Most passkeys report 0 forever. A non-zero counter that didn't increase
  // suggests a cloned authenticator.
  const { newCounter } = verification.authenticationInfo;
  if (newCounter !== 0 && newCounter <= credential.counter) {
    return { ok: false as const, reason: "invalid" as const };
  }
  const claimed = await getDb()
    .update(passkeyCredentials)
    .set({ counter: newCounter, lastUsedAt: toDate(nowOf(ctx)) })
    .where(
      and(
        eq(passkeyCredentials.id, credential.id),
        // Conditional, so a concurrent sign-in can't move the counter back.
        eq(passkeyCredentials.counter, credential.counter),
      ),
    )
    .returning({ id: passkeyCredentials.id });
  // Matched nothing: a concurrent sign-in with this credential moved the
  // counter first. Only one of two uses of the same counter value may win,
  // which is what makes a cloned authenticator detectable.
  if (claimed.length === 0) {
    return { ok: false as const, reason: "invalid" as const };
  }

  await signIn(ctx, credential.userId);
  await recordAudit({
    action: "auth.signed_in",
    actorId: credential.userId,
    metadata: { method: "passkey" },
  });
  return { ok: true as const, userId: credential.userId };
}

// ── Management ──────────────────────────────────────────────────────────────

/** The account's passkeys, for a security settings page. */
export function listPasskeys(userId: string) {
  return getDb()
    .select({
      id: passkeyCredentials.id,
      nickname: passkeyCredentials.nickname,
      deviceType: passkeyCredentials.deviceType,
      backedUp: passkeyCredentials.backedUp,
      createdAt: passkeyCredentials.createdAt,
      lastUsedAt: passkeyCredentials.lastUsedAt,
    })
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.userId, userId))
    .orderBy(passkeyCredentials.createdAt);
}

/** Removes one of the account's passkeys. False if it isn't theirs. */
export async function removePasskey(
  userId: string,
  passkeyId: string,
): Promise<boolean> {
  const deleted = await getDb()
    .delete(passkeyCredentials)
    .where(
      and(
        eq(passkeyCredentials.id, passkeyId),
        eq(passkeyCredentials.userId, userId),
      ),
    )
    .returning({ id: passkeyCredentials.id });
  if (deleted.length === 0) return false;
  // Audited after the delete, from what it returned, so nothing is recorded
  // for a delete that matched nothing.
  await recordAudit({
    action: "passkey.removed",
    actorId: userId,
    targetType: "passkey",
    targetId: passkeyId,
  });
  return true;
}
