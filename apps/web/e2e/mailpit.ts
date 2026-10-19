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

/**
 * The first link in the newest email to `to`, waiting up to 10 seconds.
 * With `pathname`, waits for the newest email whose link goes there, for an
 * address that gets more than one kind (an invite, then a sign-in link).
 */
export async function latestLinkTo(
  to: string,
  options: { pathname?: string } = {},
): Promise<URL> {
  let link: URL | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=1`,
        );
        const body = (await res.json()) as { messages?: { ID: string }[] };
        const id = body.messages?.[0]?.ID;
        if (!id) return undefined;
        const message = (await (
          await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)
        ).json()) as { Text: string };
        const url = message.Text.match(/https?:\/\/\S+/)?.[0];
        link = url ? new URL(url) : undefined;
        if (options.pathname && link?.pathname !== options.pathname) {
          return undefined;
        }
        return link?.href;
      },
      {
        message: `an email to ${to}${options.pathname ? ` linking to ${options.pathname}` : ""}`,
        timeout: 10_000,
        intervals: [200],
      },
    )
    .toBeTruthy();
  if (!link) throw new Error(`no link in the email to ${to}`);
  return link;
}
