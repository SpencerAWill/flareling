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
  listOutbox,
} from "./index.ts";
import { storeInOutbox } from "./outbox.ts";

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

describe("the Resend sender", () => {
  const RESEND = "https://api.resend.com/emails";
  const config = {
    from: "noreply@example.com",
    fromName: "Example",
    resendApiKey: "re_test",
  };
  const resend = () => createEmailSender(config);

  it("posts the message with the key and an idempotency key", async () => {
    let headers: Headers | undefined;
    let body: unknown;
    network.use(
      http.post(RESEND, async ({ request }) => {
        headers = request.headers;
        body = await request.json();
        return HttpResponse.json({ id: "email_1" });
      }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    await resend().send(message);

    expect(headers?.get("authorization")).toBe("Bearer re_test");
    expect(headers?.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({
      from: '"Example" <noreply@example.com>',
      to: ["alice@example.com"],
      subject: "Sign in",
      text: "Use this link",
      html: "<p>Use this link</p>",
    });
  });

  it("sends from the bare address when there's no name", async () => {
    let body: { from?: string } = {};
    network.use(
      http.post(RESEND, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ id: "email_1" });
      }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    const { fromName: _, ...unnamed } = config;
    await createEmailSender(unnamed).send(message);

    expect(body.from).toBe("noreply@example.com");
  });

  it("escapes quotes in the sender's name", async () => {
    let body: { from?: string } = {};
    network.use(
      http.post(RESEND, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ id: "email_1" });
      }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    await createEmailSender({ ...config, fromName: 'The "Best" App' }).send(
      message,
    );

    expect(body.from).toBe('"The \\"Best\\" App" <noreply@example.com>');
  });

  it("retries a 429 or 5xx once, with the same idempotency key", async () => {
    const keys: (string | null)[] = [];
    network.use(
      http.post(
        RESEND,
        ({ request }) => {
          keys.push(request.headers.get("idempotency-key"));
          return HttpResponse.json({}, { status: 429 });
        },
        { once: true },
      ),
      http.post(RESEND, ({ request }) => {
        keys.push(request.headers.get("idempotency-key"));
        return HttpResponse.json({ id: "x" });
      }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    await resend().send(message);

    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("throws EmailSendError with the status when the retry is refused too", async () => {
    let attempts = 0;
    network.use(
      http.post(RESEND, () => {
        attempts++;
        return HttpResponse.json({}, { status: 503 });
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resend().send(message)).rejects.toSatisfy(
      (err) => err instanceof EmailSendError && err.status === 503,
    );
    expect(attempts).toBe(2);
  });

  it("logs the kind and provider, never the recipient", async () => {
    network.use(http.post(RESEND, () => HttpResponse.json({ id: "x" })));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await resend().send(message);

    expect(info).toHaveBeenCalledExactlyOnceWith("email.sent", {
      kind: "auth.magic_link",
      provider: "resend",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("alice@example.com");
  });

  it("retries a network error once, with the same idempotency key", async () => {
    const keys: (string | null)[] = [];
    network.use(
      http.post(
        RESEND,
        ({ request }) => {
          keys.push(request.headers.get("idempotency-key"));
          return HttpResponse.error();
        },
        { once: true },
      ),
      http.post(RESEND, ({ request }) => {
        keys.push(request.headers.get("idempotency-key"));
        return HttpResponse.json({ id: "x" });
      }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    await resend().send(message);

    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("uses a new idempotency key for each message", async () => {
    const keys: (string | null)[] = [];
    network.use(
      http.post(RESEND, ({ request }) => {
        keys.push(request.headers.get("idempotency-key"));
        return HttpResponse.json({ id: "x" });
      }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    const sender = resend();
    await sender.send(message);
    await sender.send(message);

    expect(keys[1]).not.toBe(keys[0]);
  });

  it("throws EmailSendError after the retry fails too", async () => {
    let attempts = 0;
    network.use(
      http.post(RESEND, () => {
        attempts++;
        return HttpResponse.error();
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resend().send(message)).rejects.toBeInstanceOf(EmailSendError);
    expect(attempts).toBe(2);
    expect(error).toHaveBeenCalledWith("email.send_failed", {
      kind: "auth.magic_link",
      provider: "resend",
    });
  });

  it("throws EmailSendError with the status, without retrying or logging the body", async () => {
    let attempts = 0;
    network.use(
      http.post(RESEND, () => {
        attempts++;
        return HttpResponse.json(
          { message: "Invalid `to` field: alice@example.com" },
          { status: 422 },
        );
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resend().send(message)).rejects.toSatisfy(
      (err) => err instanceof EmailSendError && err.status === 422,
    );
    expect(attempts).toBe(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("alice@example.com");
  });
});

describe("which transport wins", () => {
  it("prefers Mailpit over Resend, so local development never sends real mail", async () => {
    network.use(
      http.post(`${MAILPIT}/api/v1/send`, () => HttpResponse.json({ ID: "x" })),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await createEmailSender({
      from: "a@b.co",
      mailpitUrl: MAILPIT,
      resendApiKey: "re_test",
    }).send(message);

    expect(info).toHaveBeenCalledWith(
      "email.sent",
      expect.objectContaining({ provider: "mailpit" }),
    );
  });

  it("prefers the outbox over Resend", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await createEmailSender({
      from: "a@b.co",
      outbox: true,
      resendApiKey: "re_test",
    }).send(message);

    expect(info).toHaveBeenCalledWith(
      "email.sent",
      expect.objectContaining({ provider: "outbox" }),
    );
  });
});

describe("with no transport configured", () => {
  it("refuses to send rather than silently dropping or logging the email", async () => {
    await expect(
      createEmailSender({ from: "a@b.co" }).send(message),
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });
});

describe("the outbox", () => {
  it("stores the message instead of sending it, and lists newest first", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const sender = createEmailSender({
      from: "noreply@example.com",
      outbox: true,
    });
    await sender.send({ ...message, subject: "First" });
    await sender.send({ ...message, subject: "Second" });

    const emails = await listOutbox();
    expect(emails.map((e) => e.subject).slice(0, 2)).toEqual([
      "Second",
      "First",
    ]);
    expect(emails[0]).toMatchObject({
      kind: "auth.magic_link",
      to: "alice@example.com",
      text: "Use this link",
    });
  });

  it("prefers Mailpit when both are configured (local development)", async () => {
    network.use(
      http.post(`${MAILPIT}/api/v1/send`, () => HttpResponse.json({ ID: "x" })),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await createEmailSender({
      from: "a@b.co",
      mailpitUrl: MAILPIT,
      outbox: true,
    }).send(message);
    expect(info).toHaveBeenCalledWith(
      "email.sent",
      expect.objectContaining({ provider: "mailpit" }),
    );
  });

  it("forgets emails after a day", async () => {
    const day = 24 * 60 * 60 * 1000;
    await storeInOutbox(
      { ...message, subject: "Old" },
      new Date(Date.now() - day - 1000),
    );
    await storeInOutbox(
      { ...message, subject: "Recent" },
      new Date(Date.now() - day + 60_000),
    );
    const subjects = (await listOutbox()).map((e) => e.subject);
    expect(subjects).toContain("Recent");
    expect(subjects).not.toContain("Old");
  });
});
