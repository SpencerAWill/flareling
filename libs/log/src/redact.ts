/**
 * Redaction for anything that reaches logs.
 *
 * Workers Logs (`observability.enabled` with `head_sampling_rate: 1` in each
 * wrangler.jsonc) captures every invocation, keeps it for days, and is
 * readable by anyone with dashboard access to the account. So log lines carry
 * non-PII context only, and any field that might hold user data goes through
 * one of these first:
 *
 *   - `redactEmail` for a field holding an email address. The local part is
 *     masked to its first character, and the domain is kept, so an operator
 *     can still tell populations of users apart without learning who they are.
 *   - `redactUrl` for an outbound URL that may carry a token (a magic link,
 *     an OAuth callback). The path is kept; the query and fragment, where
 *     tokens live, are dropped.
 *   - `redactString` for freeform text that may embed either (an error
 *     message from an external API, user-typed text).
 *
 * Ported from ucmc.spencerwill.com, where mutation testing found two holes
 * that its tests now pin: the anchors on STRICT_EMAIL_PATTERN, and `https?`
 * rather than `https` in URL_PATTERN.
 */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Anchored at both ends for whole-string validation in `redactEmail`. Without
// the trailing `$`, "alice@example.com SECRET" would validate and log as
// "a***@example.com SECRET".
const STRICT_EMAIL_PATTERN =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
// Stops at characters that almost always end a URL in the text we redact
// (JSON bodies, error messages): whitespace, quotes, angle brackets, brackets
// of every kind, and the comma and semicolon that surround embedded URLs.
// `?`, `&`, `=` and `#` are deliberately not terminators, so a query string
// carrying a token is part of the match and goes with it.
const URL_PATTERN = /https?:\/\/[^\s"'<>(){}[\]|\\^`,;]+/g;

/**
 * Masks an email's local part: `alice@example.com` becomes `a***@example.com`.
 * Anything that isn't a strictly valid address returns `<malformed>` rather
 * than echoing any part of it.
 */
export function redactEmail(email: string | null | undefined): string {
  if (!email) {
    return "<empty>";
  }
  if (!STRICT_EMAIL_PATTERN.test(email)) {
    return "<malformed>";
  }
  const at = email.indexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 1) {
    return `*${domain}`;
  }
  return `${local[0]}***${domain}`;
}

/**
 * Drops a URL's query and fragment: `https://app/auth/callback?token=abc`
 * becomes `https://app/auth/callback`, so which endpoint was involved stays
 * readable without the token.
 */
export function redactUrl(url: string | null | undefined): string {
  if (!url) {
    return "<empty>";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<malformed>";
  }
}

/**
 * Replaces URL- and email-shaped substrings in freeform text. Conservative:
 * it removes only what it can recognize, and makes no attempt at other PII
 * (names, phone numbers), which it couldn't detect reliably anyway.
 */
export function redactString(text: string): string {
  return text
    .replace(URL_PATTERN, "<url-redacted>")
    .replace(EMAIL_PATTERN, "<email-redacted>");
}
