import {
  createFileRoute,
  notFound,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { WorkspaceNav } from "#/components/workspace-nav.tsx";
import { requireSignedIn } from "#/lib/auth.ts";
import { WorkspaceRealtime } from "#/lib/realtime.tsx";
import { listWorkspacesFn } from "#/server/auth/fns.ts";

/**
 * Every page inside a workspace: the switcher and section links, above the
 * page. URLs name the workspace by its public id (`/w/k7x2mq9pz4`); this
 * resolves it once, into context, so pages call server functions with the
 * internal id. A workspace the account doesn't belong to is a 404, the same
 * as one that doesn't exist. Navigation only; each page's server functions
 * check membership themselves.
 */
export const Route = createFileRoute("/w/$publicId")({
  beforeLoad: async ({ context, location, params }) => {
    const principal = requireSignedIn(context.principal, location);
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
    return { principal, workspace, workspaces };
  },
  loader: ({ context }) => ({
    workspace: context.workspace,
    workspaces: context.workspaces,
  }),
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  const { workspace, workspaces } = Route.useLoaderData();
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-8">
      <WorkspaceNav current={workspace} workspaces={workspaces} />
      {/* Keyed, so switching workspaces opens a fresh socket and state. */}
      <WorkspaceRealtime key={workspace.id} workspaceId={workspace.id}>
        <Outlet />
      </WorkspaceRealtime>
    </div>
  );
}
