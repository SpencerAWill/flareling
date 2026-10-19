import { WORKSPACE_NAME_MAX } from "@flareling/core/client";
import { Button, Input, Label } from "@flareling/ui";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PlusIcon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
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
  const nameId = useId();
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
        to: "/w/$publicId/members",
        params: { publicId: result.publicId },
      });
      return;
    }
    setError(REASONS[result.reason] ?? REASONS.unavailable ?? null);
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-wrap items-end gap-2">
      <div className="flex min-w-48 grow flex-col gap-2">
        <Label htmlFor={nameId}>New workspace</Label>
        <Input
          id={nameId}
          name="name"
          required
          maxLength={WORKSPACE_NAME_MAX}
          placeholder="Acme, Inc."
          autoComplete="organization"
        />
      </div>
      <Button type="submit" variant="flare" disabled={pending}>
        <PlusIcon />
        Create workspace
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
