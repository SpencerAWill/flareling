import {
  createStripe,
  processStripeEvent,
  type StripeEventMessage,
} from "@flareling/billing";
import { errorMessage, log, runWithLogContext } from "@flareling/log";
import { getEnv } from "./env.ts";

/** Every message this Worker accepts, told apart by `kind`. */
export type JobMessage = StripeEventMessage;

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

async function handle(body: JobMessage): Promise<void> {
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
    default: {
      // A producer newer than this consumer, or a typo. Retrying sends it to
      // the dead-letter queue, where it can be inspected and replayed.
      const kind = (body as { kind?: unknown }).kind;
      throw new Error(`Unknown job kind: ${String(kind)}`);
    }
  }
}

export default {
  async queue(batch: MessageBatch<JobMessage>): Promise<void> {
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
} satisfies ExportedHandler<Env, JobMessage>;
