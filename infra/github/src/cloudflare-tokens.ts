import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/**
 * Least-privilege Cloudflare permissions for each CI token, by the names
 * Cloudflare shows in the dashboard. Names are resolved to IDs at deploy time,
 * and an unknown name fails the run rather than silently granting less.
 *
 * Account-scoped groups apply to the whole account. Zone-scoped groups apply
 * only to this suite's zone (`zoneId`), never to every zone in the account:
 * the zone may be shared with other sites (spencerwill.com is), and a leaked
 * token shouldn't reach them. Zone-wide write (settings, WAF) is granted only
 * when the zone is dedicated to this suite (`zoneDedicated`).
 */
const tokenPermissions = {
  // Used by Wrangler in deploy.yml: upload Worker versions, apply D1
  // migrations (and read Time Travel bookmarks), and attach apps/jobs as its
  // queue's consumer. Everything long-lived is the infra token's job.
  deploy: {
    account: [
      "Workers Scripts Write",
      "D1 Write",
      "Queues Write",
      "Account Settings Read",
    ],
    zone: ["Workers Routes Write", "Zone Read"],
  },
  // Used by `pulumi up` on infra/cloudflare.
  infra: {
    account: [
      "Account Settings Read",
      "Workers Scripts Write",
      "D1 Write",
      "Workers KV Storage Write",
      "Workers R2 Storage Write",
      "Queues Write",
      "Access: Apps and Policies Write",
    ],
    zone: ["Zone Read", "DNS Write", "Workers Routes Write"],
    // Only for a zone dedicated to this suite.
    dedicatedZone: ["Zone Settings Write", "Zone WAF Write"],
  },
} as const;

export type TokenKind = keyof typeof tokenPermissions;

export function createCiTokens({
  accountId,
  zoneId,
  zoneDedicated,
  repositoryName,
}: {
  readonly accountId: string;
  readonly zoneId: string;
  readonly zoneDedicated: boolean;
  readonly repositoryName: string;
}): Record<TokenKind, pulumi.Output<string>> {
  const groups = cloudflare.getAccountApiTokenPermissionGroupsListOutput({
    accountId,
    maxItems: 1000,
  });

  // Some names exist at both scopes (for example "Access: Apps and Policies
  // Write"), so the lookup matches on scope as well as name.
  const scopes = {
    account: "com.cloudflare.api.account",
    zone: "com.cloudflare.api.account.zone",
  };
  const idsFor = (scope: keyof typeof scopes, names: readonly string[]) =>
    groups.results.apply((results) =>
      names.map((name) => {
        const match = results.find(
          (group) =>
            group.name === name && group.scopes.includes(scopes[scope]),
        );
        if (!match) {
          throw new Error(
            `Unknown ${scope}-scoped Cloudflare permission group: "${name}"`,
          );
        }
        return { id: match.id };
      }),
    );

  const accountResource = `com.cloudflare.api.account.${accountId}`;

  const zoneResource = JSON.stringify({
    [accountResource]: { [`com.cloudflare.api.account.zone.${zoneId}`]: "*" },
  });

  const mint = (kind: TokenKind) => {
    const permissions = tokenPermissions[kind];
    const zone = [
      ...permissions.zone,
      ...(zoneDedicated && "dedicatedZone" in permissions
        ? permissions.dedicatedZone
        : []),
    ];
    const { account } = permissions;
    const token = new cloudflare.AccountToken(`${kind}-token`, {
      accountId,
      name: `${repositoryName} CI (${kind})`,
      policies: [
        {
          effect: "allow",
          permissionGroups: idsFor("account", account),
          resources: JSON.stringify({ [accountResource]: "*" }),
        },
        {
          effect: "allow",
          permissionGroups: idsFor("zone", zone),
          resources: zoneResource,
        },
      ],
    });
    return pulumi.secret(token.value);
  };

  return { deploy: mint("deploy"), infra: mint("infra") };
}
