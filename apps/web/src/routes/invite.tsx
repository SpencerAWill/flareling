import { Badge, Button, buttonVariants } from "@flareling/ui";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { AuthShell } from "#/components/auth-shell.tsx";
import { WorkspaceTile } from "#/components/avatars.tsx";
import { afterSessionChange } from "#/lib/auth.ts";
import { ROLE_NAMES } from "#/lib/workspaces.ts";
import { signOutFn } from "#/server/auth/fns.ts";
import {
  acceptInviteFn,
  declineInviteFn,
  getInviteFn,
} from "#/server/workspaces/fns.ts";

/**
 * Where an invite link lands. Like /auth/callback, nothing happens on load:
 * email scanners fetch every link in a message. Accepting needs a signed-in
 * account that has the invited address; a signed-out visitor signs in as
 * that address first and comes back here.
 */
export const Route = createFileRoute("/invite")({
  validateSearch: z.object({ token: z.string().catch("") }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => ({
    invite:
      deps.token.length >= 16
        ? await getInviteFn({ data: { token: deps.token } }).catch(() => null)
        : null,
  }),
  head: () => ({ meta: [{ title: "Invite · Flareling" }] }),
  component: Invite,
});

function Invite() {
  const { invite } = Route.useLoaderData();
  const { token } = Route.useSearch();
  const { principal } = Route.useRouteContext();
  const router = useRouter();
  const accept = useServerFn(acceptInviteFn);
  const decline = useServerFn(declineInviteFn);
  const signOut = useServerFn(signOutFn);
  const [state, setState] = useState<
    "idle" | "working" | "declined" | "full" | "invalid" | "failed"
  >("idle");

  if (!invite || state === "invalid") {
    return (
      <AuthShell
        title="This invite is no longer valid"
        description="It may have expired, been used, or been withdrawn. Ask whoever sent it for a new one."
      >
        <Link to="/" className={buttonVariants({ variant: "secondary" })}>
          Go home
        </Link>
      </AuthShell>
    );
  }

  if (state === "declined") {
    return (
      <AuthShell
        title="Invite declined"
        description={`You won't join ${invite.workspaceName}. You can close this page.`}
      >
        <Link to="/" className={buttonVariants({ variant: "secondary" })}>
          Go home
        </Link>
      </AuthShell>
    );
  }

  const here = `/invite?token=${encodeURIComponent(token)}`;
  const isInvitee = principal?.emails.includes(invite.email) ?? false;

  async function onAccept() {
    setState("working");
    const result = await accept({ data: { token } }).catch(() => null);
    if (result?.ok) {
      await router.navigate({
        to: "/w/$publicId/members",
        params: { publicId: result.publicId },
      });
      return;
    }
    setState(
      result?.reason === "workspace_full"
        ? "full"
        : result?.reason === "invalid"
          ? "invalid"
          : "failed",
    );
  }

  async function onDecline() {
    setState("working");
    await decline({ data: { token } }).catch(() => null);
    setState("declined");
  }

  async function onSwitchAccount() {
    await signOut();
    await afterSessionChange(router, here);
  }

  return (
    <AuthShell title={`Join ${invite.workspaceName}`}>
      <div className="flex flex-col items-center gap-3 text-center">
        <WorkspaceTile
          name={invite.workspaceName}
          className="size-14 rounded-2xl text-2xl shadow-sm"
        />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {invite.invitedBy ?? "Someone"}
          </span>{" "}
          invited{" "}
          <span className="font-medium text-foreground">{invite.email}</span> to
          join as <Badge variant="secondary">{ROLE_NAMES[invite.role]}</Badge>
        </p>
      </div>

      {!principal ? (
        <>
          <p className="text-center text-sm text-muted-foreground">
            Sign in as {invite.email} to accept. New here? Signing in creates
            your account.
          </p>
          <Link
            to="/sign-in"
            search={{ redirect: here, email: invite.email }}
            className={buttonVariants({ variant: "flare" })}
          >
            Sign in to accept
          </Link>
        </>
      ) : !isInvitee ? (
        <>
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            You're signed in as {principal.primaryEmail}, but this invite is for{" "}
            {invite.email}. Sign in with that address to accept it.
          </p>
          <Button variant="secondary" onClick={onSwitchAccount}>
            Sign out and switch account
          </Button>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={onDecline}
            disabled={state === "working"}
          >
            Decline
          </Button>
          <Button
            variant="flare"
            onClick={onAccept}
            disabled={state === "working"}
          >
            Accept and join
          </Button>
        </div>
      )}

      {state === "full" && (
        <p role="alert" className="text-sm text-destructive">
          {invite.workspaceName} is full right now. Ask whoever invited you to
          make room, then try again.
        </p>
      )}
      {state === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          Something went wrong. Try again in a moment.
        </p>
      )}
    </AuthShell>
  );
}
