/**
 * Inviting people to a team workspace by email.
 *
 * An invite link never signs anyone in. Accepting needs a signed-in account
 * that has the invited address among its verified emails; someone without an
 * account signs up through the normal sign-in first. So a week-long invite
 * isn't a week-long sign-in link, and a forwarded invite can't be used by
 * whoever it was forwarded to.
 *
 * Open invites take seats: members plus unexpired open invites can't exceed
 * the plan's `members` entitlement. Accepting checks again, in case the plan
 * changed. Both checks sit inside the statement that writes, so concurrent
 * requests can't each see room for one more.
 */
import {
  hashToken,
  normalizeEmail,
  type Principal,
  randomToken,
  requirePrincipal,
} from "@flareling/auth";
import {
  getDb,
  isUniqueViolation,
  newId,
  recordAudit,
  schema,
} from "@flareling/db";
import type { EmailSender } from "@flareling/email";
import { and, desc, eq, gt, isNull, or, type SQL, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { requireWorkspaceRole } from "./workspaces.ts";

const { userEmails, workspaceInvites, workspaceMembers, workspaces } = schema;

/** How long an invite can be accepted for. */
export const INVITE_TTL = Temporal.Duration.from({ hours: 24 * 7 });

export type InviteRole = "admin" | "member";

/** What inviting needs from the app, passed in so libs/core stays testable. */
export interface InviteContext {
  /** The app's origin; invite links point here. */
  readonly appBaseUrl: string;
  /** The product name used in emails. */
  readonly appName: string;
  readonly email: EmailSender;
  /**
   * How many members the workspace's plan allows. libs/billing knows, and
   * it depends on libs/core, so the app supplies this.
   */
  seats(workspaceId: string): Promise<number>;
  /** Whether `key` is within its rate limit. Unset skips the check. */
  withinRateLimit?(key: string): Promise<boolean>;
  /** The clock, injectable for tests. */
  readonly now?: () => Temporal.Instant;
}

function nowMs(ctx: InviteContext): number {
  return (ctx.now?.() ?? Temporal.Now.instant()).epochMilliseconds;
}

/** An invite that can still be accepted: not answered, revoked or expired. */
function isOpen(now: number): SQL {
  return and(
    isNull(workspaceInvites.acceptedAt),
    isNull(workspaceInvites.declinedAt),
    isNull(workspaceInvites.revokedAt),
    gt(workspaceInvites.expiresAt, new Date(now)),
  ) as SQL;
}

/** Members plus unexpired open invites, as a scalar subquery. */
function seatsTaken(workspaceId: string, now: number): SQL {
  return sql`(
    (SELECT count(*) FROM workspace_members WHERE workspace_id = ${workspaceId})
    + (SELECT count(*) FROM workspace_invites
       WHERE workspace_id = ${workspaceId}
         AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
         AND expires_at > ${now})
  )`;
}

export type InviteResult =
  | { readonly ok: true; readonly inviteId: string; readonly resent: boolean }
  | {
      readonly ok: false;
      readonly reason:
        | "personal"
        | "already_member"
        | "seats_full"
        | "rate_limited";
    };

/**
 * Emails an invite to join the workspace as `role`. Admins and owners may
 * invite. Inviting an address that already has an open invite resends it:
 * a new link (the old one stops working), a new expiry, and the new role.
 */
export async function inviteMember(
  ctx: InviteContext,
  principal: Principal | null,
  request: {
    readonly workspaceId: string;
    readonly email: string;
    readonly role: InviteRole;
  },
): Promise<InviteResult> {
  // Abuse guards run before database work.
  const { userId } = requirePrincipal(principal);
  if (ctx.withinRateLimit && !(await ctx.withinRateLimit(`invite:${userId}`))) {
    return { ok: false, reason: "rate_limited" };
  }
  const { principal: inviter } = await requireWorkspaceRole(
    principal,
    request.workspaceId,
    "admin",
  );

  const db = getDb();
  const email = normalizeEmail(request.email);
  const [[[workspace], [existing]], seats] = await Promise.all([
    db.batch([
      db
        .select({
          name: workspaces.name,
          personalUserId: workspaces.personalUserId,
        })
        .from(workspaces)
        .where(eq(workspaces.id, request.workspaceId)),
      db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .innerJoin(userEmails, eq(userEmails.userId, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, request.workspaceId),
            eq(userEmails.email, email),
          ),
        ),
    ]),
    ctx.seats(request.workspaceId),
  ]);
  if (!workspace) throw new Error("workspace vanished after the role check");
  if (workspace.personalUserId !== null)
    return { ok: false, reason: "personal" };
  if (existing) return { ok: false, reason: "already_member" };

  const token = randomToken();
  const tokenHash = await hashToken(token);
  const now = nowMs(ctx);
  const expiresAt = now + INVITE_TTL.total("milliseconds");

  const written = await writeInvite({
    workspaceId: request.workspaceId,
    email,
    role: request.role,
    tokenHash,
    invitedBy: inviter.userId,
    now,
    expiresAt,
    seats,
  });
  if (!written) return { ok: false, reason: "seats_full" };

  const url = new URL("/invite", ctx.appBaseUrl);
  url.searchParams.set("token", token);
  await ctx.email.send({
    kind: "workspace.invite",
    to: email,
    subject: `You're invited to join ${workspace.name} on ${ctx.appName}`,
    text: [
      `${inviter.primaryEmail} invited you to join the workspace "${workspace.name}" on ${ctx.appName} as ${request.role === "admin" ? "an admin" : "a member"}.`,
      "",
      `Accept or decline here. The invite expires in ${INVITE_TTL.total("days")} days.`,
      "",
      url.toString(),
      "",
      "If you weren't expecting it, you can ignore this email.",
    ].join("\n"),
  });

  await recordAudit({
    action: "workspace.member_invited",
    actorId: inviter.userId,
    targetType: "workspace",
    targetId: request.workspaceId,
    at: new Date(now),
    metadata: {
      inviteId: written.id,
      role: request.role,
      resent: written.resent,
    },
  });
  return { ok: true, inviteId: written.id, resent: written.resent };
}

