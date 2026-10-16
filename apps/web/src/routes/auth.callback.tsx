import { isSafeRedirect } from "@flareling/auth/client";
import { Button } from "@flareling/ui";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { consumeMagicLinkFn } from "#/server/auth/fns.ts";

/**
 * Where a sign-in link lands. It doesn't sign in on load: email security
 * scanners fetch every link in a message, and would use the link up before
 * the person clicks. The button posts the token instead.
 */
export const Route = createFileRoute("/auth/callback")({
  validateSearch: z.object({
    token: z.string().catch(""),
    redirect: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Sign in · Flareling" }] }),
  component: Callback,
});

function Callback() {
  const { token, redirect: next } = Route.useSearch();
  const router = useRouter();
  const consume = useServerFn(consumeMagicLinkFn);
  const [state, setState] = useState<
    "idle" | "working" | "invalid" | "limited"
  >("idle");

  async function onContinue() {
    setState("working");
    const result = await consume({ data: { token } }).catch(() => null);
    if (!result?.ok) {
      setState(result?.reason === "rate_limited" ? "limited" : "invalid");
      return;
    }
    await router.invalidate();
    await router.navigate({
      to: next && isSafeRedirect(next) ? next : "/account",
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Sign in to Flareling</h1>
      {state === "invalid" || state === "limited" ? (
        <>
          <p role="alert">
            {state === "limited"
              ? "Too many attempts. Wait a minute and try again."
              : "This link has expired or has already been used."}
          </p>
          <Link to="/sign-in" className="underline">
            Get a new link
          </Link>
        </>
      ) : (
        <Button onClick={onContinue} disabled={state === "working" || !token}>
          Continue
        </Button>
      )}
    </main>
  );
}
