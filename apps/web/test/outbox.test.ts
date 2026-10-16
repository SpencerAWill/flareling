import { setupNetwork } from "@msw/cloudflare";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
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
import {
  handleOutbox,
  linkify,
  renderOutbox,
} from "#/server/outbox/outbox.server.ts";

const TEAM = "team.cloudflareaccess.com";
const AUD = "outbox-aud";
const settings = {
  enabled: true,
  teamDomain: TEAM,
  aud: AUD,
  appBaseUrl: "https://dev.example.com",
};

const network = setupNetwork();
network.configure({ onUnhandledFrame: "error" });
const keys = await generateKeyPair("RS256");
const otherKeys = await generateKeyPair("RS256");
beforeAll(async () => {
  network.enable();
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "k1",
    alg: "RS256",
    use: "sig",
  };
  network.use(
    http.get(`https://${TEAM}/cdn-cgi/access/certs`, () =>
      HttpResponse.json({ keys: [jwk] }),
    ),
  );
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => network.disable());

function token({
  aud = AUD,
  issuer = `https://${TEAM}`,
  key = keys.privateKey,
  expiresIn = "5m",
} = {}) {
  return new SignJWT({ email: "me@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(issuer)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

const request = (jwt?: string) =>
  new Request("https://dev.example.com/dev/outbox", {
    headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {},
  });

const email = {
  id: "e1",
  kind: "auth.magic_link",
  to: "alice@example.com",
  subject: "Sign in <now>",
  text: "Use https://dev.example.com/auth/callback?token=abc or https://evil.example/x",
  createdAt: new Date("2026-10-16T12:00:00Z"),
};
const list = () => Promise.resolve([email]);

describe("/dev/outbox", () => {
  it("doesn't exist unless the outbox is on", async () => {
    const res = await handleOutbox(
      request(await token()),
      { ...settings, enabled: false },
      list,
    );
    expect(res.status).toBe(404);
  });

  it("lists the emails for a valid Access token, uncached", async () => {
    const res = await handleOutbox(request(await token()), settings, list);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await res.text()).toContain("Sign in &lt;now&gt;");
  });

  it.each([
    ["no token", undefined],
    ["the wrong audience", { aud: "another-app" }],
    ["the wrong issuer", { issuer: "https://other.cloudflareaccess.com" }],
    ["a key Access didn't publish", { key: otherKeys.privateKey }],
    ["an expired token", { expiresIn: "-1m" }],
  ] as const)("refuses %s", async (_, options) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const jwt = options === undefined ? undefined : await token(options);
    const res = await handleOutbox(request(jwt), settings, list);
    expect(res.status).toBe(403);
  });
});

describe("rendering", () => {
  it("escapes everything and links only this app's own URLs", () => {
    const html = linkify(email.text, settings.appBaseUrl);
    expect(html).toContain(
      '<a href="https://dev.example.com/auth/callback?token=abc">https://dev.example.com/auth/callback?token=abc</a>',
    );
    expect(html).not.toContain('href="https://evil.example');
    expect(linkify('<script>alert("x")</script>', settings.appBaseUrl)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("says when there's nothing yet", () => {
    expect(renderOutbox([], settings.appBaseUrl)).toContain("Nothing yet.");
  });
});
