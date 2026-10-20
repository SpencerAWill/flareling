import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@flareling/ui";
import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FingerprintIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import {
  beginPasskeyRegistrationFn,
  finishPasskeyRegistrationFn,
  removePasskeyFn,
} from "#/server/auth/fns.ts";

interface Passkey {
  readonly id: string;
  readonly nickname: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

/** The account's passkeys, with add and remove. */
export function Passkeys({
  passkeys,
}: {
  readonly passkeys: readonly Passkey[];
}) {
  const router = useRouter();
  const begin = useServerFn(beginPasskeyRegistrationFn);
  const finish = useServerFn(finishPasskeyRegistrationFn);
  const remove = useServerFn(removePasskeyFn);
  const [message, setMessage] = useState<string | null>(null);

  async function add() {
    setMessage(null);
    const started = await begin();
    if (!started.ok) {
      setMessage(
        started.reason === "reauthenticate"
          ? "For your security, adding a passkey needs a recent sign-in. Sign out, sign in again with an email link, then add it."
          : "Couldn't start adding a passkey. Try again in a minute.",
      );
      return;
    }
    let response: unknown;
    try {
      response = await startRegistration({
        optionsJSON: JSON.parse(started.optionsJSON),
      });
    } catch {
      // Cancelled in the browser's dialog, or not supported.
      setMessage("No passkey was added.");
      return;
    }
    const nickname = window.navigator.platform || undefined;
    const result = await finish({ data: { response, nickname } });
    setMessage(
      result.ok
        ? "Passkey added."
        : result.reason === "reauthenticate"
          ? "Your sign-in is no longer recent. Sign in again, then add the passkey."
          : "That passkey couldn't be verified.",
    );
    await router.invalidate().catch(() => {}); // superseded by a navigation
  }

  return (
    <section aria-labelledby="passkeys-heading">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="passkeys-heading">Passkeys</h2>
          </CardTitle>
          <CardDescription>
            Sign in with your fingerprint, face or device PIN instead of an
            email link. Email still works if you lose access to a device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {passkeys.length > 0 && (
            <ul
              aria-labelledby="passkeys-heading"
              className="flex flex-col gap-2"
            >
              {passkeys.map((passkey) => (
                <li
                  key={passkey.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2"
                >
                  <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-foreground">
                    <FingerprintIcon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {passkey.nickname ?? "Passkey"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Added {passkey.createdAt.toLocaleDateString()}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await remove({ data: { id: passkey.id } });
                      await router.invalidate().catch(() => {}); // superseded by a navigation
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" className="self-start" onClick={add}>
            <PlusIcon />
            Add a passkey
          </Button>
          {message && (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
