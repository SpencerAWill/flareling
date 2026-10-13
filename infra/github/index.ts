import * as github from "@pulumi/github";
import { createCiTokens } from "./src/cloudflare-tokens.ts";
import {
  cloudflareAccountId,
  features,
  prodReviewerIds,
  repositoryName,
} from "./src/config.ts";
import { repository } from "./src/repository.ts";

/**
 * GitHub settings and CI secrets for this repo. See the "GitHub as code"
 * section of the README for what is managed here and why.
 *
 * Run locally by a repo admin, never in CI: the Actions GITHUB_TOKEN cannot
 * change repo settings or write secrets, and CI should not hold a credential
 * that can loosen its own rules.
 */

const environmentNames = ["dev", "prod"] as const;

const environments = features.environments
  ? environmentNames.map((name) => {
      const environment = new github.RepositoryEnvironment(name, {
        repository: repository.name,
        environment: name,
        canAdminsBypass: true,
        ...(name === "prod" &&
          features.requiredReviewers &&
          prodReviewerIds.length > 0 && {
            preventSelfReview: false,
            reviewers: [{ users: prodReviewerIds }],
          }),
        deploymentBranchPolicy: {
          protectedBranches: false,
          customBranchPolicies: true,
        },
      });

      // Only main may deploy to either environment.
      new github.RepositoryEnvironmentDeploymentPolicy(`${name}-main-only`, {
        repository: repository.name,
        environment: environment.environment,
        branchPattern: "main",
      });

      return { name, environment };
    })
  : [];

const tokens = cloudflareAccountId
  ? createCiTokens(cloudflareAccountId, repositoryName)
  : undefined;

if (cloudflareAccountId && tokens) {
  // Not a secret, so it is a plain repository variable on every plan.
  new github.ActionsVariable("cloudflare-account-id", {
    repository: repository.name,
    variableName: "CLOUDFLARE_ACCOUNT_ID",
    value: cloudflareAccountId,
  });

  const secrets = {
    CLOUDFLARE_API_TOKEN: tokens.deploy,
    CLOUDFLARE_INFRA_API_TOKEN: tokens.infra,
  };

  for (const [secretName, value] of Object.entries(secrets)) {
    if (environments.length > 0) {
      // Scoped per environment, so only jobs that declare `environment:` (and
      // pass its branch policy and reviewers) can read them.
      for (const { name, environment } of environments) {
        new github.ActionsEnvironmentSecret(
          `${name}-${secretName}`.toLowerCase(),
          {
            repository: repository.name,
            environment: environment.environment,
            secretName,
            value,
          },
        );
      }
    } else {
      // Plan without environments: fall back to repository-level secrets.
      new github.ActionsSecret(secretName.toLowerCase(), {
        repository: repository.name,
        secretName,
        value,
      });
    }
  }
}

export const repositoryUrl = repository.htmlUrl;
export const enabledFeatures = features;

/**
 * The infra token, so local runs of infra/cloudflare use the same scoped token
 * as CI (infra/cloudflare/with-infra-token.sh reads it). Encrypted in state and
 * shown only with --show-secrets.
 */
export const cloudflareInfraToken = tokens?.infra;
