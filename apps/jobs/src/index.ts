import {
  createStripe,
  processStripeEvent,
  stripeEventMessage,
} from "@flareling/billing";
import { errorMessage, log, runWithLogContext } from "@flareling/log";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { getEnv } from "./env.ts";
import { runRetentionSweeps } from "./retention.ts";

/**
 * Cron expressions, as in wrangler.jsonc's `triggers.crons`. The two must
 * agree: a trigger with no case here fails loudly in `scheduled`.
 */
export const CRONS = {
  /** Daily, 03:17 UTC: off the hour, when scheduled work bunches up. */
  retention: "17 3 * * *",
} as const;

/**
 * Every message this Worker accepts, told apart by `kind`, each owned by the
 * lib that produces it. Bodies are parsed with this, not trusted: a message
 * that doesn't match (an unknown kind, a newer producer, a bad hand replay)
 * fails with the reason, is retried, and ends in the dead-letter queue.
 */
const jobMessage = z.discriminatedUnion("kind", [stripeEventMessage]);

/**
 * Delay before retry n (1-based): 30 s, 1 min, 2 min, 4 min, 8 min. With
 * `max_retries: 5` a message has about a quarter of an hour of attempts
 * before it moves to the dead-letter queue, which outlasts a typical Stripe
 * or D1 blip.
 */
export function retryDelaySeconds(attempts: number): number {
  // Capped well under Queues' 24 h limit on `delaySeconds`.
  return Math.min(30 * 2 ** (attempts - 1), 12 * 60 * 60);
}

async function handle(raw: unknown): Promise<void> {
  const parsed = jobMessage.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Malformed job message: ${z.prettifyError(parsed.error)}`);
  }
  const body = parsed.data;
  switch (body.kind) {
    case "stripe.event": {
      const env = getEnv();
      if (!env.STRIPE_SECRET_KEY) {
        throw new Error("STRIPE_SECRET_KEY is not set.");
      }
      const stripe = createStripe({
        secretKey: env.STRIPE_SECRET_KEY,
        apiBase: env.STRIPE_API_BASE,
      });
      const result = await processStripeEvent(stripe, body);
      log.info("billing.stripe_event", {
        eventId: body.id,
        type: body.type,
        result,
      });
      return;
    }
  }
}

export default {
  async scheduled(controller: ScheduledController): Promise<void> {
    await runWithLogContext({ cron: controller.cron }, async () => {
      switch (controller.cron) {
        case CRONS.retention:
          await runRetentionSweeps(
            Temporal.Instant.fromEpochMilliseconds(controller.scheduledTime),
          );
          return;
        default:
          throw new Error(`No handler for cron "${controller.cron}"`);
      }
    });
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    // One message at a time: each is a few subrequests, and acking or
    // retrying each separately means one bad message never redelivers the
    // rest of its batch.
    for (const message of batch.messages) {
      await runWithLogContext(
        {
          queue: batch.queue,
          messageId: message.id,
          attempts: message.attempts,
        },
        async () => {
          try {
            await handle(message.body);
            message.ack();
          } catch (err) {
            log.error("job.failed", { error: errorMessage(err) });
            message.retry({
              delaySeconds: retryDelaySeconds(message.attempts),
            });
          }
        },
      );
    }
  },
} satisfies ExportedHandler<Env, unknown>;
