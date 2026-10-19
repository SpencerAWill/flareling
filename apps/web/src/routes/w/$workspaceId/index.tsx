import { createFileRoute, redirect } from "@tanstack/react-router";

/** A workspace opens on its members. */
export const Route = createFileRoute("/w/$workspaceId/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$workspaceId/members", params });
  },
});
