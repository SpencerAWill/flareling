import { Button } from "@flareling/ui";
import {
  createFileRoute,
  getRouteApi,
  Link,
  notFound,
  useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useId, useState } from "react";
import { LeaveWorkspace, MemberRow } from "#/components/member-row.tsx";
import { ROLE_NAMES, workspaceTitle } from "#/lib/workspaces.ts";
import {
  getMembersFn,
  inviteMemberFn,
  revokeInviteFn,
} from "#/server/workspaces/fns.ts";

const workspaceRoute = getRouteApi("/w/$workspaceId");

export const Route = createFileRoute("/w/$workspaceId/members")({
  loader: async ({ params }) => {
    const result = await getMembersFn({
      data: { workspaceId: params.workspaceId },
    }).catch(() => ({ ok: false as const }));
    // Non-members, unknown ids and malformed ids all look the same.
    if (!result.ok) throw notFound();
    return result;
  },
  head: ({ matches }) => ({
    meta: [{ title: `Members · ${workspaceTitle(matches)} · Flareling` }],
  }),
  component: Members,
});

function Members() {
  const { workspace } = workspaceRoute.useLoaderData();
  const { members, invites, canManage, seats, viewerId, viewerRole } =
    Route.useLoaderData();
  const full = seats.used >= seats.limit;

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Members of {workspace.name}</h1>
      {workspace.personal ? (
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          Your personal workspace is just for you. To work with other people,
          create a team workspace from your account page.
        </p>
      ) : (
        canManage && (
          <section
            aria-labelledby="invite-heading"
            className="flex flex-col gap-3"
          >
            <h2 id="invite-heading" className="text-lg font-semibold">
              Invite someone
            </h2>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              {seats.used} of {seats.limit} seats used, counting open invites.{" "}
              {full && (
                <>
                  To invite more people, revoke an invite, remove someone, or{" "}
                  <Link
                    to="/w/$workspaceId/billing"
                    params={{ workspaceId: workspace.id }}
                    className="underline"
                  >
                    upgrade the plan
                  </Link>
                  .
                </>
              )}
            </p>
            {!full && <InviteForm workspaceId={workspace.id} />}
          </section>
        )
      )}

      <section
        aria-labelledby="members-heading"
        className="flex flex-col gap-2"
      >
        <h2 id="members-heading" className="text-lg font-semibold">
          {members.length} {members.length === 1 ? "member" : "members"}
        </h2>
        <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
          {members.map((member) => (
            <MemberRow
              key={member.userId}
              workspaceId={workspace.id}
              member={member}
              viewerId={viewerId}
              viewerRole={viewerRole}
              personal={workspace.personal}
            />
          ))}
        </ul>
      </section>

      {canManage && invites.length > 0 && (
        <section
          aria-labelledby="invites-heading"
          className="flex flex-col gap-2"
        >
          <h2 id="invites-heading" className="text-lg font-semibold">
            Open invites
          </h2>
          <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
            {invites.map((invite) => (
              <PendingInvite
                key={invite.id}
                workspaceId={workspace.id}
                invite={invite}
              />
            ))}
          </ul>
        </section>
      )}

      {!workspace.personal && (
        <LeaveWorkspace
          workspaceId={workspace.id}
          workspaceName={workspace.name}
        />
      )}
    </main>
  );
}

const INVITE_ERRORS: Record<string, string> = {
  already_member: "They're already a member.",
  seats_full: "The workspace is full.",
  rate_limited: "That's a lot of invites at once. Wait a minute and try again.",
  forbidden: "Only the workspace's owners and admins can invite people.",
  personal: "Your personal workspace is just for you.",
  unavailable: "The invite couldn't be sent. Try again in a moment.",
};

function useInvite(workspaceId: string) {
  const invite = useServerFn(inviteMemberFn);
  const router = useRouter();
  return async (email: string, role: "admin" | "member") => {
    const result = await invite({ data: { workspaceId, email, role } }).catch(
      () => ({ ok: false as const, reason: "unavailable" as const }),
    );
    if (result.ok) await router.invalidate();
    return result;
  };
}

function InviteForm({ workspaceId }: { workspaceId: string }) {
  const invite = useInvite(workspaceId);
  const roleId = useId();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<
    { kind: "sent"; email: string } | { kind: "error"; message: string } | null
  >(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get("email") ?? "").trim();
    const role = fields.get("role") === "admin" ? "admin" : "member";
    setPending(true);
    setStatus(null);
    const result = await invite(email, role);
    setPending(false);
    if (result.ok) {
      form.reset();
      setStatus({ kind: "sent", email });
    } else {
      setStatus({
        kind: "error",
        message:
          INVITE_ERRORS[result.reason] ?? INVITE_ERRORS.unavailable ?? "",
      });
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <label className="flex grow flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>
      {/* Labelled by id: a wrapping label's name would include the
          selected option. */}
      <div className="flex flex-col gap-1">
        <label htmlFor={roleId} className="text-sm font-medium">
          Role
        </label>
        <select
          id={roleId}
          name="role"
          defaultValue="member"
          className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        Send invite
      </Button>
      {status?.kind === "sent" && (
        <p role="status" className="w-full text-sm">
          Invite sent to {status.email}.
        </p>
      )}
      {status?.kind === "error" && (
        <p
          role="alert"
          className="w-full text-sm text-red-700 dark:text-red-400"
        >
          {status.message}
        </p>
      )}
    </form>
  );
}

function PendingInvite({
  workspaceId,
  invite,
}: {
  workspaceId: string;
  invite: {
    id: string;
    email: string;
    role: "admin" | "member";
    sentAt: string;
    expired: boolean;
  };
}) {
  const resend = useInvite(workspaceId);
  const revoke = useServerFn(revokeInviteFn);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = new Date(invite.sentAt).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });

  async function onResend() {
    setPending(true);
    setError(null);
    const result = await resend(invite.email, invite.role);
    setPending(false);
    if (!result.ok) {
      setError(INVITE_ERRORS[result.reason] ?? INVITE_ERRORS.unavailable ?? "");
    }
  }

  async function onRevoke() {
    setPending(true);
    setError(null);
    const result = await revoke({
      data: { workspaceId, inviteId: invite.id },
    }).catch(() => ({ ok: false as const, reason: "unavailable" }));
    // Not found means it was accepted, declined or revoked meanwhile:
    // refreshing shows which.
    if (result.ok || result.reason === "not_found") await router.invalidate();
    else setError(INVITE_ERRORS.unavailable ?? "");
    setPending(false);
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="flex flex-col">
        <span className="break-all">{invite.email}</span>
        <span className="text-sm text-neutral-700 dark:text-neutral-300">
          {ROLE_NAMES[invite.role]} ·{" "}
          {invite.expired ? "Expired" : `Sent ${sent}`}
        </span>
      </span>
      <span className="flex gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={onResend}
          aria-label={`Resend the invite to ${invite.email}`}
        >
          Resend
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={onRevoke}
          aria-label={`Revoke the invite to ${invite.email}`}
        >
          Revoke
        </Button>
      </span>
      {error && (
        <p
          role="alert"
          className="w-full text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </li>
  );
}
