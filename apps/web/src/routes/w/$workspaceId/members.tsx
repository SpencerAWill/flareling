import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { workspaceTitle } from "#/lib/workspaces.ts";
import { listMembersFn } from "#/server/workspaces/fns.ts";

const workspaceRoute = getRouteApi("/w/$workspaceId");

export const Route = createFileRoute("/w/$workspaceId/members")({
  loader: async ({ params }) => {
    const result = await listMembersFn({
      data: { workspaceId: params.workspaceId },
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

const ROLE_NAMES = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
} as const;

function Members() {
  const { workspace } = workspaceRoute.useLoaderData();
  const { members } = Route.useLoaderData();

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Members of {workspace.name}</h1>
      {workspace.personal && (
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          Your personal workspace is just for you. To work with other people,
          create a team workspace from your account page.
        </p>
      )}
      <section
        aria-labelledby="members-heading"
        className="flex flex-col gap-2"
      >
        <h2 id="members-heading" className="text-lg font-semibold">
          {members.length} {members.length === 1 ? "member" : "members"}
        </h2>
        <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span className="break-all">{member.email}</span>
              <span className="text-sm text-neutral-700 dark:text-neutral-300">
                {ROLE_NAMES[member.role]}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
