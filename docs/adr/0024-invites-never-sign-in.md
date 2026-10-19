# 0024. Workspace invites never sign anyone in, and hold a seat

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

Team workspaces (ADR 0017) need a way to add people. The usual way is an emailed invite link. Two questions shaped the design:

- **Is the invite link also a sign-in link?** That would be one click for a new person, since the link proves they read that inbox, the same as a magic link does. But an invite has to last days, not the 15 minutes of a magic link (ADR 0019). It would become a week-long credential sitting in an inbox, and anyone it was forwarded to could use it.
- **When does the plan's member limit apply?** Free allows 3 members and Pro 25 (`libs/billing/src/plans.ts`). If only accepting is checked, an admin can send invites that can't be used. If sending is checked too, open invites have to count.

## Decision

**An invite link never creates a session.** `/invite?token=…` shows the invite. To accept, the visitor has to be signed in to an account that has the invited address among its verified emails. A signed-out visitor goes through the normal sign-in for that address, which creates the account if needed, and comes back. Like `/auth/callback`, the page acts only on a button press, never on load. The token is random and stored only as a hash, valid for 7 days. Inviting the same address again resends the invite with a new token.

**Open invites hold seats.** Members plus unexpired open invites can't exceed the plan's `members` entitlement. Accepting checks members against it again, in case the plan shrank. Both checks are inside the write (`INSERT … SELECT … WHERE`), so concurrent requests can't each see room for one more.

**Roles:** invites are for `admin` or `member`, never `owner`. Admins manage admins and members; only owners touch owners. A workspace always keeps at least one owner, enforced in the same UPDATE or DELETE that would remove it. Personal workspaces take no invites.

Seats come from libs/billing, which depends on libs/core, so libs/core's invite functions take an `InviteContext` with a `seats(workspaceId)` callback that the app supplies.

## Consequences

- A new person gets two emails: the invite, then a sign-in link. That's the cost of not issuing week-long credentials.
- A forwarded invite is useless to whoever receives it. Changing which address is invited means revoking and sending a new invite.
- Workspace names appear in invite emails, so they're normalized to one plain line of at most 60 characters. A name can still contain a URL-looking string. The emails are plain text, so it isn't a link, but it could still read like one.
- Invites share sign-in's rate limiter, keyed by inviter. Expired invites stay listed, so they can be resent, until the daily sweep deletes them 30 days after expiry. The audit log records every invite, acceptance, role change and removal, by id only.
