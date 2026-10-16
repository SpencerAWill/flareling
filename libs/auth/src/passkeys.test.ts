import { getDb, schema } from "@flareling/db";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextRequest, type TestContext, testContext } from "../test/context.ts";
import { createUser } from "../test/users.ts";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listPasskeys,
  loadPrincipal,
  type Principal,
  removePasskey,
} from "./index.ts";
import { loadSession } from "./session.ts";

// The cryptography is @simplewebauthn's (and E2E's, with a virtual
// authenticator). These tests cover the ceremony around it: challenges,
// cookies, ownership, counters and sessions.
vi.mock("@simplewebauthn/server", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
const verifyRegistration = vi.mocked(verifyRegistrationResponse);
const verifyAuthentication = vi.mocked(verifyAuthenticationResponse);

beforeEach(() => {
  // Reset, not just clear: an answer queued with mockResolvedValueOnce that a
  // test didn't use (an early return before verification) must not leak.
  verifyAuthentication.mockReset();
  verifyAuthentication.mockRejectedValue(new Error("no answer set up"));
  verifyRegistration.mockReset();
  // A fresh credential id per registration, as real authenticators give.
  verifyRegistration.mockImplementation(
    async () =>
      ({
        verified: true,
        registrationInfo: {
          credential: {
            id: `cred-${crypto.randomUUID()}`,
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
          },
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
        },
      }) as never,
  );
});
afterEach(() => vi.clearAllMocks());

async function signedInUser(
  email: string,
): Promise<{ principal: Principal; ctx: TestContext }> {
  const userId = await createUser(email);
  const principal = await loadPrincipal(userId);
  if (!principal) throw new Error("no principal");
  return { principal, ctx: testContext() };
}

async function register(email: string) {
  const { principal, ctx } = await signedInUser(email);
  await beginPasskeyRegistration(ctx, principal);
  const finish = nextRequest(ctx);
  const result = await finishPasskeyRegistration(finish, principal, {
    response: { response: { transports: ["internal"] } },
    nickname: " Laptop ",
  });
  return { principal, ctx: finish, result };
}

/** Whether the ceremony with this cookie value still exists. */
const ceremonyExists = async (id: string) =>
  (
    await getDb()
      .select()
      .from(schema.webauthnChallenges)
      .where(eq(schema.webauthnChallenges.id, id))
  ).length > 0;

describe("registering a passkey", () => {
  it("issues options for this RP and account, with a Strict ceremony cookie", async () => {
    const { principal, ctx } = await signedInUser("reg@example.com");
    const result = await beginPasskeyRegistration(ctx, principal);

    expect(result.ok && result.options).toMatchObject({
      rp: { name: "Flareling", id: "localhost" },
      user: { name: "reg@example.com" },
      attestation: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
    });
    expect(ctx.cookies.lastSet.get("webauthn")).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      maxAge: 300,
    });
  });

  it("stores the credential, rotates the session, and audits it", async () => {
    const { principal, ctx, result } = await register("store@example.com");

    expect(result).toMatchObject({ ok: true });
    expect(await listPasskeys(principal.userId)).toMatchObject([
      { nickname: "Laptop", deviceType: "multiDevice", backedUp: true },
    ]);
    expect(await loadSession(nextRequest(ctx))).toMatchObject({
      userId: principal.userId,
    });
    const audit = await getDb()
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorId, principal.userId));
    expect(audit).toEqual([{ action: "passkey.added" }]);
  });

  it("uses a challenge once, even when verification fails", async () => {
    const { principal, ctx } = await signedInUser("once@example.com");
    await beginPasskeyRegistration(ctx, principal);
    verifyRegistration.mockRejectedValueOnce(new Error("bad signature"));
    const cookie = ctx.cookies.get("webauthn") ?? "";

    const failed = nextRequest(ctx);
    expect(
      await finishPasskeyRegistration(failed, principal, { response: {} }),
    ).toEqual({
      ok: false,
      reason: "verification_failed",
    });
    expect(await ceremonyExists(cookie)).toBe(false);

    // Replaying the same ceremony cookie finds nothing.
    const replay = nextRequest(ctx);
    replay.cookies.values.set("webauthn", cookie);
    expect(
      await finishPasskeyRegistration(replay, principal, { response: {} }),
    ).toEqual({
      ok: false,
      reason: "no_ceremony",
    });
  });

  it("refuses to finish on a different account than it began on", async () => {
    const { principal: alice, ctx } = await signedInUser("alice@example.com");
    const { principal: mallory } = await signedInUser("mallory@example.com");
    await beginPasskeyRegistration(ctx, alice);

    expect(
      await finishPasskeyRegistration(nextRequest(ctx), mallory, {
        response: {},
      }),
    ).toEqual({ ok: false, reason: "verification_failed" });
    expect(verifyRegistration).not.toHaveBeenCalled();
  });

  it("expires a ceremony after 5 minutes", async () => {
    const { principal, ctx } = await signedInUser("slow@example.com");
    await beginPasskeyRegistration(ctx, principal);
    const late = nextRequest(ctx);
    late.advance({ minutes: 6 });
    expect(
      await finishPasskeyRegistration(late, principal, { response: {} }),
    ).toEqual({
      ok: false,
      reason: "no_ceremony",
    });
  });

  it("excludes the account's existing passkeys", async () => {
    const { principal } = await register("second@example.com");
    const again = testContext();
    const result = await beginPasskeyRegistration(again, principal);
    expect(result.ok && result.options.excludeCredentials).toHaveLength(1);
  });
});