/**
 * Resends the address's open invite, or creates one if there's a seat for
 * it. A resend of an expired invite needs a seat too, since an expired
 * invite doesn't hold one. Null when there's no seat.
 */
async function writeInvite(invite: {
  workspaceId: string;
  email: string;
  role: InviteRole;
  tokenHash: string;
  invitedBy: string;
  now: number;
  expiresAt: number;
  seats: number;
}): Promise<{ id: string; resent: boolean } | null> {
  const db = getDb();
  const resend = () =>
    db
      .update(workspaceInvites)
      .set({
        role: invite.role,
        tokenHash: invite.tokenHash,
        invitedBy: invite.invitedBy,
        createdAt: new Date(invite.now),
        expiresAt: new Date(invite.expiresAt),
      })
      .where(
        and(
          eq(workspaceInvites.workspaceId, invite.workspaceId),
          eq(workspaceInvites.email, invite.email),
          isNull(workspaceInvites.acceptedAt),
          isNull(workspaceInvites.declinedAt),
          isNull(workspaceInvites.revokedAt),
          or(
            gt(workspaceInvites.expiresAt, new Date(invite.now)),
            sql`${seatsTaken(invite.workspaceId, invite.now)} < ${invite.seats}`,
          ),
        ),
      )
      .returning({ id: workspaceInvites.id });

  const [resent] = await resend();
  if (resent) return { id: resent.id, resent: true };

  const id = newId();
  try {
    // INSERT ... SELECT lists every column in table order.
    const [created] = await db
      .insert(workspaceInvites)
      .select(sql`
        SELECT ${id}, ${invite.workspaceId}, ${invite.email}, ${invite.role},
          ${invite.tokenHash}, ${invite.invitedBy}, ${invite.now},
          ${invite.expiresAt}, NULL, NULL, NULL
        WHERE ${seatsTaken(invite.workspaceId, invite.now)} < ${invite.seats}`)
      .returning({ id: workspaceInvites.id });
    return created ? { id: created.id, resent: false } : null;
  } catch (err) {
    // An open invite for this address already exists: a concurrent invite
    // created it, or it's expired and the workspace is full. Resending
    // settles which.
    if (!isUniqueViolation(err, "workspace_invites.workspace_id")) throw err;
    const [again] = await resend();
    return again ? { id: again.id, resent: true } : null;
  }
}

export interface InviteDetails {
  readonly workspaceName: string;
  /** The address it was sent to. */
  readonly email: string;
  readonly role: InviteRole;
  /** The inviter's primary address, or null if their account is gone. */
  readonly invitedBy: string | null;
  readonly expiresAt: Date;
}

/**
 * The invite `token` opens, for its page, or null. Unknown, expired,
 * answered and revoked invites are all null, so the page can't tell them
 * apart. Anyone holding the link may see it: they were sent it.
 */
