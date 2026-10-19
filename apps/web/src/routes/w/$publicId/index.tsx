import { createFileRoute, redirect } from "@tanstack/react-router";

/** A workspace opens on its members. */
export const Route = createFileRoute("/w/$publicId/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$publicId/members", params });
  },
});