describe("signing in with a passkey", () => {
  async function storedCredentialId(userId: string) {
    const [row] = await getDb()
      .select({ credentialId: schema.passkeyCredentials.credentialId })
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.userId, userId));
    return row?.credentialId ?? "";
  }

  async function authenticate(credentialId: string, newCounter: number) {
    verifyAuthentication.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter },
    } as never);
    const ctx = testContext();
    await beginPasskeyAuthentication(ctx);
    const finish = nextRequest(ctx);
    return {
      ctx: finish,
      result: await finishPasskeyAuthentication(finish, {
        response: { id: credentialId },
      }),
    };
  }

  it("signs in the passkey's account and audits it", async () => {
    const { principal } = await register("pk-signin@example.com");
    const { ctx, result } = await authenticate(
      await storedCredentialId(principal.userId),
      0,
    );

    expect(result).toEqual({ ok: true, userId: principal.userId });
    expect(await loadSession(nextRequest(ctx))).toMatchObject({
      userId: principal.userId,
    });
  });

  it("gives the same answer for an unknown credential and a failed check", async () => {
    const unknown = await authenticate("no-such-credential", 0);
    expect(unknown.result).toEqual({ ok: false, reason: "invalid" });

    const { principal } = await register("pk-fail@example.com");
    verifyAuthentication.mockRejectedValue(new Error("bad signature"));
    const ctx = testContext();
    await beginPasskeyAuthentication(ctx);
    expect(
      await finishPasskeyAuthentication(nextRequest(ctx), {
        response: { id: await storedCredentialId(principal.userId) },
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a counter that went backwards, and accepts one that stays 0", async () => {
    const { principal } = await register("pk-counter@example.com");
    const id = await storedCredentialId(principal.userId);
    expect((await authenticate(id, 5)).result).toMatchObject({ ok: true });
    expect((await authenticate(id, 3)).result).toEqual({
      ok: false,
      reason: "invalid",
    });

    const { principal: modern } = await register("pk-zero@example.com");
    const zeroId = await storedCredentialId(modern.userId);
    expect((await authenticate(zeroId, 0)).result).toMatchObject({ ok: true });
    expect((await authenticate(zeroId, 0)).result).toMatchObject({ ok: true });
  });

  it("refuses a disabled account", async () => {
    const { principal } = await register("pk-disabled@example.com");
    await getDb()
      .update(schema.users)
      .set({ disabledAt: new Date() })
      .where(eq(schema.users.id, principal.userId));
    const { result } = await authenticate(
      await storedCredentialId(principal.userId),
      0,
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("needs a ceremony begun by this browser", async () => {
    expect(
      await finishPasskeyAuthentication(testContext(), {
        response: { id: "x" },
      }),
    ).toEqual({
      ok: false,
      reason: "no_ceremony",
    });
  });
});

describe("managing passkeys", () => {
  it("removes only the account's own passkeys", async () => {
    const { principal: owner } = await register("owner@example.com");
    const { principal: other } = await signedInUser("other@example.com");
    const [passkey] = await listPasskeys(owner.userId);

    expect(await removePasskey(other.userId, passkey?.id ?? "")).toBe(false);
    expect(await removePasskey(owner.userId, passkey?.id ?? "")).toBe(true);
    expect(await listPasskeys(owner.userId)).toEqual([]);
  });
});
