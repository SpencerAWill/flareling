/**
 * Sending email, behind an interface so the provider can be chosen later
 * (docs/adr/0015-email-behind-an-interface.md). Three transports, the first
 * configured one wins:
 *
 *   1. Mailpit, the dev container's inbox. First so local development never
 *      sends real mail, even with a Resend key in .env.local.
 *   2. The outbox a deployed dev environment writes to (outbox.ts).
 *   3. Resend, the production provider (docs/adr/0023-resend-for-production-email.md).
 *
 * There is deliberately no "log it instead" fallback. In ucmc.spencerwill.com
 * one either dumped magic-link URLs into dashboard-readable Workers Logs or
 * left people waiting for an email that never came. With nothing configured,
 * sending throws EmailNotConfiguredError.
 *
 * Log lines carry the email's `kind` and the provider, never the recipient or
 * the content.
 */
import { log } from "@flareling/log";
import { storeInOutbox } from "./outbox.ts";

export interface EmailMessage {
  /** What the email is, for logs and metrics (`auth.magic_link`). */
  readonly kind: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface EmailConfig {
  /** The From address, e.g. `noreply@example.com`. */
  readonly from: string;
  readonly fromName?: string;
  /** Mailpit's HTTP base URL (`http://mailpit:8025` in the dev container). */
  readonly mailpitUrl?: string;
  /**
   * Store messages in the outbox (D1) instead of sending them. Deployed dev
   * only, behind Cloudflare Access; apps/web's env checks refuse it otherwise.
   */
  readonly outbox?: boolean;
  /** A Resend API key (`re_...`), ideally scoped to sending. */
  readonly resendApiKey?: string;
}

/** No email transport is configured, so nothing can be sent. */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "No email transport is configured. Set MAILPIT_URL for local development, EMAIL_OUTBOX on a deployed dev environment, or RESEND_API_KEY to send through Resend. The first one set wins, in that order.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

/** The transport refused or failed to accept a message. */
export class EmailSendError extends Error {
  readonly status: number | undefined;

  constructor(provider: string, status?: number) {
    super(
      `Sending email through ${provider} failed${status === undefined ? "" : ` (HTTP ${status})`}`,
    );
    this.name = "EmailSendError";
    this.status = status;
  }
}

/** The sender for `config`, or a sender that throws when nothing is set up. */
export function createEmailSender(config: EmailConfig): EmailSender {
  if (config.mailpitUrl) {
    return mailpitSender(config.mailpitUrl, config);
  }
  if (config.outbox) {
    return {
      async send(message) {
        await storeInOutbox(message);
        log.info("email.sent", { kind: message.kind, provider: "outbox" });
      },
    };
  }
  if (config.resendApiKey) {
    return resendSender(config.resendApiKey, config);
  }
  return {
    send: () => Promise.reject(new EmailNotConfiguredError()),
  };
}

/** Mailpit's HTTP send API (`POST /api/v1/send`). */
function mailpitSender(baseUrl: string, config: EmailConfig): EmailSender {
  const endpoint = new URL("/api/v1/send", baseUrl);
  return httpSender("mailpit", (message) => ({
    url: endpoint,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: config.from, Name: config.fromName ?? "" },
        To: [{ Email: message.to }],
        Subject: message.subject,
        Text: message.text,
        ...(message.html === undefined ? {} : { HTML: message.html }),
      }),
    },
  }));
}

/**
 * Resend's send API (`POST https://api.resend.com/emails`). Each message gets
 * its own idempotency key, reused by the retry, so a request that reached
 * Resend before the connection dropped isn't sent twice.
 */
function resendSender(apiKey: string, config: EmailConfig): EmailSender {
  // An RFC 5322 quoted string: only `"` and `\` need escaping.
  const from = config.fromName
    ? `"${config.fromName.replace(/["\\]/g, "\\$&")}" <${config.from}>`
    : config.from;
  return httpSender("resend", (message) => ({
    url: "https://api.resend.com/emails",
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      }),
    },
  }));
}

/** How long one attempt may take before it counts as a network error. */
const ATTEMPT_TIMEOUT_MS = 10_000;
/** The pause before the retry, so a 429 has a chance to clear. */
const RETRY_DELAY_MS = 500;

/** Worth one more try: rate limited, or the provider's own failure. */
const retryable = (status: number) => status === 429 || status >= 500;

/**
 * A sender that makes one HTTP request per message. `request` builds it once;
 * the retry sends the same request again.
 */
function httpSender(
  provider: string,
  request: (message: EmailMessage) => { url: string | URL; init: RequestInit },
): EmailSender {
  return {
    async send(message) {
      const { url, init } = request(message);
      const post = async () => {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        });
        // Consumed either way: an unread body holds the connection open.
        // Never logged: Resend's errors can echo the recipient back.
        await response.text();
        return response;
      };
      let response: Response;
      try {
        // One retry on a network error, a timeout, a 429 or a 5xx: a blip
        // (Mailpit under parallel E2E load, Resend's rate limit) isn't worth
        // failing a sign-in over. A real outage fails the second attempt too.
        const first = await post().catch(() => undefined);
        response =
          first && !retryable(first.status) ? first : await pause().then(post);
      } catch {
        log.error("email.send_failed", { kind: message.kind, provider });
        throw new EmailSendError(provider);
      }
      if (!response.ok) {
        log.error("email.send_failed", {
          kind: message.kind,
          provider,
          status: response.status,
        });
        throw new EmailSendError(provider, response.status);
      }
      log.info("email.sent", { kind: message.kind, provider });
    },
  };
}

const pause = () =>
  new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
