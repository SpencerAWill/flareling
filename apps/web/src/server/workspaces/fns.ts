/**
 * Server functions for workspaces and their members. Thin shells, as in
 * src/server/auth/fns.ts: validate, then call libs/core through a dynamic
 * import, which checks the principal's role itself. Results are values, so
 * pages can say what went wrong; a workspace the principal can't see is
 * `{ ok: false }`, whether or not it exists.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { inviteSchema, newWorkspaceSchema } from "#/lib/schemas.ts";

const workspaceInput = z.object({ workspaceId: z.uuid() });

/**
 * Pushes to the workspace's open tabs (src/server/realtime). Called after a
 * change succeeds; best effort, never failing the change.
 */
const realtime = () => import("../realtime/rooms.server.ts");

async function signedIn() {
  const { getPrincipal } = await import("@flareling/auth");
  const { authContext } = await import("../auth/context.server.ts");
  return getPrincipal(authContext());
}

/**
 * This request's clock: the AuthContext's (`nowOf`), the one libs/auth reads
 * for the same request, so a write and the auth checks around it agree on
 * the time.
 */
async function requestNow() {
  const { nowOf } = await import("@flareling/auth");
  const { authContext } = await import("../auth/context.server.ts");
  return nowOf(authContext());
}

/** Runs `run`, turning a refused or anonymous request into `{ ok: false }`. */
async function unlessRefused<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const { ForbiddenError, UnauthorizedError } = await import("@flareling/auth");
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
      return { ok: false };
    }
    throw err;
  }
}

/** Creates a team workspace owned by the signed-in account. */
export const createWorkspaceFn = createServerFn({ method: "POST" })
  .validator(newWorkspaceSchema)
  .handler(async ({ data }) => {
    const { createWorkspace } = await import("@flareling/core");
    const principal = await signedIn();
    if (!principal)
      return { ok: false as const, reason: "unauthorized" as const };
    return createWorkspace(principal, data.name, await requestNow());
  });

/**
 * Everything the members page shows: the members, for anyone in the
 * workspace, plus open invites and seats for its admins and owners.
 */
export const getMembersFn = createServerFn({ method: "GET" })
  .validator(workspaceInput)
  .handler(async ({ data }) => {
    const { listInvites, listMembers } = await import("@flareling/core");
    const { workspacePlan } = await import("@flareling/billing");
    const principal = await signedIn();
    const result = await unlessRefused(async () => {
      const members = await listMembers(principal, data.workspaceId);
      const role = members.find((m) => m.userId === principal?.userId)?.role;
      const canManage = role === "owner" || role === "admin";
      const [invites, plan] = await Promise.all([
        canManage ? listInvites(principal, data.workspaceId) : [],
        workspacePlan(data.workspaceId),
      ]);
      return { members, invites, role, canManage, plan };
    });
    if (!result.ok) return result;
    const { members, invites, role, canManage, plan } = result.value;
    const now = (await requestNow()).epochMilliseconds;
    return {
      ok: true as const,
      viewerId: principal?.userId ?? "",
      viewerRole: role ?? "member",
      canManage,
      // ISO strings: Start's serializer and the client both handle them.
      members: members.map((m) => ({
        ...m,
        joinedAt: m.joinedAt.toISOString(),
      })),
      invites: invites.map((i) => ({
        ...i,
        sentAt: i.sentAt.toISOString(),
        expired: i.expiresAt.getTime() <= now,
      })),
      seats: {
        limit: plan.entitlements.members,
        // As libs/core counts them: members plus unexpired open invites.
        used:
          members.length +
          invites.filter((i) => i.expiresAt.getTime() > now).length,
      },
    };
  });

/** Emails an invite to join the workspace; resends an open one. */
export const inviteMemberFn = createServerFn({ method: "POST" })
  .validator(workspaceInput.extend(inviteSchema.shape))
  .handler(async ({ data }) => {
    const { inviteMember } = await import("@flareling/core");
    const { errorMessage, log } = await import("@flareling/log");
    const { inviteContext } = await import("./context.server.ts");
    const principal = await signedIn();
    try {
      const result = await unlessRefused(() =>
        inviteMember(inviteContext(), principal, data),
      );
      if (!result.ok)
        return { ok: false as const, reason: "forbidden" as const };
      if (result.value.ok)
        await (await realtime()).membersChanged(data.workspaceId);
      return result.value;
    } catch (err) {
      log.error("workspace.invite_failed", { error: errorMessage(err) });
      return { ok: false as const, reason: "unavailable" as const };
    }
  });

