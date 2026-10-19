import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@flareling/ui";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CreditCardIcon, PartyPopperIcon, ZapIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import {
  getBillingFn,
  openBillingPortalFn,
  startCheckoutFn,
} from "#/server/billing/fns.ts";

export const Route = createFileRoute("/w/$publicId/billing")({
  validateSearch: z.object({ checkout: z.literal("success").optional() }),
  loader: async ({ parentMatchPromise }) => {
    const { workspace } = (await parentMatchPromise).loaderData ?? {};
    if (!workspace) throw notFound();
    const billing = await getBillingFn({
      data: { workspaceId: workspace.id },
    }).catch(() => ({ ok: false as const }));
    // Non-members, unknown ids and malformed ids all look the same.
    if (!billing.ok) throw notFound();
    return billing;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `Billing · ${loaderData?.workspace.name ?? "Workspace"} · Flareling`,
      },
    ],
  }),
  component: Billing,
});

const PLAN_NAMES = { free: "Free", pro: "Pro" } as const;

const REASONS: Record<string, string> = {
  unauthorized: "Your session has ended. Sign in again to continue.",
  forbidden: "Only the workspace's owners and admins can manage billing.",
  disabled: "Billing isn't set up for this app.",
  unavailable: "Stripe couldn't be reached. Try again in a moment.",
};

function Billing() {
  const billing = Route.useLoaderData();
  const { checkout } = Route.useSearch();
  const startCheckout = useServerFn(startCheckoutFn);
  const openPortal = useServerFn(openBillingPortalFn);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(
    request: () => Promise<
      { ok: true; url: string } | { ok: false; reason: string }
    >,
  ) {
    setPending(true);
    setError(null);
    const result = await request().catch(() => ({
      ok: false as const,
      reason: "unavailable",
    }));
    if (result.ok) {
      // Stripe's hosted page. The page stays disabled while the browser leaves.
      window.location.assign(result.url);
      return;
    }
    setError(REASONS[result.reason] ?? REASONS.unavailable ?? null);
    setPending(false);
  }

  const workspaceId = billing.workspace.id;
  const subscription = billing.subscription;
  const periodEnd = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, {
        dateStyle: "long",
      })
    : null;

  const upgradeButtons = (
    <div className="grid gap-2 sm:grid-cols-2">
      <Button
        variant="flare"
        disabled={pending}
        onClick={() =>
          go(() => startCheckout({ data: { workspaceId, interval: "month" } }))
        }
      >
        Upgrade to Pro, monthly
      </Button>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          go(() => startCheckout({ data: { workspaceId, interval: "year" } }))
        }
      >
        Upgrade to Pro, yearly
      </Button>
    </div>
  );

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Billing for {billing.workspace.name}
      </h1>

      {checkout === "success" && (
        <p
          role="status"
          className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <PartyPopperIcon
            className="size-5 shrink-0 text-success"
            aria-hidden
          />
          Thanks! Your plan changes here as soon as Stripe confirms the payment,
          usually within a few seconds. Reload to check.
        </p>
      )}

      <section aria-labelledby="plan-heading">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="plan-heading" className="text-lg">
                Current plan: {PLAN_NAMES[billing.plan]}
              </h2>
            </CardTitle>
            <CardDescription>
              Up to {billing.members}{" "}
              {billing.members === 1 ? "member" : "members"}.
              {subscription && periodEnd && (
                <>
                  {" "}
                  {subscription.cancelAtPeriodEnd
                    ? `Ends on ${periodEnd}.`
                    : `Renews on ${periodEnd}.`}
                  {subscription.status === "past_due" &&
                    " The last payment failed; Stripe is retrying it. Update your payment method to keep Pro."}
                </>
              )}
            </CardDescription>
            <CardAction>
              <Badge
                className={
                  billing.plan === "pro" ? "bg-flare text-white" : undefined
                }
                variant={billing.plan === "pro" ? "default" : "secondary"}
              >
                {PLAN_NAMES[billing.plan]}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!billing.enabled ? (
              <p className="text-sm text-muted-foreground">
                {REASONS.disabled}
              </p>
            ) : !billing.canManage ? (
              <p className="text-sm text-muted-foreground">
                {REASONS.forbidden}
              </p>
            ) : billing.plan === "free" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <PlanTile
                    name="Free"
                    members={billing.memberLimits.free}
                    current={billing.plan === "free"}
                  />
                  <PlanTile
                    name="Pro"
                    members={billing.memberLimits.pro}
                    highlight
                  />
                </div>
                {upgradeButtons}
              </>
            ) : (
              <Button
                variant="secondary"
                className="self-start"
                disabled={pending}
                onClick={() => go(() => openPortal({ data: { workspaceId } }))}
              >
                <CreditCardIcon />
                Manage subscription
              </Button>
            )}

            {/* Owners and admins of a Free workspace may still have a Stripe
                customer with invoices from a past subscription. */}
            {billing.enabled &&
              billing.canManage &&
              billing.plan === "free" && (
                <button
                  type="button"
                  className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  disabled={pending}
                  onClick={() =>
                    go(() => openPortal({ data: { workspaceId } }))
                  }
                >
                  Billing history and payment methods
                </button>
              )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

/** One plan's headline numbers, for the Free-versus-Pro comparison. */
function PlanTile({
  name,
  members,
  current = false,
  highlight = false,
}: {
  name: string;
  members: number;
  current?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col gap-1 rounded-xl border p-4 ${highlight ? "border-transparent ring-2 ring-flare-to/40" : ""}`}
    >
      <span className="flex items-center justify-between font-medium">
        {name}
        {current && <Badge variant="outline">Current</Badge>}
        {highlight && <ZapIcon className="size-4 text-flare-to" aria-hidden />}
      </span>
      <span className="text-sm text-muted-foreground">
        Up to {members} members
      </span>
    </div>
  );
}
