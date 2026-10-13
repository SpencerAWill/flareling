# 0006. Supply-chain defaults: quarantine, trust policy, pinning

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

Compromised npm releases (hijacked maintainer tokens, malicious postinstall scripts) are usually detected and pulled within days. A project that installs the newest version of everything as soon as it's published takes that risk on every install. CI has the same exposure through third-party Actions and downloaded binaries.

## Decision

We will apply these defaults, and keep them when adding tools:

- **Release-age quarantine.** `minimumReleaseAge: 10080` (7 days) in `pnpm-workspace.yaml`. The same rule is applied by hand to `packageManager`, Docker images, Actions, and binary pins, and Dependabot's cooldowns match it (30 days for npm majors).
- **Trust policy.** `trustPolicy: no-downgrade` fails install when a version's publish provenance is weaker than an earlier one's. Exceptions in `trustPolicyExclude` are exact versions, each with its reason.
- **Opt-in install scripts.** Only packages listed in `allowBuilds` may run them, each with a note on why.
- **Pinned Actions and binaries.** Actions are pinned to commit SHAs. Tools downloaded in CI or the dev container (actionlint, zizmor, gitleaks) come from pinned releases and are checked against SHA-256, not installed with `curl | sh`.
- **Secret scanning.** gitleaks runs on staged changes before each commit and over the full history in CI.

## Consequences

- A just-released fix can't be installed for a week without a deliberate, documented `minimumReleaseAgeExclude` entry.
- Some legitimate packages trip the trust policy (for example a maintenance release published without provenance after a newer line had it), and each one needs a reviewed exception.
- Pins don't update themselves: Dependabot moves npm packages, Actions, dev container features, and compose images. The gitleaks version is bumped by hand in both `.devcontainer/Dockerfile` and `ci.yml`.
