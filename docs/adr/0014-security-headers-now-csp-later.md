# 0014. Security headers now, script CSP later

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Browsers enforce a set of protections only when a response asks for them: HTTPS-only (HSTS), no MIME sniffing, no framing (clickjacking), a referrer policy, and a Content Security Policy that limits where scripts can come from.

The useful part of a CSP for a server-rendered React app is `script-src` with a per-request nonce, since TanStack Start emits inline scripts for hydration. TanStack Start supports a nonce (`router.options.ssr.nonce`), but an open bug duplicates inline scripts after hydration when the policy is sent as a response header ([TanStack/router#8550](https://github.com/TanStack/router/issues/8550)), and an earlier one left some inline scripts without the nonce (#5511). A hash-based policy would have to track Start's inline scripts, which change between versions.

## Decision

We will send these headers on every Worker response now, from Start request middleware (`apps/web/src/server/security-headers.ts`): `Strict-Transport-Security` (two years, subdomains of this host only, no preload), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`, `Permissions-Policy` for unused features, and a CSP limited to directives that can't break scripts (`frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`).

A nonce-based `script-src` is added once TanStack/router#8550 is fixed and released, verified by the E2E suite's console-error check.

## Consequences

- The cheap, universal protections are in place from the first deploy.
- Until `script-src` lands, an injected script is not blocked by CSP, so output encoding (React's default) remains the XSS defense.
- HSTS is sticky in browsers for two years, so a hostname that serves it must keep serving HTTPS.
- A middleware sets the headers only where a response hasn't set its own, so a route can override one deliberately.
