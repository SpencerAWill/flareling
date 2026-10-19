import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { WorkspaceNav } from "#/components/workspace-nav.tsx";
import { requireSignedIn } from "#/lib/auth.ts";
import { WorkspaceRealtime } from "#/lib/realtime.tsx";
import { listWorkspacesFn } from "#/server/auth/fns.ts";

/**
 * Every page inside a workspace: the switcher and section links, above the
 * page. A workspace the account doesn't belong to is a 404, the same as one
 * that doesn't exist. Navigation only; each page's server functions check
 * membership themselves.
 */
export const Route = createFileRoute("/w/$workspaceId")({
  beforeLoad: ({ context, location }) => ({
    principal: requireSignedIn(context.principal, location),
  }),
  loader: async ({ params }) => {
    const workspaces = await listWorkspacesFn();
    const workspace = workspaces.find((w) => w.id === params.workspaceId);
    if (!workspace) throw notFound();
    return { workspace, workspaces };
  },
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
