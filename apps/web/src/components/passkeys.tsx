import { Button } from "@flareling/ui";
import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
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
      setMessage("Couldn't start adding a passkey. Try again in a minute.");
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
      result.ok ? "Passkey added." : "That passkey couldn't be verified.",
    );
    await router.invalidate().catch(() => {}); // superseded by a navigation
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="passkeys-heading">
      <h2 id="passkeys-heading" className="text-lg font-semibold">
        Passkeys
      </h2>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        Sign in with your fingerprint, face or device PIN instead of an email
        link. Email still works if you lose access to a device.
      </p>
      {passkeys.length > 0 && (
        <ul className="flex flex-col gap-2">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex items-center justify-between gap-4"
            >
              <span>
                {passkey.nickname ?? "Passkey"}
                <span className="block text-sm text-neutral-700 dark:text-neutral-300">
                  Added {passkey.createdAt.toLocaleDateString()}
                </span>
              </span>
              <Button
                variant="secondary"
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
        Add a passkey
      </Button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
