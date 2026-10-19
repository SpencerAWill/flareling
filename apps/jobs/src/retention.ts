/**
 * The daily sweep: deletes rows that have outlived their use. Each sweep is
 * independent, so one failing (D1 overloaded, say) doesn't stop the rest; a
 * failure is logged and the next day's run tries again. One log line records
 * what each deleted, and whether it stopped with rows left (a backlog it
 * works through over the following days).
 */
import { sweepExpiredAuthRows } from "@flareling/auth";
import { sweepStripeEvents } from "@flareling/billing";
import { sweepWorkspaceInvites } from "@flareling/core";
import { sweepEmailOutbox } from "@flareling/email";
import { errorMessage, log } from "@flareling/log";
import type { Temporal } from "temporal-polyfill";

export async function runRetentionSweeps(
  now: Temporal.Instant,
): Promise<Record<string, unknown>> {
  const sweeps: Record<string, () => Promise<unknown>> = {
    auth: () => sweepExpiredAuthRows(now),
    stripeEvents: () => sweepStripeEvents(new Date(now.epochMilliseconds)),
    emailOutbox: () => sweepEmailOutbox(new Date(now.epochMilliseconds)),
    workspaceInvites: () =>
      sweepWorkspaceInvites(new Date(now.epochMilliseconds)),
  };
  const results: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(sweeps)) {
    try {
      results[name] = await run();
    } catch (err) {
      results[name] = "failed";
      log.error("retention.sweep_failed", {
        sweep: name,
        error: errorMessage(err),
      });
    }
  }
  log.info("retention.sweeps_complete", results);
  return results;
}
