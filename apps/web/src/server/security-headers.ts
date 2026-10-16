/**
 * Security headers for every response the Worker serves. Static assets are
 * served by Workers Assets before the Worker runs, so they don't get these;
 * that's fine, since none of these headers protect a static file.
 *
 * Deliberately no `script-src` yet. A nonce-based CSP is blocked by a
 * TanStack Start bug (inline scripts are duplicated after hydration when the
 * policy is sent as a header, TanStack/router#8550); see
 * docs/adr/0014-security-headers-now-csp-later.md. The CSP below covers only
 * directives that can't break scripts.
 *
 * Move this to a shared lib when a second app needs it.
 */
export const securityHeaders: Readonly<Record<string, string>> = {
  // HTTPS only, for two years, including this host's subdomains. Not
  // `preload`, and it covers only this hostname and below, never the rest of
  // a shared zone.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Never framed (clickjacking); X-Frame-Options for older browsers.
  "Content-Security-Policy":
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  "X-Frame-Options": "DENY",
  // Keeps other origins' windows from holding a reference to this one.
  "Cross-Origin-Opener-Policy": "same-origin",
  // Features no page here uses. Passkeys (publickey-credentials-*) are left
  // at the default, which allows this origin.
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
};

/** Adds the security headers to `response`, without overriding any it sets. */
export function withSecurityHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!response.headers.has(name)) {
      response.headers.set(name, value);
    }
  }
  return response;
}
