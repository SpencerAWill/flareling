import { Button } from "@flareling/ui";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { requireSignedIn } from "#/lib/auth.ts";
import {
  getBillingFn,
  openBillingPortalFn,
  startCheckoutFn,
} from "#/server/billing/fns.ts";

export const Route = createFileRoute("/w/$workspaceId/billing")({
  validateSearch: z.object({ checkout: z.literal("success").optional() }),
  beforeLoad: ({ context, location }) => ({
    principal: requireSignedIn(context.principal, location),
  }),
  loader: async ({ params }) => {
    const billing = await getBillingFn({
      data: { workspaceId: params.workspaceId },
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

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6">
      <p>
        <Link to="/my/account" className="text-sm underline">
          Your account
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">
        Billing for {billing.workspace.name}
      </h1>

      {checkout === "success" && (
        <p role="status" className="rounded border border-green-700 p-3">
          Thanks! Your plan changes here as soon as Stripe confirms the payment,
          usually within a few seconds. Reload to check.
        </p>
      )}

      <section aria-labelledby="plan-heading" className="flex flex-col gap-1">
        <h2 id="plan-heading" className="text-lg font-semibold">
          Current plan: {PLAN_NAMES[billing.plan]}
        </h2>
        <p>
          Up to {billing.members} {billing.members === 1 ? "member" : "members"}
          .
        </p>
        {subscription && periodEnd && (
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            {subscription.cancelAtPeriodEnd
              ? `Ends on ${periodEnd}.`
              : `Renews on ${periodEnd}.`}
            {subscription.status === "past_due" &&
              " The last payment failed; Stripe is retrying it. Update your payment method to keep Pro."}
          </p>
        )}
      </section>

      {!billing.enabled ? (
        <p>{REASONS.disabled}</p>
      ) : !billing.canManage ? (
        <p>{REASONS.forbidden}</p>
      ) : billing.plan === "free" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              go(() =>
                startCheckout({ data: { workspaceId, interval: "month" } }),
              )
            }
          >
            Upgrade to Pro, monthly
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              go(() =>
                startCheckout({ data: { workspaceId, interval: "year" } }),
              )
            }
          >
            Upgrade to Pro, yearly
          </Button>
        </div>
      ) : (
        <Button
          className="self-start"
          disabled={pending}
          onClick={() => go(() => openPortal({ data: { workspaceId } }))}
        >
          Manage subscription
        </Button>
      )}

      {/* Owners and admins of a Free workspace may still have a Stripe
          customer with invoices from a past subscription. */}
      {billing.enabled && billing.canManage && billing.plan === "free" && (
        <button
          type="button"
          className="self-start text-sm underline"
          disabled={pending}
          onClick={() => go(() => openPortal({ data: { workspaceId } }))}
        >
          Billing history and payment methods
        </button>
      )}

      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </main>
  );
}
