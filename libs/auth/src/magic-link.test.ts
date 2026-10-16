import { getDb, schema } from "@flareling/db";
import { setupNetwork } from "@msw/cloudflare";
import { eq } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { nextRequest, type TestContext, testContext } from "../test/context.ts";
import { createUser } from "../test/users.ts";
import { consumeMagicLink, getPrincipal, requestMagicLink } from "./index.ts";

const network = setupNetwork();
network.configure({ onUnhandledFrame: "error" });
beforeAll(() => network.enable());
afterEach(() => {
  network.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => network.disable());

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The token from the link in the last email `ctx` sent. */
function sentToken(ctx: TestContext): string {
  const text = ctx.sent.at(-1)?.text ?? "";
  const url = new URL(text.match(/https?:\/\/\S+/)?.[0] ?? "http://none");
  return url.searchParams.get("token") ?? "";
}

async function emailedLink(email: string, ctx = testContext()) {
  await requestMagicLink(ctx, { email });
  return { ctx, token: sentToken(ctx) };
}

describe("requesting a link", () => {
  it("emails a single-use link to the normalized address", async () => {
    const ctx = testContext();
    await requestMagicLink(ctx, { email: "  New@Example.com " });

    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0]).toMatchObject({
      kind: "auth.magic_link",
      to: "new@example.com",
      subject: "Your Flareling sign-in link",
    });
    expect(ctx.sent[0]?.text).toMatch(
      /http:\/\/localhost:3000\/auth\/callback\?token=[A-Za-z0-9_-]{43}/,
    );
  });

  it("answers the same way for addresses with and without an account", async () => {
    await createUser("known@example.com");
    const known = testContext();
    const unknown = testContext();
    expect(
      await requestMagicLink(known, { email: "known@example.com" }),
    ).toEqual({ ok: true });
    expect(
      await requestMagicLink(unknown, { email: "unknown@example.com" }),
    ).toEqual({ ok: true });
    expect([known.sent.length, unknown.sent.length]).toEqual([1, 1]);
  });

  it("stores only the token's hash", async () => {
    const { token } = await emailedLink("hash@example.com");
    const rows = await getDb()
      .select()
      .from(schema.magicLinks)
      .where(eq(schema.magicLinks.email, "hash@example.com"));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("keeps a safe redirect, and drops one to another host", async () => {
    const safe = testContext();
    await requestMagicLink(safe, {
      email: "r@example.com",
      redirect: "/billing",
    });
    expect(safe.sent[0]?.text).toContain("redirect=%2Fbilling");

    const unsafe = testContext();
    await requestMagicLink(unsafe, {
      email: "r@example.com",
      redirect: "//evil.com",
    });
    expect(unsafe.sent[0]?.text).not.toContain("redirect=");
  });

  it("sends nothing, but still answers ok, when rate limited", async () => {
    const ctx = testContext({
      rateLimiter: {
        limit: async ({ key }) => ({ success: !key.startsWith("email:") }),
      },
    });
    expect(
      await requestMagicLink(ctx, { email: "limited@example.com" }),
    ).toEqual({ ok: true });
    expect(ctx.sent).toEqual([]);
  });

  it("takes at least the padded time, so timing doesn't reveal the outcome", async () => {
    const ctx = testContext({
      config: { magicLinkResponsePadding: { minMs: 150, jitterMs: 0 } },
      rateLimiter: { limit: async () => ({ success: false }) },
    });
    const started = Date.now();
    await requestMagicLink(ctx, { email: "fast-path@example.com" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(145);
  });
});

describe("Turnstile", () => {
  const withSecret = () =>
    testContext({ config: { turnstileSecret: "secret" } });

  it("blocks a request with no token once a secret is set (ucmc skipped the check)", async () => {
    const ctx = withSecret();
    await requestMagicLink(ctx, { email: "bot@example.com" });
    await requestMagicLink(ctx, {
      email: "bot@example.com",
      turnstileToken: "",
    });
    expect(ctx.sent).toEqual([]);
  });

  it("verifies the token with Cloudflare, sending the client IP", async () => {
    let form: URLSearchParams | undefined;
    network.use(
      http.post(SITEVERIFY, async ({ request }) => {
        form = new URLSearchParams(await request.text());
        return HttpResponse.json({ success: form.get("response") === "good" });
      }),
    );
    const ok = withSecret();
    await requestMagicLink(ok, {
      email: "human@example.com",
      turnstileToken: "good",
    });
    const bad = withSecret();
    await requestMagicLink(bad, {
      email: "human@example.com",
      turnstileToken: "bad",
    });

    expect(ok.sent).toHaveLength(1);
    expect(bad.sent).toEqual([]);
    expect(form?.get("secret")).toBe("secret");
    expect(form?.get("remoteip")).toBe("203.0.113.7");
  });

  it("fails closed on an error response, open when Cloudflare is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    network.use(
      http.post(SITEVERIFY, () => new HttpResponse(null, { status: 500 })),
    );
    const errored = withSecret();
    await requestMagicLink(errored, {
      email: "e@example.com",
      turnstileToken: "t",
    });
    expect(errored.sent).toEqual([]);

    network.use(http.post(SITEVERIFY, () => HttpResponse.error()));
    const unreachable = withSecret();
    await requestMagicLink(unreachable, {
      email: "e@example.com",
      turnstileToken: "t",
    });
    expect(unreachable.sent).toHaveLength(1);
  });
});

describe("consuming a link", () => {
  it("creates the account on first sign-in, with the member role, and signs in", async () => {
    const { ctx, token } = await emailedLink("first@example.com");
    const result = await consumeMagicLink(nextRequest(ctx), token);

    expect(result).toMatchObject({ ok: true, isNewUser: true });
    const principal = await getPrincipal(nextRequest(ctx));
    expect(principal).toMatchObject({
      primaryEmail: "first@example.com",
      roles: ["member"],
    });
  });

  it("signs an existing account in", async () => {
    const userId = await createUser("returning@example.com");
    const { ctx, token } = await emailedLink("returning@example.com");
    expect(await consumeMagicLink(nextRequest(ctx), token)).toEqual({
      ok: true,
      userId,
      isNewUser: false,
    });
  });

  it("works once", async () => {
    const { ctx, token } = await emailedLink("once@example.com");
    await consumeMagicLink(nextRequest(ctx), token);
    expect(await consumeMagicLink(nextRequest(ctx), token)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("expires after 15 minutes, without being marked used", async () => {
    const { ctx, token } = await emailedLink("late@example.com");
    const later = nextRequest(ctx);
    later.advance({ minutes: 16 });

    expect(await consumeMagicLink(later, token)).toEqual({
      ok: false,
      reason: "invalid",
    });
    const [row] = await getDb()
      .select({ consumedAt: schema.magicLinks.consumedAt })
      .from(schema.magicLinks)
      .where(eq(schema.magicLinks.email, "late@example.com"));
    expect(row?.consumedAt).toBeNull();
  });

  it("refuses an unknown token, and a disabled account", async () => {
    expect(await consumeMagicLink(testContext(), "x".repeat(43))).toEqual({
      ok: false,
      reason: "invalid",
    });

    const userId = await createUser("disabled@example.com");
    await getDb()
      .update(schema.users)
      .set({ disabledAt: new Date() })
      .where(eq(schema.users.id, userId));
    const { ctx, token } = await emailedLink("disabled@example.com");
    expect(await consumeMagicLink(nextRequest(ctx), token)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("is rate limited by IP", async () => {
    const ctx = testContext({
      rateLimiter: { limit: async () => ({ success: false }) },
    });
    expect(await consumeMagicLink(ctx, "anything")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
  });

  it("records the sign-in in the audit log, with ids only", async () => {
    const { ctx, token } = await emailedLink("audited@example.com");
    const result = await consumeMagicLink(nextRequest(ctx), token);
    const rows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorId, result.ok ? result.userId : ""));
    expect(rows).toMatchObject([
      {
        action: "auth.account_created",
        metadataJson: '{"method":"magic_link"}',
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("audited@example.com");
  });
});

describe("the rate-limit bypass", () => {
  it("applies over http, and never over https", async () => {
    const refuseAll = { limit: async () => ({ success: false }) };
    const local = testContext({
      config: { rateLimitBypass: true },
      rateLimiter: refuseAll,
    });
    await requestMagicLink(local, { email: "e2e@example.com" });
    expect(local.sent).toHaveLength(1);

    const deployed = testContext({
      config: { rateLimitBypass: true, appBaseUrl: "https://app.example.com" },
      rateLimiter: refuseAll,
    });
    await requestMagicLink(deployed, { email: "e2e@example.com" });
    expect(deployed.sent).toEqual([]);
  });
});
