import {
  createFileRoute,
  notFound,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppHeader } from "#/components/app-header.tsx";
import {
  WorkspaceSwitcher,
  WorkspaceTabs,
} from "#/components/workspace-nav.tsx";
import { requireSignedIn } from "#/lib/auth.ts";
import { WorkspaceRealtime } from "#/lib/realtime.tsx";
import { listWorkspacesFn } from "#/server/auth/fns.ts";

/**
 * Every page inside a workspace: the switcher and section links, above the
 * page. URLs name the workspace by its public id (`/w/k7x2mq9pz4`); this
 * loader resolves it once, and pages read the internal id from it
 * (`parentMatchPromise`) for their server functions. In the loader, not
 * beforeLoad: loader data travels with the server-rendered page, while
 * beforeLoad runs again in the browser on hydration, which would fetch the
 * workspace list twice per page. A workspace the account doesn't belong to is a 404, the same
 * as one that doesn't exist. Navigation only; each page's server functions
 * check membership themselves.
 */
export const Route = createFileRoute("/w/$publicId")({
  beforeLoad: ({ context, location }) => ({
    principal: requireSignedIn(context.principal, location),
  }),
  loader: async ({ location, params }) => {
    const workspaces = await listWorkspacesFn();
    const workspace = workspaces.find((w) => w.publicId === params.publicId);
    if (!workspace) {
      // Links from before public ids used the internal id (bookmarks, a
      // Stripe return URL made then): send those to the public one.
      const old = workspaces.find((w) => w.id === params.publicId);
      if (old) {
        throw redirect({
          href: location.href.replace(
            `/w/${params.publicId}`,
            `/w/${old.publicId}`,
          ),
          replace: true,
        });
      }
      throw notFound();
    }
    return { workspace, workspaces };
  },
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  const { workspace, workspaces } = Route.useLoaderData();
  return (
    <>
      <AppHeader>
        <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
      </AppHeader>
      <WorkspaceTabs current={workspace} />
      {/* Keyed, so switching workspaces opens a fresh socket and state. */}
      <WorkspaceRealtime key={workspace.id} workspaceId={workspace.id}>
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          <Outlet />
        </div>
      </WorkspaceRealtime>
    </>
  );
}
