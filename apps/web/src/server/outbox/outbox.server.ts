/**
 * /dev/outbox: the emails a deployed dev environment stored instead of
 * sending (docs/adr/0022-dev-email-outbox.md).
 *
 * Two locks. Cloudflare Access sits in front of the path and lets only the
 * stack's `outboxViewers` through; and this handler verifies the token
 * Access attaches (`Cf-Access-Jwt-Assertion`): its signature against the
 * team's published keys, its issuer and its audience (this stack's Access
 * application). So a deleted or loosened Access policy, or a request that
 * reaches the Worker some other way, still gets a 403.
 */
import { listOutbox, type OutboxEmail } from "@flareling/email";
import { log } from "@flareling/log";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface OutboxSettings {
  readonly enabled: boolean;
  /** `<team>.cloudflareaccess.com` */
  readonly teamDomain: string | undefined;
  /** The outbox Access application's audience tag. */
  readonly aud: string | undefined;
  /** Links to this origin (sign-in links) are made clickable; others aren't. */
  readonly appBaseUrl: string;
}

// One key set per team domain, cached for the isolate's life; jose refetches
// the keys when Access rotates them.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySet(teamDomain: string) {
  let set = keySets.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
    );
    keySets.set(teamDomain, set);
  }
  return set;
}

/** Who Access says is asking, or null if the token is missing or invalid. */
export async function accessViewer(
  request: Request,
  teamDomain: string,
  aud: string,
): Promise<string | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keySet(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience: aud,
      algorithms: ["RS256"],
    });
    return typeof payload.email === "string" ? payload.email : "service token";
  } catch {
    return null;
  }
}

const notFound = () => new Response("Not Found", { status: 404 });

export async function handleOutbox(
  request: Request,
  settings: OutboxSettings,
  list: () => Promise<OutboxEmail[]> = () => listOutbox(),
): Promise<Response> {
  if (!settings.enabled || !settings.teamDomain || !settings.aud) {
    return notFound();
  }
  const viewer = await accessViewer(request, settings.teamDomain, settings.aud);
  if (!viewer) {
    log.warn("outbox.access_denied");
    return new Response("Forbidden", { status: 403 });
  }
  const emails = await list();
  return new Response(renderOutbox(emails, settings.appBaseUrl), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Working sign-in links: never cached, indexed, or sent as a referrer.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** The text, escaped, with links to `origin` made clickable. */
export function linkify(text: string, origin: string): string {
  const own = new URL(origin).origin;
  let html = "";
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    html += escapeHtml(text.slice(last, match.index));
    const url = match[0];
    let isOwn = false;
    try {
      isOwn = new URL(url).origin === own;
    } catch {
      // Not a URL after all; left as text.
    }
    html += isOwn
      ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`
      : escapeHtml(url);
    last = match.index + url.length;
  }
  return html + escapeHtml(text.slice(last));
}

export function renderOutbox(
  emails: OutboxEmail[],
  appBaseUrl: string,
): string {
  const items = emails
    .map(
      (e) => `<article>
  <h2>${escapeHtml(e.subject)}</h2>
  <p class="meta">To ${escapeHtml(e.to)} · ${escapeHtml(e.kind)} · <time datetime="${e.createdAt.toISOString()}">${e.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC</time></p>
  <pre>${linkify(e.text, appBaseUrl)}</pre>
</article>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Outbox</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  article { border-top: 1px solid #ccc; padding: 1rem 0; }
  h2 { font-size: 1.1rem; margin: 0; }
  .meta { color: #555; margin: 0.25rem 0; font-size: 0.9rem; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style>
</head>
<body>
<h1>Outbox</h1>
<p>Email this dev environment would have sent, newest first. Kept for a day.</p>
${items || "<p>Nothing yet.</p>"}
</body>
</html>`;
}
