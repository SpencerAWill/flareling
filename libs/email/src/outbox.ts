/**
 * The outbox: where a deployed dev environment's email goes instead of an
 * inbox (docs/adr/0022-dev-email-outbox.md). apps/web shows it at
 * /dev/outbox, behind Cloudflare Access.
 *
 * Rows hold working sign-in links, so they're kept for a day only: links
 * expire long before that, and `listOutbox` prunes older rows on every read
 * (deployed Workers on Workers Free have no cron for a sweep).
 */
import { deleteBefore, getDb, schema } from "@flareling/db";
import { desc } from "drizzle-orm";
import type { EmailMessage } from "./email.ts";

const { emailOutbox } = schema;

const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface OutboxEmail {
  readonly id: string;
  readonly kind: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly createdAt: Date;
}

export async function storeInOutbox(
  message: EmailMessage,
  now: Date = new Date(),
): Promise<void> {
  await getDb()
    .insert(emailOutbox)
    .values({
      kind: message.kind,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html ?? null,
      createdAt: now,
    });
}

/** Deletes outbox rows older than a day. */
export function sweepEmailOutbox(now: Date = new Date()) {
  return deleteBefore(
    emailOutbox,
    emailOutbox.createdAt,
    new Date(now.getTime() - RETENTION_MS),
  );
}

/** The newest emails, after pruning old ones. */
export async function listOutbox({
  limit = 50,
  now = new Date(),
}: {
  limit?: number;
  now?: Date;
} = {}): Promise<OutboxEmail[]> {
  await sweepEmailOutbox(now);
  return getDb()
    .select({
      id: emailOutbox.id,
      kind: emailOutbox.kind,
      to: emailOutbox.to,
      subject: emailOutbox.subject,
      text: emailOutbox.text,
      createdAt: emailOutbox.createdAt,
    })
    .from(emailOutbox)
    .orderBy(desc(emailOutbox.createdAt))
    .limit(limit);
}
