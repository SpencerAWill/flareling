import type { Principal } from "@flareling/auth";
import { getDb, newId, schema } from "@flareling/db";
import type { EmailSender } from "@flareling/email";
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { addMember, createUser } from "../test/users.ts";
import {
  acceptInvite,
  createWorkspace,
  declineInvite,
  ensurePersonalWorkspace,
  getInvite,
  type InviteContext,
  inviteMember,
  listInvites,
  listMembers,
} from "./index.ts";

interface TestInviteContext extends InviteContext {
  readonly sent: Parameters<EmailSender["send"]>[0][];
  advance(duration: Temporal.DurationLike): void;
  setSeats(seats: number): void;
}

/** Where every test's clock starts. */
const START = Temporal.Instant.from("2026-10-19T12:00:00Z");

function inviteContext(
  options: { seats?: number; withinRateLimit?: () => Promise<boolean> } = {},
): TestInviteContext {
  let now = START;
  let seats = options.seats ?? 25;
  const sent: Parameters<EmailSender["send"]>[0][] = [];
  return {
    appBaseUrl: "http://localhost:3000",
    appName: "Flareling",
    email: { send: async (message) => void sent.push(message) },
    seats: async () => seats,
    ...(options.withinRateLimit
      ? { withinRateLimit: options.withinRateLimit }
      : {}),
    now: () => now,
    sent,
    advance(duration) {
      now = now.add(duration);
    },
    setSeats(n) {
      seats = n;
    },
  };
}

/** The token from the newest invite email to `to`. */
function tokenSentTo(ctx: TestInviteContext, to: string): string {
  const message = ctx.sent.findLast((m) => m.to === to);
  const url = message?.text.match(/https?:\/\/\S+/)?.[0];
  const token = url && new URL(url).searchParams.get("token");
  if (!token) throw new Error(`no invite link sent to ${to}`);
  return token;
}

async function team(name = "Acme") {
  const owner = await createUser();
  // An hour before the tests' clocks start, so the owner joined first.
  const result = await createWorkspace(
    owner,
    name,
    START.subtract({ hours: 1 }),
  );
  if (!result.ok) throw new Error("setup: workspace not created");
  return { owner, workspaceId: result.id };
}

async function invite(
  ctx: TestInviteContext,
  inviter: Principal,
  workspaceId: string,
  email: string,
  role: "admin" | "member" = "member",
) {
  return inviteMember(ctx, inviter, { workspaceId, email, role });
}

