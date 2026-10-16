import { setupNetwork } from "@msw/cloudflare";
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
  createEmailSender,
  EmailNotConfiguredError,
  EmailSendError,
} from "./index.ts";

// Outbound requests from the Worker are intercepted, so nothing reaches a
// real Mailpit, and a request no handler declares fails the test.
const network = setupNetwork();
network.configure({ onUnhandledFrame: "error" });
beforeAll(() => network.enable());
afterEach(() => {
  network.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => network.disable());

const MAILPIT = "http://mailpit.test:8025";
const message = {
  kind: "auth.magic_link",
  to: "alice@example.com",
  subject: "Sign in",
  text: "Use this link",
  html: "<p>Use this link</p>",
};

describe("the Mailpit sender", () => {
  it("posts the message to Mailpit's send API", async () => {
    let body: unknown;
    network.use(
      http.post(`${MAILPIT}/api/v1/send`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ID: "msg_1" });
      }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    await createEmailSender({
      from: "noreply@example.com",
      fromName: "Example",
      mailpitUrl: MAILPIT,
    }).send(message);

    expect(body).toEqual({
      From: { Email: "noreply@example.com", Name: "Example" },
      To: [{ Email: "alice@example.com" }],
      Subject: "Sign in",
      Text: "Use this link",
      HTML: "<p>Use this link</p>",
    });
  });

  it("logs the kind and provider, never the recipient", async () => {
    network.use(
      http.post(`${MAILPIT}/api/v1/send`, () => HttpResponse.json({ ID: "x" })),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await createEmailSender({ from: "a@b.co", mailpitUrl: MAILPIT }).send(
      message,
    );

    expect(info).toHaveBeenCalledExactlyOnceWith("email.sent", {
      kind: "auth.magic_link",
      provider: "mailpit",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("alice@example.com");
  });

  it("throws EmailSendError with the status when Mailpit refuses", async () => {
    network.use(
      http.post(`${MAILPIT}/api/v1/send`, () =>
        HttpResponse.json({ Error: "no recipients" }, { status: 400 }),
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      createEmailSender({ from: "a@b.co", mailpitUrl: MAILPIT }).send(message),
    ).rejects.toSatisfy(
      (err) => err instanceof EmailSendError && err.status === 400,
    );
  });

  it("throws EmailSendError when Mailpit can't be reached", async () => {
    network.use(
      http.post(`${MAILPIT}/api/v1/send`, () => HttpResponse.error()),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      createEmailSender({ from: "a@b.co", mailpitUrl: MAILPIT }).send(message),
    ).rejects.toBeInstanceOf(EmailSendError);
    expect(error).toHaveBeenCalledWith("email.send_failed", {
      kind: "auth.magic_link",
      provider: "mailpit",
    });
  });
});

describe("with no transport configured", () => {
  it("refuses to send rather than silently dropping or logging the email", async () => {
    await expect(
      createEmailSender({ from: "a@b.co" }).send(message),
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });
});
