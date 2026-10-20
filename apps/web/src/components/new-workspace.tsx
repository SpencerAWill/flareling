import { WORKSPACE_NAME_MAX } from "@flareling/core/client";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { newWorkspaceSchema } from "#/lib/schemas.ts";
import { createWorkspaceFn } from "#/server/workspaces/fns.ts";
import { Form, useAppForm } from "./form.tsx";

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
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { name: "" },
    validators: { onChange: newWorkspaceSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      const result = await create({ data: value }).catch(() => ({
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
    },
  });

  return (
    <Form
      form={form}
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-start"
    >
      <form.AppField name="name">
        {(field) => (
          <field.TextField
            label="New workspace"
            className="min-w-48 grow"
            maxLength={WORKSPACE_NAME_MAX}
            placeholder="Acme, Inc."
            autoComplete="organization"
          />
        )}
      </form.AppField>
      <form.AppForm>
        {/* Lined up with the input, below its label. */}
        <form.SubmitButton variant="flare" className="sm:mt-[1.375rem]">
          <PlusIcon />
          Create workspace
        </form.SubmitButton>
      </form.AppForm>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </Form>
  );
}