describe("inviting and accepting", () => {
  it("emails a link that the invited person accepts to join with the invited role", async () => {
    const ctx = inviteContext();
    const { owner, workspaceId } = await team("Acme");
    const invitee = await createUser("new.person@example.com");

    expect(
      await invite(
        ctx,
        owner,
        workspaceId,
        " New.Person@Example.com ",
        "admin",
      ),
    ).toEqual({ ok: true, inviteId: expect.any(String), resent: false });

    const [email] = ctx.sent;
    expect(email).toMatchObject({
      kind: "workspace.invite",
      to: "new.person@example.com",
      subject: "You're invited to join Acme on Flareling",
    });
    expect(email?.text).toContain(`${owner.primaryEmail} invited you`);
    expect(email?.text).toContain("as an admin");
    expect(email?.text).toContain("http://localhost:3000/invite?token=");

    const token = tokenSentTo(ctx, "new.person@example.com");
    expect(await getInvite(ctx, token)).toEqual({
      workspaceName: "Acme",
      email: "new.person@example.com",
      role: "admin",
      invitedBy: owner.primaryEmail,
      expiresAt: new Date("2026-10-26T12:00:00Z"),
    });

    ctx.advance({ minutes: 5 });
    expect(await acceptInvite(ctx, invitee, token)).toEqual({
      ok: true,
      workspaceId,
      alreadyMember: false,
    });
    // Joined on the context's clock, not the database's.
    const joined = (await listMembers(owner, workspaceId)).find(
      (m) => m.userId === invitee.userId,
    );
    expect(joined?.joinedAt).toEqual(new Date("2026-10-19T12:05:00Z"));
    expect(
      (await listMembers(owner, workspaceId)).map((m) => [m.email, m.role]),
    ).toEqual([
      [owner.primaryEmail, "owner"],
      ["new.person@example.com", "admin"],
    ]);
    // Used up.
    expect(await getInvite(ctx, token)).toBeNull();
    expect(await acceptInvite(ctx, invitee, token)).toEqual({
      ok: false,
      reason: "invalid",
    });

    const actions = await getDb()
      .select({
        action: schema.auditLog.action,
        metadata: schema.auditLog.metadataJson,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, workspaceId));
    expect(actions.map((a) => a.action)).toEqual([
      "workspace.created",
      "workspace.member_invited",
      "workspace.invite_accepted",
    ]);
    // Ids and roles only: the invited address stays out of the audit log.
    expect(JSON.stringify(actions)).not.toContain("new.person");
  });

  it("lets an admin invite, but not a member", async () => {
    const ctx = inviteContext();
    const { workspaceId } = await team();
    const admin = await createUser();
    const member = await createUser();
    await addMember(workspaceId, admin.userId, "admin");
    await addMember(workspaceId, member.userId, "member");

    expect(
      await invite(ctx, admin, workspaceId, "a@example.com"),
    ).toMatchObject({ ok: true });
    await expect(
      invite(ctx, member, workspaceId, "b@example.com"),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(
      invite(ctx, await createUser(), workspaceId, "c@example.com"),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("refuses personal workspaces and people who are already members", async () => {
    const ctx = inviteContext();
    const owner = await createUser();
    const personal = await ensurePersonalWorkspace(owner.userId);
    expect(await invite(ctx, owner, personal, "a@example.com")).toEqual({
      ok: false,
      reason: "personal",
    });

    const { owner: teamOwner, workspaceId } = await team();
    const member = await createUser("member@example.com");
    await addMember(workspaceId, member.userId, "member");
    expect(
      await invite(ctx, teamOwner, workspaceId, "MEMBER@example.com"),
    ).toEqual({ ok: false, reason: "already_member" });
    expect(ctx.sent).toEqual([]);
  });

  it("resends an open invite with a new link, expiry and role", async () => {
    const ctx = inviteContext();
    const { owner, workspaceId } = await team();
    const invitee = await createUser("again@example.com");

    const first = await invite(ctx, owner, workspaceId, "again@example.com");
    const oldToken = tokenSentTo(ctx, "again@example.com");
    ctx.advance({ hours: 24 * 6 });
    const second = await invite(
      ctx,
      owner,
      workspaceId,
      "again@example.com",
      "admin",
    );
    expect(second).toEqual({
      ok: true,
      inviteId: first.ok ? first.inviteId : "",
      resent: true,
    });

    expect(await getInvite(ctx, oldToken)).toBeNull();
    const newToken = tokenSentTo(ctx, "again@example.com");
    // A week from the resend, not from the first send.
    ctx.advance({ hours: 24 * 3 });
    expect(await getInvite(ctx, newToken)).toMatchObject({ role: "admin" });
    expect(await acceptInvite(ctx, invitee, newToken)).toMatchObject({
      ok: true,
    });
  });

  it("can't be accepted by an account without the invited address", async () => {
    const ctx = inviteContext();
    const { owner, workspaceId } = await team();
    await invite(ctx, owner, workspaceId, "intended@example.com");
    const token = tokenSentTo(ctx, "intended@example.com");

    const someoneElse = await createUser("someone.else@example.com");
    expect(await acceptInvite(ctx, someoneElse, token)).toEqual({
      ok: false,
      reason: "wrong_account",
    });
    // Still open for the right person.
    expect(await getInvite(ctx, token)).not.toBeNull();
    await expect(acceptInvite(ctx, null, token)).rejects.toMatchObject({
      name: "UnauthorizedError",
    });
  });

  it("accepts for an account that has the invited address as a second email", async () => {
    const ctx = inviteContext();
    const { owner, workspaceId } = await team();
    const invitee = await createUser("primary@example.com");
    await getDb().insert(schema.userEmails).values({
      userId: invitee.userId,
      email: "secondary@example.com",
      isPrimary: false,
      verifiedAt: new Date(),
    });
    await invite(ctx, owner, workspaceId, "secondary@example.com");

    expect(
      await acceptInvite(
        ctx,
        { ...invitee, emails: [...invitee.emails, "secondary@example.com"] },
        tokenSentTo(ctx, "secondary@example.com"),
      ),
    ).toMatchObject({ ok: true, alreadyMember: false });
  });

  it("joins once when someone accepts two invites to the same workspace", async () => {
    const ctx = inviteContext();
    const { owner, workspaceId } = await team();
    const invitee = await createUser("one@example.com");
    await getDb().insert(schema.userEmails).values({
      userId: invitee.userId,
      email: "two@example.com",
      isPrimary: false,
      verifiedAt: new Date(),
    });
    const both = { ...invitee, emails: ["one@example.com", "two@example.com"] };
    await invite(ctx, owner, workspaceId, "one@example.com", "member");
    await invite(ctx, owner, workspaceId, "two@example.com", "admin");

    expect(
      await acceptInvite(ctx, both, tokenSentTo(ctx, "one@example.com")),
    ).toMatchObject({ ok: true, alreadyMember: false });
    expect(
      await acceptInvite(ctx, both, tokenSentTo(ctx, "two@example.com")),
    ).toMatchObject({ ok: true, alreadyMember: true });
    // The first role stands; a second invite doesn't promote anyone, and
    // the audit doesn't claim it did.
    const members = await listMembers(owner, workspaceId);
    expect(members.find((m) => m.userId === invitee.userId)?.role).toBe(
      "member",
    );
    const accepted = await getDb()
      .select({ metadata: schema.auditLog.metadataJson })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.targetId, workspaceId),
          eq(schema.auditLog.action, "workspace.invite_accepted"),
        ),
      );
    expect(accepted.map((a) => JSON.parse(a.metadata ?? "{}"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "member", alreadyMember: false }),
        expect.objectContaining({ role: null, alreadyMember: true }),
      ]),
    );
  });

  it("expires after a week", async () => {
    const ctx = inviteContext();
    const { owner, workspaceId } = await team();
    const invitee = await createUser("late@example.com");
    await invite(ctx, owner, workspaceId, "late@example.com");
    const token = tokenSentTo(ctx, "late@example.com");

    ctx.advance({ hours: 24 * 7 });
    expect(await getInvite(ctx, token)).toBeNull();
    expect(await acceptInvite(ctx, invitee, token)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses unknown tokens", async () => {
    const ctx = inviteContext();
    expect(await getInvite(ctx, "not-a-real-token")).toBeNull();
    expect(
      await acceptInvite(ctx, await createUser(), "not-a-real-token"),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("is rate limited per inviter", async () => {
    const ctx = inviteContext({ withinRateLimit: async () => false });
    const { owner, workspaceId } = await team();
    expect(await invite(ctx, owner, workspaceId, "a@example.com")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(ctx.sent).toEqual([]);
  });
});

describe("seats", () => {
  it("counts open invites, so a full workspace can't send more", async () => {
    const ctx = inviteContext({ seats: 3 });
    const { owner, workspaceId } = await team();
    // The owner holds one seat; two invites take the rest.
    for (const email of ["a@example.com", "b@example.com"]) {
      expect(await invite(ctx, owner, workspaceId, email)).toMatchObject({
        ok: true,
      });
    }
    expect(await invite(ctx, owner, workspaceId, "c@example.com")).toEqual({
      ok: false,
      reason: "seats_full",
    });
    // Resending one already counted needs no extra seat.
    expect(
      await invite(ctx, owner, workspaceId, "a@example.com"),
    ).toMatchObject({ ok: true, resent: true });
  });

  it("frees an expired invite's seat, and resends it only if there's room", async () => {
    const ctx = inviteContext({ seats: 2 });
    const { owner, workspaceId } = await team();
    await invite(ctx, owner, workspaceId, "first@example.com");
    ctx.advance({ hours: 24 * 7 });

    expect(
      await invite(ctx, owner, workspaceId, "second@example.com"),
    ).toMatchObject({ ok: true });
    // The workspace is full again, so the expired invite can't come back.
    expect(await invite(ctx, owner, workspaceId, "first@example.com")).toEqual({
      ok: false,
      reason: "seats_full",
    });
  });

  it("can't be raced past the limit", async () => {
    const ctx = inviteContext({ seats: 2 });
    const { owner, workspaceId } = await team();
    const results = await Promise.all(
      ["r1", "r2", "r3"].map((name) =>
        invite(ctx, owner, workspaceId, `${name}@example.com`),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("checks again on accept, in case the plan shrank", async () => {
    const ctx = inviteContext({ seats: 3 });
    const { owner, workspaceId } = await team();
    const invitee = await createUser("downgraded@example.com");
    await invite(ctx, owner, workspaceId, "downgraded@example.com");
    ctx.setSeats(1);

    const token = tokenSentTo(ctx, "downgraded@example.com");
    expect(await acceptInvite(ctx, invitee, token)).toEqual({
      ok: false,
      reason: "workspace_full",
    });
    // Still open, for when there's room again.
    ctx.setSeats(3);
    expect(await acceptInvite(ctx, invitee, token)).toMatchObject({
      ok: true,
    });
  });
});

describe("declineInvite", () => {
  it("closes the invite for anyone holding the link, signed in or not", async () => {
    const ctx = inviteContext();
    const { owner, workspaceId } = await team();
    const invitee = await createUser("no.thanks@example.com");
    await invite(ctx, owner, workspaceId, "no.thanks@example.com");
    const token = tokenSentTo(ctx, "no.thanks@example.com");

    expect(await declineInvite(ctx, null, token)).toEqual({
      ok: true,
      workspaceId,
    });
    expect(await getInvite(ctx, token)).toBeNull();
    expect(await acceptInvite(ctx, invitee, token)).toEqual({
      ok: false,
      reason: "invalid",
    });
    const [declined] = await getDb()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.targetId, workspaceId),
          eq(schema.auditLog.action, "workspace.invite_declined"),
        ),
      );
    expect(declined?.actorId).toBeNull();

    // Declining frees the address for a fresh invite.
    expect(
      await invite(ctx, owner, workspaceId, "no.thanks@example.com"),
    ).toMatchObject({ ok: true, resent: false });
  });

  it("does nothing for an unknown token", async () => {
    expect(await declineInvite(inviteContext(), null, newId())).toEqual({
      ok: true,
      workspaceId: null,
    });
  });
});

describe("listInvites", () => {
  it("lists open invites newest first, expired ones included, for admins only", async () => {
    const ctx = inviteContext();
    const { owner, workspaceId } = await team();
    const member = await createUser();
    await addMember(workspaceId, member.userId, "member");
    await invite(ctx, owner, workspaceId, "older@example.com");
    ctx.advance({ hours: 24 * 8 });
    await invite(ctx, owner, workspaceId, "newer@example.com", "admin");
    await invite(ctx, owner, workspaceId, "accepted@example.com");
    await acceptInvite(
      ctx,
      await createUser("accepted@example.com"),
      tokenSentTo(ctx, "accepted@example.com"),
    );

    expect(
      (await listInvites(owner, workspaceId)).map((i) => [i.email, i.role]),
    ).toEqual([
      ["newer@example.com", "admin"],
      ["older@example.com", "member"],
    ]);
    await expect(listInvites(member, workspaceId)).rejects.toMatchObject({
      name: "ForbiddenError",
    });
  });
});