const tokenInput = z.object({ token: z.string().min(16).max(128) });

/** What an invite link opens, or null if it's no longer valid. */
export const getInviteFn = createServerFn({ method: "GET" })
  .validator(tokenInput)
  .handler(async ({ data }) => {
    const { getInvite } = await import("@flareling/core");
    const { inviteContext } = await import("./context.server.ts");
    const invite = await getInvite(inviteContext(), data.token);
    return invite && { ...invite, expiresAt: invite.expiresAt.toISOString() };
  });

export const acceptInviteFn = createServerFn({ method: "POST" })
  .validator(tokenInput)
  .handler(async ({ data }) => {
    const { acceptInvite } = await import("@flareling/core");
    const { inviteContext } = await import("./context.server.ts");
    const principal = await signedIn();
    if (!principal)
      return { ok: false as const, reason: "unauthorized" as const };
    const result = await acceptInvite(inviteContext(), principal, data.token);
    if (result.ok) await (await realtime()).membersChanged(result.workspaceId);
    return result;
  });

export const declineInviteFn = createServerFn({ method: "POST" })
  .validator(tokenInput)
  .handler(async ({ data }) => {
    const { declineInvite } = await import("@flareling/core");
    const { inviteContext } = await import("./context.server.ts");
    const { workspaceId } = await declineInvite(
      inviteContext(),
      await signedIn(),
      data.token,
    );
    if (workspaceId) await (await realtime()).membersChanged(workspaceId);
    // Which workspace it was is for the push, not the browser.
    return { ok: true as const };
  });

const memberInput = workspaceInput.extend({ userId: z.uuid() });

/**
 * Runs a membership change, mapping a refusal to `forbidden`. On success,
 * runs `after` (closing sockets, if any), then tells the workspace's open
 * tabs.
 */
async function membershipChange(
  workspaceId: string,
  run: () => Promise<{ ok: true } | { ok: false; reason: string } | boolean>,
  after?: (rooms: Awaited<ReturnType<typeof realtime>>) => Promise<void>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const refused = await unlessRefused(run);
  if (!refused.ok) return { ok: false, reason: "forbidden" };
  const result =
    typeof refused.value === "boolean"
      ? refused.value
        ? ({ ok: true } as const)
        : ({ ok: false, reason: "not_found" } as const)
      : refused.value;
  if (result.ok) {
    const rooms = await realtime();
    await after?.(rooms);
    await rooms.membersChanged(workspaceId);
  }
  return result;
}

export const changeRoleFn = createServerFn({ method: "POST" })
  .validator(memberInput.extend({ role: z.enum(["owner", "admin", "member"]) }))
  .handler(async ({ data }) => {
    const { changeRole } = await import("@flareling/core");
    const principal = await signedIn();
    return membershipChange(data.workspaceId, () =>
      changeRole(principal, data.workspaceId, data.userId, data.role),
    );
  });

export const removeMemberFn = createServerFn({ method: "POST" })
  .validator(memberInput)
  .handler(async ({ data }) => {
    const { removeMember } = await import("@flareling/core");
    const principal = await signedIn();
    return membershipChange(
      data.workspaceId,
      () => removeMember(principal, data.workspaceId, data.userId),
      (rooms) => rooms.disconnectMember(data.workspaceId, data.userId),
    );
  });

export const leaveWorkspaceFn = createServerFn({ method: "POST" })
  .validator(workspaceInput)
  .handler(async ({ data }) => {
    const { leaveWorkspace } = await import("@flareling/core");
    const principal = await signedIn();
    return membershipChange(
      data.workspaceId,
      () => leaveWorkspace(principal, data.workspaceId),
      async (rooms) => {
        if (principal)
          await rooms.disconnectMember(data.workspaceId, principal.userId);
      },
    );
  });

export const revokeInviteFn = createServerFn({ method: "POST" })
  .validator(workspaceInput.extend({ inviteId: z.uuid() }))
  .handler(async ({ data }) => {
    const { revokeInvite } = await import("@flareling/core");
    const principal = await signedIn();
    const now = await requestNow();
    return membershipChange(data.workspaceId, () =>
      revokeInvite(principal, data.workspaceId, data.inviteId, now),
    );
  });
