import { WORKSPACE_NAME_MAX } from "@flareling/core/client";
import { Button } from "@flareling/ui";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import { createWorkspaceFn } from "#/server/workspaces/fns.ts";

const REASONS: Record<string, string> = {
  invalid_name: "Give the workspace a name.",
  limit_reached:
    "You own as many workspaces as an account can. Leave or hand one over first.",
  unauthorized: "Your session has ended. Sign in again to continue.",
  unavailable: "Something went wrong. Try again in a moment.",
};

/** Creates a team workspace and opens it. */
export function NewWorkspace() {
  const create = useServerFn(createWorkspaceFn);
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    setPending(true);
    setError(null);
    const result = await create({ data: { name } }).catch(() => ({
      ok: false as const,
      reason: "unavailable" as const,
    }));
    if (result.ok) {
      await navigate({
        to: "/w/$workspaceId/members",
        params: { workspaceId: result.id },
      });
      return;
    }
    setError(REASONS[result.reason] ?? REASONS.unavailable ?? null);
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <label className="flex grow flex-col gap-1">
        <span className="text-sm font-medium">New workspace</span>
        <input
          name="name"
          required
          maxLength={WORKSPACE_NAME_MAX}
          autoComplete="organization"
          className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>
        Create workspace
      </Button>
      {error && (
        <p
          role="alert"
          className="w-full text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </form>
  );
}
