import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "jsonc-parser";
import {
  parseStackOutputs,
  SyncError,
  syncWranglerConfig,
} from "./wrangler-env.ts";

const prod = {
  resourcePrefix: "flareling-prod",
  d1DatabaseId: "11111111-2222-3333-4444-555555555555",
  d1DatabaseName: "flareling-prod",
  jobsQueueName: "flareling-prod-jobs",
  jobsDeadLetterQueueName: "flareling-prod-jobs-dlq",
  authRateLimitNamespaceId: 2001,
  webBaseUrl: "https://flareling.example.com",
  webauthnRpId: "flareling.example.com",
  emailFrom: "noreply@flareling.example.com",
};

const committed = (app: string) =>
  readFileSync(
    new URL(`../../../apps/${app}/wrangler.jsonc`, import.meta.url),
    "utf8",
  );

describe("syncWranglerConfig on the committed configs", () => {
  it("points apps/web at the stack", () => {
    const text = syncWranglerConfig(committed("web"), "web", prod);
    const config = parse(text);
    assert.equal(config.name, "flareling-prod-web");
    assert.deepEqual(config.d1_databases[0], {
      binding: "DB",
      database_name: "flareling-prod",
      database_id: prod.d1DatabaseId,
      migrations_dir: "../../libs/db/migrations",
    });
    assert.deepEqual(config.queues.producers, [
      { binding: "JOBS_QUEUE", queue: "flareling-prod-jobs" },
    ]);
    assert.equal(config.ratelimits[0].namespace_id, "2001");
    assert.equal(config.vars.APP_BASE_URL, "https://flareling.example.com");
    assert.equal(config.vars.WEBAUTHN_RP_ID, "flareling.example.com");
    assert.equal(config.vars.EMAIL_FROM, "noreply@flareling.example.com");
    // Not per stack: left as committed.
    assert.equal(config.vars.APP_NAME, "Flareling");
    // Comments survive.
    assert.match(text, /\/\/ Pinned rather than tracking "today"/);
  });

  it("points apps/jobs at the stack, dead-letter queue included", () => {
    const config = parse(syncWranglerConfig(committed("jobs"), "jobs", prod));
    assert.equal(config.name, "flareling-prod-jobs");
    assert.equal(config.queues.consumers[0].queue, "flareling-prod-jobs");
    assert.equal(
      config.queues.consumers[0].dead_letter_queue,
      "flareling-prod-jobs-dlq",
    );
    assert.equal(config.d1_databases[0].database_id, prod.d1DatabaseId);
  });

  it("unschedules cron triggers on deployed Workers (Workers Free, ADR 0020)", () => {
    assert.ok(parse(committed("jobs")).triggers.crons.length > 0);
    const config = parse(syncWranglerConfig(committed("jobs"), "jobs", prod));
    assert.deepEqual(config.triggers.crons, []);
  });

  it("leaves no dev stack name behind", () => {
    const once = syncWranglerConfig(committed("web"), "web", prod);
    assert.doesNotMatch(once, /flareling-dev/);
  });
});

describe("syncWranglerConfig refuses what it doesn't know", () => {
  const base = `{ "name": "x", "d1_databases": [{ "binding": "DB", "database_name": "d", "database_id": "00000000-0000-0000-0000-000000000000" }] }`;

  it("an unknown top-level key, such as a KV binding", () => {
    const text = base.replace(
      /}$/,
      `, "kv_namespaces": [{ "binding": "KV", "id": "x" }] }`,
    );
    assert.throws(() => syncWranglerConfig(text, "web", prod), {
      name: "SyncError",
      message: /kv_namespaces/,
    });
  });

  it("an unknown D1 binding", () => {
    assert.throws(
      () => syncWranglerConfig(base.replace('"DB"', '"OTHER"'), "web", prod),
      /D1 binding "OTHER"/,
    );
  });

  it("an unknown queue", () => {
    const text = `{ "name": "x", "queues": { "producers": [{ "binding": "Q", "queue": "flareling-dev-other" }] } }`;
    assert.throws(
      () => syncWranglerConfig(text, "web", prod),
      /queue "flareling-dev-other"/,
    );
  });

  it("a placeholder id it couldn't fill", () => {
    const text = `{ "name": "x", "vars": { "ID": "00000000-0000-0000-0000-000000000000" } }`;
    assert.throws(() => syncWranglerConfig(text, "web", prod), /placeholder/);
  });

  it("a config that doesn't parse", () => {
    assert.throws(
      () => syncWranglerConfig(`{ "name": `, "web", prod),
      SyncError,
    );
  });
});

describe("parseStackOutputs", () => {
  it("accepts pulumi's JSON, extra outputs included", () => {
    assert.deepEqual(parseStackOutputs({ ...prod, zoneName: "example.com" }), {
      ...prod,
      zoneName: "example.com",
    });
  });

  it("names every missing or mistyped output", () => {
    assert.throws(
      () =>
        parseStackOutputs({
          ...prod,
          d1DatabaseId: undefined,
          authRateLimitNamespaceId: "2001",
        }),
      /d1DatabaseId \(string\), authRateLimitNamespaceId \(number\)/,
    );
  });
});
