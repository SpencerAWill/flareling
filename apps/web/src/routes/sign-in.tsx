import { isSafeRedirect } from "@flareling/auth/client";
import { Button } from "@flareling/ui";
import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
} from "@simplewebauthn/browser";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Turnstile } from "#/components/turnstile.tsx";
import { afterSessionChange } from "#/lib/auth.ts";
import {
  beginPasskeySignInFn,
  finishPasskeySignInFn,
  getSignInConfigFn,
  requestMagicLinkFn,
} from "#/server/auth/fns.ts";

export const Route = createFileRoute("/sign-in")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (context.principal) throw redirect({ to: "/my/account" });
  },
  loader: () => getSignInConfigFn(),
  head: () => ({ meta: [{ title: "Sign in · Flareling" }] }),
  component: SignIn,
});

function SignIn() {
  const { redirect: next } = Route.useSearch();
  const router = useRouter();
  const requestMagicLink = useServerFn(requestMagicLinkFn);
  const beginPasskey = useServerFn(beginPasskeySignInFn);
  const finishPasskey = useServerFn(finishPasskeySignInFn);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [passkeyError, setPasskeyError] = useState(false);
  const { turnstileSiteKey } = Route.useLoaderData();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const resetTurnstile = useRef<(() => void) | null>(null);

  // The autofill ceremony's first request, while it's in flight. The button
  // waits for it before beginning its own: each begin sets the ceremony
  // cookie, and if the autofill's answer arrived second it would replace the
  // button's challenge, and the button's sign-in would fail verification.
  const autofillBegin = useRef<Promise<unknown> | null>(null);

  /** One passkey ceremony. With `autofill`, it waits for the field's offer. */
  async function signInWithPasskey(autofill: boolean) {
    if (!autofill) await autofillBegin.current?.catch(() => {});
    const begin = beginPasskey();
    if (autofill) autofillBegin.current = begin;
    const started = await begin;
    if (!started.ok) throw new Error(started.reason);
    const response = await startAuthentication({
      optionsJSON: JSON.parse(started.optionsJSON),
      useBrowserAutofill: autofill,
    });
    const result = await finishPasskey({ data: { response } });
    if (!result.ok) throw new Error(result.reason);
    await afterSessionChange(
      router,
      next && isSafeRedirect(next) ? next : "/my/account",
    );
  }

  // Offer saved passkeys in the email field's autofill, where supported.
  // Failures are silent: the email form is the fallback, and starting another
  // ceremony (the button) cancels this one.
  useEffect(() => {
    void browserSupportsWebAuthnAutofill().then((supported) => {
      if (supported) signInWithPasskey(true).catch(() => {});
    });
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setState("sending");
    try {
      await requestMagicLink({
        data: {
          email,
          redirect: next,
          turnstileToken: turnstileToken ?? undefined,
        },
      });
      setState("sent");
    } catch {
      setState("error");
    } finally {
      // Turnstile tokens are single use.
      resetTurnstile.current?.();
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
            {/* "webauthn" lets the browser offer passkeys from this field. */}
            <input
              name="email"
              type="email"
              required
              autoComplete="username webauthn"
              className="rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          {turnstileSiteKey && (
            <Turnstile
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
              resetRef={resetTurnstile}
            />
          )}
          <Button
            type="submit"
            disabled={
              state === "sending" || (!!turnstileSiteKey && !turnstileToken)
            }
          >
            Email me a sign-in link
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setPasskeyError(false);
              signInWithPasskey(false).catch(() => setPasskeyError(true));
            }}
          >
            Sign in with a passkey
          </Button>
          {(state === "error" || passkeyError) && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {passkeyError
                ? "That didn't work. Use an email link instead."
                : "Something went wrong sending the link. Try again in a minute."}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
