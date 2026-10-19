import { mayManage, type WorkspaceRole } from "@flareling/core/client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  NativeSelect,
} from "@flareling/ui";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LogOutIcon, UserMinusIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { ROLE_NAMES } from "#/lib/workspaces.ts";
import {
  changeRoleFn,
  leaveWorkspaceFn,
  removeMemberFn,
} from "#/server/workspaces/fns.ts";
import { MemberAvatar } from "./avatars.tsx";

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
    <motion.li
      layout
      initial={{ y: 8, scale: 0.98 }}
      animate={{ y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
      className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
    >
      <MemberAvatar email={member.email} online={online} />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="truncate font-medium">{member.email}</span>
        {isViewer && (
          <span className="text-xs text-muted-foreground">(you)</span>
        )}
        {online && (
          <Badge className="bg-success/15 text-success-foreground">
            Online
          </Badge>
        )}
      </span>
      {editable ? (
        <span className="flex items-center gap-1">
          <NativeSelect
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
            className="h-8 text-xs"
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_NAMES[role]}
              </option>
            ))}
          </NativeSelect>
          {!isViewer && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
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
              <UserMinusIcon />
            </Button>
          )}
        </span>
      ) : (
        <Badge variant="outline">{ROLE_NAMES[member.role]}</Badge>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </motion.li>
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
    <section aria-labelledby="leave-heading">
      <Card className="ring-destructive/20">
        <CardHeader>
          <CardTitle>
            <h2 id="leave-heading">Leave this workspace</h2>
          </CardTitle>
          <CardDescription>
            You'll lose access straight away. Coming back takes a new invite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" disabled={pending} onClick={onLeave}>
            <LogOutIcon />
            Leave {workspaceName}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
