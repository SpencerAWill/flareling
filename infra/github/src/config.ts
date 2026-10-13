import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const githubConfig = new pulumi.Config("github");

const plans = ["free", "pro", "team", "enterprise"] as const;
type Plan = (typeof plans)[number];

const visibilities = ["public", "private"] as const;
type Visibility = (typeof visibilities)[number];

function oneOf<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = config.get(key) ?? fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `config ${key}=${value} is not one of: ${allowed.join(", ")}`,
    );
  }
  return value as T;
}

// Fail fast if unset. Without it the provider silently targets whichever
// account the token belongs to.
githubConfig.require("owner");
export const repositoryName = config.require("repository");
export const description = config.get("description") ?? "";
export const visibility = oneOf<Visibility>(
  "visibility",
  visibilities,
  "private",
);
export const plan = oneOf<Plan>("plan", plans, "free");
export const isTemplate = config.getBoolean("isTemplate") ?? false;

/** Status check names required on the default branch. Empty until CI exists. */
export const requiredChecks =
  config.getObject<string[]>("requiredChecks") ?? [];

/** GitHub user IDs allowed to approve prod deploys, where the plan allows it. */
export const prodReviewerIds =
  config.getObject<number[]>("prodReviewerIds") ?? [];

/**
 * Cloudflare account to mint CI tokens in. Optional: without it the GitHub
 * side applies on its own, so a new repo can be locked down before its
 * Cloudflare account exists.
 */
export const cloudflareAccountId = config.get("cloudflareAccountId");

/**
 * Which GitHub features this repo can use, derived from visibility and plan.
 *
 * A private repo on the free plan gets none of the gated features, so the
 * program skips those resources instead of failing the run. Sources (checked
 * 2026-10-12):
 * - Rulesets, environment secrets/variables, and deployment branch policies on
 *   private repos need Pro, Team, or Enterprise.
 * - Required reviewers on environments are public-only for personal accounts
 *   on every plan, and need Enterprise for private org repos.
 * - Secret scanning on private repos needs GitHub Secret Protection, which
 *   personal accounts cannot buy.
 */
const isPublic = visibility === "public";
const isPaid = plan !== "free";

export const features = {
  rulesets: isPublic || isPaid,
  environments: isPublic || isPaid,
  requiredReviewers: isPublic || plan === "enterprise",
  secretScanning: isPublic,
};
