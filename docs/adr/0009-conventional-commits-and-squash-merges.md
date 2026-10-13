# 0009. Conventional Commits, squash merges, linted PR titles

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

A readable `main` history makes it possible to see what changed and why, to generate changelogs, and to find the commit that broke something. Branch histories are full of work-in-progress commits, and enforcing a format on every one of them adds friction without improving `main`.

## Decision

We will merge PRs by squash only, with the PR title as the commit message on `main`, and require Conventional Commits:

- The `commit-msg` hook runs `commitlint --strict` locally, and `pnpm commit` offers a guided prompt built from the same config.
- `lint-pr.yml` runs the repo's own commitlint on each PR title, from the `pull_request` event payload. It doesn't use `pull_request_target`, a third-party action, or a second rule set.
- `commitlint.config.js` is the only source of the rules. Its one exception lets Dependabot's capitalized "Bump" through.

## Consequences

- `main` has one Conventional Commit per PR, and the PR title is what gets reviewed for it.
- Squash merging loses the branch's individual commits on `main`. They stay readable on the closed PR.
- The repo settings (squash only, PR title as message, delete branch on merge) live in `infra/github`, so they are reviewed like code.
