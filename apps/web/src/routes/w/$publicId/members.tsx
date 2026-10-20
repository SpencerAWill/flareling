import {
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@flareling/ui";
import {
  createFileRoute,
  getRouteApi,
  Link,
  notFound,
  useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MailIcon, SendIcon, SparklesIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { Form, useAppForm } from "#/components/form.tsx";
import { LeaveWorkspace, MemberRow } from "#/components/member-row.tsx";
import { usePresence } from "#/lib/realtime.tsx";
import { inviteSchema } from "#/lib/schemas.ts";
import { ROLE_NAMES, workspaceTitle } from "#/lib/workspaces.ts";
import {
  getMembersFn,
  inviteMemberFn,
  revokeInviteFn,
} from "#/server/workspaces/fns.ts";

const workspaceRoute = getRouteApi("/w/$publicId");

export const Route = createFileRoute("/w/$publicId/members")({
  loader: async ({ parentMatchPromise }) => {
    const { workspace } = (await parentMatchPromise).loaderData ?? {};
    if (!workspace) throw notFound();
    const result = await getMembersFn({
      data: { workspaceId: workspace.id },
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
  const { online, connected, stopped } = usePresence();
  const onlineHere = members.filter((m) => online.has(m.userId)).length;
  const full = seats.used >= seats.limit;

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Members of {workspace.name}
        </h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          {connected ? (
            <>
              <span aria-hidden className="relative flex size-2">
                <span className="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              {onlineHere} online now
            </>
          ) : stopped ? null : (
            "Connecting…"
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="members-heading">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 id="members-heading">
                    {members.length}{" "}
                    {members.length === 1 ? "member" : "members"}
                  </h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="-mx-2 flex flex-col">
                  <AnimatePresence initial={false}>
                    {members.map((member) => (
                      <MemberRow
                        key={member.userId}
                        workspaceId={workspace.id}
                        member={member}
                        viewerId={viewerId}
                        viewerRole={viewerRole}
                        personal={workspace.personal}
                        online={online.has(member.userId)}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </CardContent>
            </Card>
          </section>

          {canManage && invites.length > 0 && (
            <section aria-labelledby="invites-heading">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2 id="invites-heading">Open invites</h2>
                  </CardTitle>
                  <CardDescription>
                    Waiting to be accepted. Each one holds a seat until it
                    expires.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="-mx-2 flex flex-col">
                    {invites.map((invite) => (
                      <PendingInvite
                        key={invite.id}
                        workspaceId={workspace.id}
                        invite={invite}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {workspace.personal ? (
            <Card className="bg-accent/40">
              <CardHeader>
                <span className="mb-1 grid size-9 place-items-center rounded-lg bg-flare text-white">
                  <SparklesIcon className="size-4.5" aria-hidden />
                </span>
                <CardTitle>
                  <h2>Just you, here</h2>
                </CardTitle>
                <CardDescription>
                  Your personal workspace is just for you. To work with other
                  people, create a team workspace from your account page.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  to="/my/account"
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Create a team workspace
                </Link>
              </CardContent>
            </Card>
          ) : (
            canManage && (
              <section aria-labelledby="invite-heading">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <h2 id="invite-heading">Invite someone</h2>
                    </CardTitle>
                    <CardDescription>
                      {seats.used} of {seats.limit} seats used, counting open
                      invites.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div
                      aria-hidden
                      className="h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full bg-flare transition-[width] duration-500"
                        style={{
                          width: `${Math.min(100, (seats.used / seats.limit) * 100)}%`,
                        }}
                      />
                    </div>
                    {full ? (
                      <p className="text-sm text-muted-foreground">
                        To invite more people, revoke an invite, remove someone,
                        or{" "}
                        <Link
                          to="/w/$publicId/billing"
                          params={{ publicId: workspace.publicId }}
                          className="font-medium text-foreground underline underline-offset-4"
                        >
                          upgrade the plan
                        </Link>
                        .
                      </p>
                    ) : (
                      <InviteForm workspaceId={workspace.id} />
                    )}
                  </CardContent>
                </Card>
              </section>
            )
          )}

          {!workspace.personal && (
            <LeaveWorkspace
              workspaceId={workspace.id}
              workspaceName={workspace.name}
            />
          )}
        </div>
      </div>
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
  const [status, setStatus] = useState<
    { kind: "sent"; email: string } | { kind: "error"; message: string } | null
  >(null);

  const form = useAppForm({
    defaultValues: {
      email: "",
      role: "member" as "admin" | "member",
    },
    validators: { onChange: inviteSchema },
    onSubmit: async ({ value, formApi }) => {
      setStatus(null);
      const email = value.email.trim();
      const result = await invite(email, value.role);
      if (result.ok) {
        formApi.reset();
        setStatus({ kind: "sent", email });
      } else {
        setStatus({
          kind: "error",
          message:
            INVITE_ERRORS[result.reason] ?? INVITE_ERRORS.unavailable ?? "",
        });
      }
    },
  });

  return (
    <Form form={form} className="flex flex-col gap-3">
      <form.AppField name="email">
        {(field) => (
          <field.TextField
            label="Email"
            type="email"
            maxLength={254}
            placeholder="teammate@example.com"
            autoComplete="off"
          />
        )}
      </form.AppField>
      <form.AppField name="role">
        {(field) => (
          <field.SelectField label="Role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </field.SelectField>
        )}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton variant="flare">
          <SendIcon />
          Send invite
        </form.SubmitButton>
      </form.AppForm>
      {status?.kind === "sent" && (
        <p role="status" className="text-sm text-muted-foreground">
          Invite sent to {status.email}.
        </p>
      )}
      {status?.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      )}
    </Form>
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
    <li className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <MailIcon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{invite.email}</span>
        <span className="text-xs text-muted-foreground">
          {ROLE_NAMES[invite.role]} ·{" "}
          {invite.expired ? "Expired" : `Sent ${sent}`}
        </span>
      </span>
      {invite.expired && <Badge variant="outline">Expired</Badge>}
      <span className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={onResend}
          aria-label={`Resend the invite to ${invite.email}`}
        >
          Resend
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={onRevoke}
          aria-label={`Revoke the invite to ${invite.email}`}
        >
          Revoke
        </Button>
      </span>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
