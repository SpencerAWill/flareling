import { nowOf, withinRateLimit } from "@flareling/auth";
import { workspacePlan } from "@flareling/billing";
import type { InviteContext } from "@flareling/core";
import { authContext } from "../auth/context.server.ts";

/**
 * libs/core's InviteContext for this request: the auth context's email
 * sender, links, clock and rate limiter (shared with sign-in, so one inviter can't
 * send more than sign-in allows), and seats from the workspace's plan.
 */
export function inviteContext(): InviteContext {
  const auth = authContext();
  return {
    appBaseUrl: auth.config.appBaseUrl,
    appName: auth.config.appName,
    email: auth.email,
    seats: async (workspaceId) =>
      (await workspacePlan(workspaceId)).entitlements.members,
    withinRateLimit: (key) => withinRateLimit(auth, key),
    now: () => nowOf(auth),
  };
}
