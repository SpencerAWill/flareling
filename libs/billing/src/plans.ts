/**
 * Plans, and what each one grants, defined in code. Stripe holds the prices;
 * each price has a lookup key (set in the Stripe dashboard or API) that maps
 * it to a plan here, so price ids never appear in code or config and a price
 * can be replaced (a new amount) by moving its lookup key.
 *
 * Code checks entitlements, never plan names, so changing what a plan
 * includes is an edit here, not a hunt through feature code.
 */

export interface Entitlements {
  /** How many people a workspace can have. */
  readonly members: number;
}

export const PLANS = {
  free: {
    name: "Free",
    entitlements: { members: 1 },
  },
  pro: {
    name: "Pro",
    entitlements: { members: 25 },
    /** Stripe price lookup keys, by billing interval. */
    prices: { month: "pro_monthly", year: "pro_yearly" },
  },
} as const satisfies Record<
  string,
  {
    readonly name: string;
    readonly entitlements: Entitlements;
    readonly prices?: Readonly<Record<"month" | "year", string>>;
  }
>;

export type PlanName = keyof typeof PLANS;
export type PaidPlanName = {
  [K in PlanName]: (typeof PLANS)[K] extends { prices: unknown } ? K : never;
}[PlanName];
export type BillingInterval = "month" | "year";

/** The plan a Stripe price lookup key belongs to, or undefined. */
export function planForLookupKey(
  lookupKey: string | null | undefined,
): PlanName | undefined {
  if (!lookupKey) return undefined;
  for (const [plan, definition] of Object.entries(PLANS)) {
    if (
      "prices" in definition &&
      (Object.values(definition.prices) as readonly string[]).includes(
        lookupKey,
      )
    ) {
      return plan as PlanName;
    }
  }
  return undefined;
}
