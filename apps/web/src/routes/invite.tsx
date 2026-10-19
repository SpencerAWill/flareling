import { Button } from "@flareling/ui";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type ReactNode, useState } from "react";
import { z } from "zod";
import { afterSessionChange } from "#/lib/auth.ts";
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

const ROLES = { admin: "an admin", member: "a member" } as const;

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
      <Page title="This invite is no longer valid">
        <p>
          It may have expired, been used, or been withdrawn. Ask whoever sent it
          for a new one.
        </p>
        <Link to="/" className="self-start underline">
          Go home
        </Link>
      </Page>
    );
  }

  if (state === "declined") {
    return (
      <Page title="Invite declined">
        <p>You won't join {invite.workspaceName}. You can close this page.</p>
      </Page>
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
    <Page title={`Join ${invite.workspaceName}`}>
      <p>
        {invite.invitedBy ?? "Someone"} invited <strong>{invite.email}</strong>{" "}
        to join {invite.workspaceName} as {ROLES[invite.role]}.
      </p>

      {!principal ? (
        <>
          <p>
            Sign in as {invite.email} to accept. New here? Signing in creates
            your account.
          </p>
          <Link
            to="/sign-in"
            search={{ redirect: here, email: invite.email }}
            className="self-start rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Sign in to accept
          </Link>
        </>
      ) : !isInvitee ? (
        <>
          <p role="alert">
            You're signed in as {principal.primaryEmail}, but this invite is for{" "}
            {invite.email}. Sign in with that address to accept it.
          </p>
          <Button className="self-start" onClick={onSwitchAccount}>
            Sign out and switch account
          </Button>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onAccept} disabled={state === "working"}>
            Accept and join
          </Button>
          <Button
            variant="secondary"
            onClick={onDecline}
            disabled={state === "working"}
          >
            Decline
          </Button>
        </div>
      )}

      {state === "full" && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {invite.workspaceName} is full right now. Ask whoever invited you to
          make room, then try again.
        </p>
      )}
      {state === "failed" && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          Something went wrong. Try again in a moment.
        </p>
      )}
    </Page>
  );
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}
