import { mayManage, type WorkspaceRole } from "@flareling/core/client";
import { Button } from "@flareling/ui";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ROLE_NAMES } from "#/lib/workspaces.ts";
import {
  changeRoleFn,
  leaveWorkspaceFn,
  removeMemberFn,
} from "#/server/workspaces/fns.ts";

const ERRORS: Record<string, string> = {
  last_owner: "A workspace needs an owner. Make someone else an owner first.",
  changed: "Someone else just changed this. The list is up to date now.",
  not_member: "They're no longer a member.",
  forbidden: "You can't make that change.",
  personal: "Your personal workspace is just for you.",
  unavailable: "Something went wrong. Try again in a moment.",
};

const errorFor = (reason: string) => ERRORS[reason] ?? ERRORS.unavailable ?? "";

/**
 * One member, with role and remove controls for the people allowed to use
 * them. The server checks again; hiding controls is only courtesy.
 */
export function MemberRow({
  workspaceId,
  member,
  viewerId,
  viewerRole,
  personal,
  online,
}: {
  workspaceId: string;
  member: { userId: string; email: string; role: WorkspaceRole };
  viewerId: string;
  viewerRole: WorkspaceRole;
  personal: boolean;
  /** Has the workspace open right now. */
  online: boolean;
}) {
  const router = useRouter();
  const changeRole = useServerFn(changeRoleFn);
  const remove = useServerFn(removeMemberFn);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isViewer = member.userId === viewerId;
  const editable = !personal && mayManage(viewerRole, member.role);
  const roles: WorkspaceRole[] =
    viewerRole === "owner" ? ["owner", "admin", "member"] : ["admin", "member"];

  async function run(
    request: () => Promise<{ ok: true } | { ok: false; reason: string }>,
  ) {
    setPending(true);
    setError(null);
    const result = await request().catch(() => ({
      ok: false as const,
      reason: "unavailable",
    }));
    if (!result.ok) setError(errorFor(result.reason));
    if (result.ok || result.reason === "changed") await router.invalidate();
    setPending(false);
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="flex flex-wrap items-center gap-2 break-all">
        {member.email}
        {isViewer && (
          <span className="text-sm text-neutral-700 dark:text-neutral-300">
            {" "}
            (you)
          </span>
        )}
        {online && (
          <span className="rounded-full bg-green-100 px-2 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-100">
            Online
          </span>
        )}
      </span>
      {editable ? (
        <span className="flex items-center gap-2">
          <select
            aria-label={`Role for ${member.email}`}
            value={member.role}
            disabled={pending}
            onChange={(event) => {
              const role = event.target.value as WorkspaceRole;
              void run(() =>
                changeRole({
                  data: { workspaceId, userId: member.userId, role },
                }),
              );
            }}
            className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_NAMES[role]}
              </option>
            ))}
          </select>
          {!isViewer && (
            <Button
              variant="secondary"
              disabled={pending}
              aria-label={`Remove ${member.email}`}
              onClick={() => {
                if (
                  !window.confirm(`Remove ${member.email} from the workspace?`)
                )
                  return;
                void run(() =>
                  remove({ data: { workspaceId, userId: member.userId } }),
                );
              }}
            >
              Remove
            </Button>
          )}
        </span>
      ) : (
        <span className="text-sm text-neutral-700 dark:text-neutral-300">
          {ROLE_NAMES[member.role]}
        </span>
      )}
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

/** Leaves a team workspace, then goes to the account page. */
export function LeaveWorkspace({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const leave = useServerFn(leaveWorkspaceFn);
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLeave() {
    if (
      !window.confirm(
        `Leave ${workspaceName}? You'll need a new invite to come back.`,
      )
    )
      return;
    setPending(true);
    setError(null);
    const result = await leave({ data: { workspaceId } }).catch(() => ({
      ok: false as const,
      reason: "unavailable",
    }));
    if (result.ok) {
      await navigate({ to: "/my/account" });
      return;
    }
    setError(errorFor(result.reason));
    setPending(false);
  }

  return (
    <section aria-labelledby="leave-heading" className="flex flex-col gap-2">
      <h2 id="leave-heading" className="text-lg font-semibold">
        Leave this workspace
      </h2>
      <Button
        variant="secondary"
        className="self-start"
        disabled={pending}
        onClick={onLeave}
      >
        Leave {workspaceName}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
