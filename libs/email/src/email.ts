/**
 * Sending email, behind an interface so the provider can be chosen later
 * (docs/adr/0015-email-behind-an-interface.md). Today the only implementation
 * is Mailpit, the dev container's inbox. A provider adds one implementation
 * here and one branch in `createEmailSender`.
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
}

/** No email transport is configured, so nothing can be sent. */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "No email transport is configured. Set MAILPIT_URL for local development.",
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
  return {
    send: () => Promise.reject(new EmailNotConfiguredError()),
  };
}

/** Mailpit's HTTP send API (`POST /api/v1/send`). */
function mailpitSender(baseUrl: string, config: EmailConfig): EmailSender {
  const endpoint = new URL("/api/v1/send", baseUrl);
  return {
    async send(message) {
      const post = () =>
        fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            From: { Email: config.from, Name: config.fromName ?? "" },
            To: [{ Email: message.to }],
            Subject: message.subject,
            Text: message.text,
            ...(message.html === undefined ? {} : { HTML: message.html }),
          }),
        });
      let response: Response;
      try {
        // One retry on a network error: Mailpit is a local sidecar, and a
        // dropped connection under parallel E2E load isn't worth failing a
        // sign-in over. A real outage fails the second attempt too.
        response = await post().catch(() => post());
      } catch {
        log.error("email.send_failed", {
          kind: message.kind,
          provider: "mailpit",
        });
        throw new EmailSendError("mailpit");
      }
      // Consumed either way: an unread body holds the connection open.
      await response.text();
      if (!response.ok) {
        log.error("email.send_failed", {
          kind: message.kind,
          provider: "mailpit",
          status: response.status,
        });
        throw new EmailSendError("mailpit", response.status);
      }
      log.info("email.sent", { kind: message.kind, provider: "mailpit" });
    },
  };
}
