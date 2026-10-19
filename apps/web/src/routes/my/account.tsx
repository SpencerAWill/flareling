import { Button } from "@flareling/ui";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { NewWorkspace } from "#/components/new-workspace.tsx";
import { Passkeys } from "#/components/passkeys.tsx";
import { afterSessionChange, requireSignedIn } from "#/lib/auth.ts";
import {
  listPasskeysFn,
  listWorkspacesFn,
  signOutFn,
} from "#/server/auth/fns.ts";

export const Route = createFileRoute("/my/account")({
  beforeLoad: ({ context, location }) => ({
    principal: requireSignedIn(context.principal, location),
  }),
  loader: async () => {
    const [passkeys, workspaces] = await Promise.all([
      listPasskeysFn(),
      listWorkspacesFn(),
    ]);
    return { passkeys, workspaces };
  },
  head: () => ({ meta: [{ title: "Account · Flareling" }] }),
  component: Account,
});

function Account() {
  const { principal } = Route.useRouteContext();
  const { passkeys, workspaces } = Route.useLoaderData();
  const router = useRouter();
  const signOut = useServerFn(signOutFn);

  async function onSignOut() {
    await signOut();
    await afterSessionChange(router, "/");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Your account</h1>
      <p>
        Signed in as <strong>{principal.primaryEmail}</strong>
      </p>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        Roles: {principal.roles.join(", ") || "none"}
      </p>
      <section
        className="flex flex-col gap-2"
        aria-labelledby="workspaces-heading"
      >
        <h2 id="workspaces-heading" className="text-lg font-semibold">
          Workspaces
        </h2>
        <ul className="flex flex-col gap-1">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              {workspace.name}{" "}
              <span className="text-sm text-neutral-700 dark:text-neutral-300">
                ({workspace.role})
              </span>{" "}
              <Link
                to="/w/$publicId/members"
                params={{ publicId: workspace.publicId }}
                className="text-sm underline"
              >
                Members
              </Link>{" "}
              <Link
                to="/w/$publicId/billing"
                params={{ publicId: workspace.publicId }}
                className="text-sm underline"
              >
                Billing
              </Link>
            </li>
          ))}
        </ul>
        <NewWorkspace />
      </section>
      <Passkeys passkeys={passkeys} />
      <Button variant="secondary" className="self-start" onClick={onSignOut}>
        Sign out
      </Button>
    </main>
  );
}
