import { type DeleteBeforeResult, deleteBefore, schema } from "@flareling/db";

const { workspaceInvites } = schema;

/**
 * How long an invite is kept after it expires. Long enough for admins to see
 * it as expired and resend it; accepted, declined and revoked invites go at
 * the same time (the audit log keeps what happened to them).
 */
const INVITE_RETENTION_DAYS = 30;

/** Deletes invites that expired more than INVITE_RETENTION_DAYS ago. */
export async function sweepWorkspaceInvites(
  now: Date,
): Promise<DeleteBeforeResult> {
  const cutoff = new Date(
    now.getTime() - INVITE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  return deleteBefore(workspaceInvites, workspaceInvites.expiresAt, cutoff);
}
