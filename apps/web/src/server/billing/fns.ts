/**
 * Server functions for a workspace's billing page. Thin shells, as in
 * src/server/auth/fns.ts: validate, then call libs/billing through a dynamic
 * import. Results are values rather than thrown errors, so the page can say
 * what went wrong.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const workspaceInput = z.object({ workspaceId: z.uuid() });

async function signedIn() {
  const { getPrincipal } = await import("@flareling/auth");
  const { authContext } = await import("../auth/context.server.ts");
  return getPrincipal(authContext());
}

/**
 * The workspace's plan, for any member. Non-members get the same answer as a
 * workspace that doesn't exist.
 */
export const getBillingFn = createServerFn({ method: "GET" })
  .validator(workspaceInput)
  .handler(async ({ data }) => {
    const { listWorkspaces } = await import("@flareling/core");
    const { PLANS, workspacePlan } = await import("@flareling/billing");
    const { billingContext } = await import("./context.server.ts");
    const principal = await signedIn();
    if (!principal) return { ok: false as const };
    const workspace = (await listWorkspaces(principal.userId)).find(
      (w) => w.id === data.workspaceId,
    );
    if (!workspace) return { ok: false as const };
    const plan = await workspacePlan(workspace.id);
    return {
      ok: true as const,
      workspace: { id: workspace.id, name: workspace.name },
      plan: plan.plan,
      members: plan.entitlements.members,
      // Each plan's member limit, for the comparison on the page.
      memberLimits: {
        free: PLANS.free.entitlements.members,
        pro: PLANS.pro.entitlements.members,
      },
      subscription: plan.subscription
        ? {
            status: plan.subscription.status,
            // ISO strings: Start's serializer and the client both handle them.
            currentPeriodEnd:
              plan.subscription.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: plan.subscription.cancelAtPeriodEnd,
          }
        : null,
      canManage: workspace.role === "owner" || workspace.role === "admin",
      enabled: billingContext() !== null,
    };
  });

type Redirect = { ok: true; url: string } | { ok: false; reason: string };

/** Turns libs/billing's errors into a reason the page can show. */
async function toRedirect(run: () => Promise<string>): Promise<Redirect> {
  const { ForbiddenError, UnauthorizedError } = await import("@flareling/auth");
  const { errorMessage, log } = await import("@flareling/log");
  try {
    return { ok: true, url: await run() };
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return { ok: false, reason: "unauthorized" };
    if (err instanceof ForbiddenError)
      return { ok: false, reason: "forbidden" };
    log.error("billing.redirect_failed", { error: errorMessage(err) });
    return { ok: false, reason: "unavailable" };
  }
}

/** A Stripe Checkout URL for Pro, billed monthly or yearly. */
export const startCheckoutFn = createServerFn({ method: "POST" })
  .validator(workspaceInput.extend({ interval: z.enum(["month", "year"]) }))
  .handler(async ({ data }): Promise<Redirect> => {
    const { startCheckout } = await import("@flareling/billing");
    const { billingContext } = await import("./context.server.ts");
    const ctx = billingContext();
    if (!ctx) return { ok: false, reason: "disabled" };
    const principal = await signedIn();
    return toRedirect(() =>
      startCheckout(ctx, principal, {
        workspaceId: data.workspaceId,
        plan: "pro",
        interval: data.interval,
      }),
    );
  });

/** A Stripe Customer Portal URL. */
export const openBillingPortalFn = createServerFn({ method: "POST" })
  .validator(workspaceInput)
  .handler(async ({ data }): Promise<Redirect> => {
    const { openBillingPortal } = await import("@flareling/billing");
    const { billingContext } = await import("./context.server.ts");
    const ctx = billingContext();
    if (!ctx) return { ok: false, reason: "disabled" };
    const principal = await signedIn();
    return toRedirect(() =>
      openBillingPortal(ctx, principal, data.workspaceId),
    );
  });
