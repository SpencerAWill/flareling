import { getDb, inJsonArray, schema } from "@flareling/db";
import { and, eq } from "drizzle-orm";
import { type Entitlements, PLANS, type PlanName } from "./plans.ts";

const { subscriptions } = schema;

/**
 * Statuses that keep a plan's entitlements. `past_due` is included: Stripe is
 * retrying the payment, and cutting a team off mid-retry is worse than a few
 * days' grace. Stripe moves it to `canceled` or `unpaid` if retries run out.
 */
const ENTITLED = ["active", "trialing", "past_due"];

export interface WorkspacePlan {
  readonly plan: PlanName;
  readonly entitlements: Entitlements;
  /** Set when the plan comes from a subscription. */
  readonly subscription?: {
    readonly status: string;
    readonly currentPeriodEnd: Date | null;
    readonly cancelAtPeriodEnd: boolean;
  };
}

/** The workspace's plan and what it grants: Free unless a subscription says otherwise. */
export async function workspacePlan(
  workspaceId: string,
): Promise<WorkspacePlan> {
  const rows = await getDb()
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.workspaceId, workspaceId),
        inJsonArray(subscriptions.status, ENTITLED),
      ),
    );
  // A plan name this code doesn't know (a price with an unmapped lookup key)
  // grants nothing beyond Free.
  const known = rows.find((r) => r.plan in PLANS && r.plan !== "free");
  if (!known) return { plan: "free", entitlements: PLANS.free.entitlements };
  const plan = known.plan as PlanName;
  return {
    plan,
    entitlements: PLANS[plan].entitlements,
    subscription: {
      status: known.status,
      currentPeriodEnd: known.currentPeriodEnd,
      cancelAtPeriodEnd: known.cancelAtPeriodEnd,
    },
  };
}
