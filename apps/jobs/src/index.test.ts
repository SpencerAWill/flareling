import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { getDb, schema } from "@flareling/db";
import { setupNetwork } from "@msw/cloudflare";
import { HttpResponse, http } from "msw";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import worker, { CRONS, type JobMessage, retryDelaySeconds } from "./index.ts";

const network = setupNetwork();
network.configure({ onUnhandledFrame: "error" });
beforeAll(() => network.enable());
afterEach(() => {
  network.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => network.disable());

/**
 * Runs `messages` through the consumer. The test helper records which
 * messages were retried but not their delay, so `retry` is spied on for that.
 */
async function run(
  messages: { id: string; body: unknown; attempts?: number }[],
) {
  const batch = createMessageBatch<JobMessage>(
    "flareling-dev-jobs",
    messages.map((m) => ({
      id: m.id,
      timestamp: new Date(),
      attempts: m.attempts ?? 1,
      body: m.body as JobMessage,
    })),
  );
  const delays: Record<string, number | undefined> = {};
  for (const message of batch.messages) {
    const retry = message.retry.bind(message);
    vi.spyOn(message, "retry").mockImplementation((options) => {
      delays[message.id] = options?.delaySeconds;
      retry(options);
    });
  }
  const ctx = createExecutionContext();
  await worker.queue(batch);
  return { ...(await getQueueResult(batch, ctx)), delays };
}

describe("the jobs queue consumer", () => {
  it("processes a Stripe event and acks it", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    // An event type billing records without calling Stripe.
    const result = await run([
      {
        id: "m1",
        body: { kind: "stripe.event", id: "evt_1", type: "invoice.paid" },
      },
    ]);
    expect(result.explicitAcks).toEqual(["m1"]);
    expect(result.retryMessages).toEqual([]);
    const events = await getDb().select().from(schema.stripeEvents);
    expect(events.map((e) => e.id)).toContain("evt_1");
  });

  it("retries only the message that failed, with backoff by attempt", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    network.use(
      http.get("http://stripe.test/v1/events/:id", () =>
        HttpResponse.json(
          { error: { type: "api_error", message: "down" } },
          { status: 500 },
        ),
      ),
    );
    const result = await run([
      {
        id: "bad",
        attempts: 3,
        body: {
          kind: "stripe.event",
          id: "evt_2",
          type: "customer.subscription.updated",
        },
      },
      {
        id: "good",
        body: { kind: "stripe.event", id: "evt_3", type: "invoice.paid" },
      },
    ]);
    expect(result.explicitAcks).toEqual(["good"]);
    expect(result.retryMessages).toEqual([{ msgId: "bad" }]);
    expect(result.delays).toEqual({ bad: 120 });
    expect(error).toHaveBeenCalledWith(
      "job.failed",
      expect.objectContaining({ messageId: "bad", attempts: 3 }),
    );
  });

  it("retries an unknown kind, so it ends in the dead-letter queue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await run([{ id: "m4", body: { kind: "nope" } }]);
    expect(result.retryMessages).toEqual([{ msgId: "m4" }]);
    expect(result.delays).toEqual({ m4: 30 });
  });
});

describe("retryDelaySeconds", () => {
  it("doubles from 30 s and stays under Queues' 24 h limit", () => {
    expect([1, 2, 3, 4, 5].map(retryDelaySeconds)).toEqual([
      30, 60, 120, 240, 480,
    ]);
    expect(retryDelaySeconds(100)).toBe(12 * 60 * 60);
  });
});

describe("the scheduled handler", () => {
  it("handles exactly the crons wrangler.jsonc declares", () => {
    expect(Object.values(CRONS).sort()).toEqual([...env.TEST_CRONS].sort());
  });

  it("runs the retention sweeps on the daily cron and logs what they did", async () => {
    await getDb()
      .insert(schema.stripeEvents)
      .values({
        id: "evt_ancient",
        type: "invoice.paid",
        processedAt: new Date("2020-01-01T00:00:00Z"),
      });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await worker.scheduled(
      createScheduledController({
        cron: CRONS.retention,
        scheduledTime: new Date("2026-10-16T03:17:00Z"),
      }),
    );

    const done = { deleted: 0, complete: true };
    expect(info).toHaveBeenCalledWith("retention.sweeps_complete", {
      cron: CRONS.retention,
      auth: { sessions: done, magicLinks: done, webauthnChallenges: done },
      stripeEvents: { deleted: 1, complete: true },
      emailOutbox: done,
    });
  });

  it("fails loudly on a cron it has no handler for", async () => {
    await expect(
      worker.scheduled(createScheduledController({ cron: "0 0 * * *" })),
    ).rejects.toThrow('No handler for cron "0 0 * * *"');
  });
});
