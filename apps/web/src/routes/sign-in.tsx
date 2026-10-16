import { Button } from "@flareling/ui";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { requestMagicLinkFn } from "#/server/auth/fns.ts";

export const Route = createFileRoute("/sign-in")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (context.principal) throw redirect({ to: "/account" });
  },
  head: () => ({ meta: [{ title: "Sign in · Flareling" }] }),
  component: SignIn,
});

function SignIn() {
  const { redirect: next } = Route.useSearch();
  const requestMagicLink = useServerFn(requestMagicLinkFn);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setState("sending");
    try {
      await requestMagicLink({ data: { email, redirect: next } });
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {state === "sent" ? (
        <p role="status">
          Check your email. If an account can use that address, a sign-in link
          is on its way. It expires in 15 minutes.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="username webauthn"
              className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <Button type="submit" disabled={state === "sending"}>
            Email me a sign-in link
          </Button>
          {state === "error" && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              Something went wrong sending the link. Try again in a minute.
            </p>
          )}
        </form>
      )}
    </main>
  );
}
