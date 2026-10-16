/**
 * Deletes auth rows nothing can use any more, for apps/jobs' daily sweep.
 * Each has an `expires_at` index for exactly this.
 *
 *   - sessions past `expires_at`: loadSession already refuses them, and
 *     deletes one when its cookie comes back, which an abandoned browser's
 *     never does.
 *   - magic links past `expires_at`, used or not: an unknown and an expired
 *     link both answer `invalid`, so deleting one changes nothing a person
 *     sees. Sign-ins stay on record in audit_log.
 *   - WebAuthn ceremonies past `expires_at`: abandoned ones (a dismissed
 *     prompt); finished ones are deleted as they finish.
 */
import { type DeleteBeforeResult, deleteBefore, schema } from "@flareling/db";
import type { Temporal } from "temporal-polyfill";

const { magicLinks, sessions, webauthnChallenges } = schema;

export interface AuthSweepResult {
  readonly sessions: DeleteBeforeResult;
  readonly magicLinks: DeleteBeforeResult;
  readonly webauthnChallenges: DeleteBeforeResult;
}

export async function sweepExpiredAuthRows(
  now: Temporal.Instant,
): Promise<AuthSweepResult> {
  const cutoff = new Date(now.epochMilliseconds);
  return {
    sessions: await deleteBefore(sessions, sessions.expiresAt, cutoff),
    magicLinks: await deleteBefore(magicLinks, magicLinks.expiresAt, cutoff),
    webauthnChallenges: await deleteBefore(
      webauthnChallenges,
      webauthnChallenges.expiresAt,
      cutoff,
    ),
  };
}
