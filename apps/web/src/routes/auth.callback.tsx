import { isSafeRedirect } from "@flareling/auth/client";
import { Button, buttonVariants } from "@flareling/ui";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { AuthShell } from "#/components/auth-shell.tsx";
import { afterSessionChange } from "#/lib/auth.ts";
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
    await afterSessionChange(
      router,
      next && isSafeRedirect(next) ? next : "/my/account",
    );
  }

  return (
    <AuthShell
      title="Sign in to Flareling"
      description={
        state === "invalid" || state === "limited"
          ? undefined
          : "One click and you're in. This link works once."
      }
    >
      {state === "invalid" || state === "limited" ? (
        <>
          <p role="alert" className="text-center text-sm">
            {state === "limited"
              ? "Too many attempts. Wait a minute and try again."
              : "This link has expired or has already been used."}
          </p>
          <Link
            to="/sign-in"
            className={buttonVariants({ variant: "secondary" })}
          >
            Get a new link
          </Link>
        </>
      ) : (
        <Button
          variant="flare"
          onClick={onContinue}
          disabled={state === "working" || !token}
        >
          {state === "working" ? "Signing in…" : "Continue"}
        </Button>
      )}
    </AuthShell>
  );
}
