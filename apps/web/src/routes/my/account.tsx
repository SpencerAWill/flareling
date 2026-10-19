import {
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@flareling/ui";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LogOutIcon } from "lucide-react";
import { AppHeader } from "#/components/app-header.tsx";
import { MemberAvatar, WorkspaceTile } from "#/components/avatars.tsx";
import { NewWorkspace } from "#/components/new-workspace.tsx";
import { Passkeys } from "#/components/passkeys.tsx";
import { afterSessionChange, requireSignedIn } from "#/lib/auth.ts";
import { ROLE_NAMES } from "#/lib/workspaces.ts";
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
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center gap-4">
          <MemberAvatar email={principal.primaryEmail} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Your account
            </h1>
            <p className="truncate text-sm text-muted-foreground">
              Signed in as {principal.primaryEmail}
            </p>
          </div>
          <Button variant="secondary" onClick={onSignOut}>
            <LogOutIcon />
            Sign out
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="workspaces-heading">Workspaces</h2>
            </CardTitle>
            <CardDescription>
              Your personal workspace is just for you. Team workspaces are for
              working with others.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul
              aria-labelledby="workspaces-heading"
              className="-mx-2 flex flex-col"
            >
              {workspaces.map((workspace) => (
                <li
                  key={workspace.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                >
                  <WorkspaceTile
                    name={workspace.name}
                    personal={workspace.personal}
                    className="size-8 text-sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {workspace.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ROLE_NAMES[workspace.role]}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Link
                      to="/w/$publicId/members"
                      params={{ publicId: workspace.publicId }}
                      className={buttonVariants({
                        variant: "ghost",
                        size: "sm",
                      })}
                    >
                      Members
                    </Link>
                    <Link
                      to="/w/$publicId/billing"
                      params={{ publicId: workspace.publicId }}
                      className={buttonVariants({
                        variant: "ghost",
                        size: "sm",
                      })}
                    >
                      Billing
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="border-t">
            <NewWorkspace />
          </CardFooter>
        </Card>

        <Passkeys passkeys={passkeys} />
      </main>
    </>
  );
}
