# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

flareling is a template. Every project created from it inherits its choices, often without the conversations that produced them. A setting that looks arbitrary (a pinned compatibility date, a 7-day install quarantine, a lint rule) is easy to "clean up" by someone who doesn't know what it prevents. The README describes the target architecture but is the wrong place for the reasoning behind each choice, and code comments explain one file at a time.

## Decision

We will record significant decisions as short architecture decision records in `docs/adr/`, numbered, using the format in [`template.md`](./template.md): context, decision, consequences. Decisions already made before this ADR are backfilled from the README and the commit history.

## Consequences

- A reviewer or agent can check whether a change contradicts a recorded decision, and the PR that changes one has to supersede the ADR rather than quietly drift from it.
- Writing an ADR is a small, ongoing cost. The bar is a choice someone could reasonably revisit, not every change.
- Open questions stay in the README's "Open decisions" list until they are decided, then become ADRs.
