import { expect } from "@playwright/test";

/**
 * Mailpit's API, for reading the emails the app sends. In the dev container
 * Mailpit is the `mailpit` compose service; in CI it's a service container on
 * localhost. Set MAILPIT_URL to override.
 *
 * The inbox is shared by every test and browser project running in parallel,
 * so tests never clear it: each one uses a unique address and searches for it.
 */
export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://mailpit:8025";

/** The first link in the newest email to `to`, waiting up to 10 seconds. */
export async function latestLinkTo(to: string): Promise<URL> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=1`,
        );
        const body = (await res.json()) as { messages?: { ID: string }[] };
        id = body.messages?.[0]?.ID;
        return id;
      },
      { message: `an email to ${to}`, timeout: 10_000, intervals: [200] },
    )
    .toBeTruthy();
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  const message = (await res.json()) as { Text: string };
  const url = message.Text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error(`no link in the email to ${to}`);
  return new URL(url);
}
