#!/usr/bin/env node
/**
 * Points every app's wrangler.jsonc at one Pulumi stack, before a deploy
 * builds it. Replaces the `sed` over placeholder ids that ucmc.spencerwill.com
 * used: this knows which value goes where, and fails on anything it doesn't
 * (see wrangler-env.ts).
 *
 *   pulumi stack output --json --stack dev > outputs.json
 *   pnpm sync-env --outputs outputs.json            # rewrite in place
 *   pnpm sync-env --outputs outputs.json --dry-run  # print, write nothing
 *
 * Run it in CI's throwaway checkout, before `pnpm build`: apps/web deploys
 * the config the Vite build writes to dist/, which is made from these files.
 * Never commit the result; the committed configs stay on the dev stack's
 * names, with placeholder ids.
 *
 * Vars and secrets are not this script's job: they're per environment
 * settings, passed to `wrangler deploy` and `wrangler secret put`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  parseStackOutputs,
  SyncError,
  syncWranglerConfig,
} from "./wrangler-env.ts";

const { values } = parseArgs({
  options: {
    outputs: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    root: { type: "string", default: "." },
  },
});

if (!values.outputs) {
  console.error(
    "Usage: sync-env --outputs <pulumi stack output --json file> [--dry-run]",
  );
  process.exit(2);
}

try {
  const outputs = parseStackOutputs(
    JSON.parse(readFileSync(values.outputs, "utf8")),
  );
  const appsDir = resolve(values.root, "apps");
  const apps = readdirSync(appsDir).filter((app) =>
    existsSync(join(appsDir, app, "wrangler.jsonc")),
  );
  if (apps.length === 0)
    throw new SyncError(`No apps/*/wrangler.jsonc under ${appsDir}.`);

  for (const app of apps) {
    const path = join(appsDir, app, "wrangler.jsonc");
    const synced = syncWranglerConfig(readFileSync(path, "utf8"), app, outputs);
    if (values["dry-run"]) {
      console.log(`--- ${path}\n${synced}`);
    } else {
      writeFileSync(path, synced);
      console.log(`sync-env: ${app} → ${outputs.resourcePrefix}-${app}`);
    }
  }
} catch (err) {
  console.error(err instanceof SyncError ? `sync-env: ${err.message}` : err);
  process.exit(1);
}
