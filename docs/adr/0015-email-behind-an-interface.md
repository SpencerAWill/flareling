# 0015. Email behind an interface, provider decided later

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Sign-in by magic link needs to send email from the first feature, but the provider is still open:

- **Resend:** a REST API with a free tier (3,000 a month, 100 a day), and what ucmc.spencerwill.com uses.
- **Cloudflare Email Service:** a native `send_email` binding with no extra account or secret, but sending is still in beta, and sending to arbitrary recipients needs Workers Paid.

ucmc also recorded a lesson about fallbacks: it once logged emails to the console when no provider was configured, which either put magic-link URLs into dashboard-readable Workers Logs or left people waiting for an email that never arrived.

## Decision

We will send email through `@flareling/email`: an `EmailSender` with one method, `send({ kind, to, subject, text, html })`, created by `createEmailSender(config)`. The only implementation today posts to Mailpit's HTTP API (`POST /api/v1/send`), the dev container's inbox. With nothing configured, sending throws `EmailNotConfiguredError`. There is no console fallback.

Log lines record the email's `kind` and the provider, never the recipient or the content.

Choosing a provider later means one new implementation and one branch in `createEmailSender`, plus its env variables.

## Consequences

- Auth and other features can be built and tested end to end now, against Mailpit locally and an MSW mock in tests.
- Nothing can be emailed from a deployed Worker until a provider is chosen. That has to happen before the first deploy that needs sign-in.
- Sending should move to a Queue consumer (`apps/jobs`) once it exists, so a slow provider never holds a request open.