export async function getInvite(
  ctx: InviteContext,
  token: string,
): Promise<InviteDetails | null> {
  const [row] = await getDb()
    .select({
      workspaceName: workspaces.name,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      invitedBy: userEmails.email,
      expiresAt: workspaceInvites.expiresAt,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .leftJoin(
      userEmails,
      and(
        eq(userEmails.userId, workspaceInvites.invitedBy),
        eq(userEmails.isPrimary, true),
      ),
    )
    .where(
      and(
        eq(workspaceInvites.tokenHash, await hashToken(token)),
        isOpen(nowMs(ctx)),
      ),
    );
  return row ?? null;
}

export type AcceptResult =
  | {
      readonly ok: true;
      readonly workspaceId: string;
      /** Already a member (another invite, or a second click); nothing changed. */
      readonly alreadyMember: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "wrong_account" | "workspace_full";
    };

/**
 * Joins the principal to the invite's workspace, if one of their verified
 * addresses is the invited one. One batch adds the member (if there's a
 * seat) and marks the invite accepted (if the member is there), each
 * statement re-checking the invite, so a revoke or a second accept racing
 * this one can't half-apply.
 */
export async function acceptInvite(
  ctx: InviteContext,
  principal: Principal | null,
  token: string,
): Promise<AcceptResult> {
  const p = requirePrincipal(principal);
  const { userId } = p;
  const db = getDb();
  const now = nowMs(ctx);
  const tokenHash = await hashToken(token);

  const [invite] = await db
    .select({
      id: workspaceInvites.id,
      workspaceId: workspaceInvites.workspaceId,
      email: workspaceInvites.email,
    })
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.tokenHash, tokenHash), isOpen(now)));
  if (!invite) return { ok: false, reason: "invalid" };

  const seats = await ctx.seats(invite.workspaceId);
  const [added, accepted] = await db.batch([
    db
      .insert(workspaceMembers)
      .select(sql`
        SELECT workspace_id, ${userId}, role, ${now} FROM workspace_invites
        WHERE id = ${invite.id}
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
          AND expires_at > ${now}
          AND email IN (SELECT email FROM user_emails WHERE user_id = ${userId})
          AND (SELECT count(*) FROM workspace_members
               WHERE workspace_id = ${invite.workspaceId}) < ${seats}`)
      .onConflictDoNothing()
      .returning({ userId: workspaceMembers.userId }),
    db
      .update(workspaceInvites)
      .set({ acceptedAt: new Date(now) })
      .where(
        and(
          eq(workspaceInvites.id, invite.id),
          isOpen(now),
          sql`${workspaceInvites.email} IN (SELECT email FROM user_emails WHERE user_id = ${userId})`,
          sql`EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${invite.workspaceId} AND user_id = ${userId})`,
        ),
      )
      .returning({ role: workspaceInvites.role }),
  ]);

  const [acceptedAs] = accepted;
  if (!acceptedAs) {
    if (!p.emails.includes(invite.email))
      return { ok: false, reason: "wrong_account" };
    // Nothing was written: either there was no seat, or the invite closed
    // (revoked, declined, accepted elsewhere) since it was read.
    const [stillOpen] = await db
      .select({ id: workspaceInvites.id })
      .from(workspaceInvites)
      .where(and(eq(workspaceInvites.id, invite.id), isOpen(now)));
    return { ok: false, reason: stillOpen ? "workspace_full" : "invalid" };
  }

  await recordAudit({
    action: "workspace.invite_accepted",
    actorId: userId,
    targetType: "workspace",
    targetId: invite.workspaceId,
    at: new Date(now),
    metadata: {
      inviteId: invite.id,
      // An existing member keeps their role, so the invite's grants nothing.
      role: added.length === 0 ? null : acceptedAs.role,
      alreadyMember: added.length === 0,
    },
  });
  return {
    ok: true,
    workspaceId: invite.workspaceId,
    alreadyMember: added.length === 0,
  };
}

/**
 * Declines the invite `token` opens. Anyone holding the link may decline it,
 * signed in or not: it's a button on the invite page, never a page load, so
 * an email scanner can't. Unknown and closed invites are a no-op. Returns
 * the workspace whose invite was declined, for the app to notify; it's not
 * for the browser.
 */
export async function declineInvite(
  ctx: InviteContext,
  principal: Principal | null,
  token: string,
): Promise<{ ok: true; workspaceId: string | null }> {
  const now = nowMs(ctx);
  const [declined] = await getDb()
    .update(workspaceInvites)
    .set({ declinedAt: new Date(now) })
    .where(
      and(eq(workspaceInvites.tokenHash, await hashToken(token)), isOpen(now)),
    )
    .returning({
      id: workspaceInvites.id,
      workspaceId: workspaceInvites.workspaceId,
    });
  if (declined) {
    await recordAudit({
      action: "workspace.invite_declined",
      actorId: principal?.userId ?? null,
      targetType: "workspace",
      targetId: declined.workspaceId,
      metadata: { inviteId: declined.id },
      at: new Date(now),
    });
  }
  return { ok: true, workspaceId: declined?.workspaceId ?? null };
}

export interface PendingInvite {
  readonly id: string;
  readonly email: string;
  readonly role: InviteRole;
  readonly sentAt: Date;
  readonly expiresAt: Date;
}

/**
 * The workspace's open invites, newest first, for its admins. Expired ones
 * are included (they can be resent) until the sweep deletes them.
 */
export async function listInvites(
  principal: Principal | null,
  workspaceId: string,
): Promise<PendingInvite[]> {
  await requireWorkspaceRole(principal, workspaceId, "admin");
  return getDb()
    .select({
      id: workspaceInvites.id,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      sentAt: workspaceInvites.createdAt,
      expiresAt: workspaceInvites.expiresAt,
    })
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        isNull(workspaceInvites.acceptedAt),
        isNull(workspaceInvites.declinedAt),
        isNull(workspaceInvites.revokedAt),
      ),
    )
    .orderBy(desc(workspaceInvites.createdAt));
}
