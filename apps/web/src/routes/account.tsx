import { Button } from "@flareling/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Passkeys } from "#/components/passkeys.tsx";
import { afterSessionChange, requireSignedIn } from "#/lib/auth.ts";
import { listPasskeysFn, signOutFn } from "#/server/auth/fns.ts";

export const Route = createFileRoute("/account")({
  beforeLoad: ({ context, location }) => ({
    principal: requireSignedIn(context.principal, location),
  }),
  loader: () => listPasskeysFn(),
  head: () => ({ meta: [{ title: "Account · Flareling" }] }),
  component: Account,
});

function Account() {
  const { principal } = Route.useRouteContext();
  const passkeys = Route.useLoaderData();
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
      <Passkeys passkeys={passkeys} />
      <Button variant="secondary" className="self-start" onClick={onSignOut}>
        Sign out
      </Button>
    </main>
  );
}
