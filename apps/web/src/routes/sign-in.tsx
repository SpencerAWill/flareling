import { isSafeRedirect } from "@flareling/auth/client";
import { Button, Separator } from "@flareling/ui";
import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
} from "@simplewebauthn/browser";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { KeyRoundIcon, MailCheckIcon, MailIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AuthShell } from "#/components/auth-shell.tsx";
import { Form, useAppForm } from "#/components/form.tsx";
import { Turnstile } from "#/components/turnstile.tsx";
import { afterSessionChange } from "#/lib/auth.ts";
import { signInSchema } from "#/lib/schemas.ts";
import {
  beginPasskeySignInFn,
  finishPasskeySignInFn,
  getSignInConfigFn,
  requestMagicLinkFn,
} from "#/server/auth/fns.ts";

export const Route = createFileRoute("/sign-in")({
  validateSearch: z.object({
    redirect: z.string().optional(),
    // Prefills the address, e.g. from an invite for it.
    email: z.string().max(254).optional(),
  }),
  beforeLoad: ({ context }) => {
    if (context.principal) throw redirect({ to: "/my/account" });
  },
  loader: () => getSignInConfigFn(),
  head: () => ({ meta: [{ title: "Sign in · Flareling" }] }),
  component: SignIn,
});

function SignIn() {
  const { redirect: next, email: suggestedEmail } = Route.useSearch();
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

  const form = useAppForm({
    defaultValues: { email: suggestedEmail ?? "" },
    validators: { onChange: signInSchema },
    onSubmit: async ({ value }) => {
      setState("sending");
      try {
        await requestMagicLink({
          data: {
            email: value.email,
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
    },
  });

  return (
    <AuthShell
      title={state === "sent" ? "Check your inbox" : "Sign in"}
      description={
        state === "sent"
          ? undefined
          : "New here? Signing in creates your account."
      }
    >
      {state === "sent" ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-success/15 text-success">
            <MailCheckIcon className="size-6" aria-hidden />
          </span>
          <p role="status" className="text-sm text-muted-foreground">
            Check your email. If an account can use that address, a sign-in link
            is on its way. It expires in 15 minutes.
          </p>
        </div>
      ) : (
        <Form form={form} className="flex flex-col gap-4">
          {/* "webauthn" lets the browser offer passkeys from this field. */}
          <form.AppField name="email">
            {(field) => (
              <field.TextField
                label="Email"
                type="email"
                placeholder="you@example.com"
                autoComplete="username webauthn"
              />
            )}
          </form.AppField>
          {turnstileSiteKey && (
            <Turnstile
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
              resetRef={resetTurnstile}
            />
          )}
          <form.AppForm>
            <form.SubmitButton
              variant="flare"
              disabled={!!turnstileSiteKey && !turnstileToken}
            >
              <MailIcon />
              Email me a sign-in link
            </form.SubmitButton>
          </form.AppForm>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            or
            <Separator className="flex-1" />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setPasskeyError(false);
              signInWithPasskey(false).catch(() => setPasskeyError(true));
            }}
          >
            <KeyRoundIcon />
            Sign in with a passkey
          </Button>
          {(state === "error" || passkeyError) && (
            <p role="alert" className="text-sm text-destructive">
              {passkeyError
                ? "That didn't work. Use an email link instead."
                : "Something went wrong sending the link. Try again in a minute."}
            </p>
          )}
        </Form>
      )}
    </AuthShell>
  );
}
