#!/usr/bin/env node
/**
 * Fails when a Worker's compressed upload exceeds its size budget.
 *
 * Run from an app directory after `vite build`, as that app's `size` script.
 * It asks Wrangler for a dry-run deploy and reads the gzip total Wrangler
 * reports, which is the figure Cloudflare enforces its limit against. The
 * Workers Free plan caps a Worker at 3 MB compressed (Paid: 10 MB), and the
 * default budget sits below the Free cap so the template deploys on any
 * account. An app can pass `--budget-kib <n>` to set a tighter budget.
 *
 * If Wrangler changes its output and the total cannot be found, this fails
 * rather than passing, so the check can never silently stop checking.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_BUDGET_KIB = 2560;

const { values } = parseArgs({
  options: { "budget-kib": { type: "string" } },
});
const budgetKib = Number(values["budget-kib"] ?? DEFAULT_BUDGET_KIB);
if (!Number.isFinite(budgetKib) || budgetKib <= 0) {
  console.error(`Invalid --budget-kib: ${values["budget-kib"]}`);
  process.exit(2);
}

const outdir = mkdtempSync(join(tmpdir(), "worker-size-"));
const result = spawnSync(
  "wrangler",
  ["deploy", "--dry-run", "--outdir", outdir],
  {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
rmSync(outdir, { recursive: true, force: true });

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
if (result.status !== 0) {
  console.error(output);
  console.error(`wrangler deploy --dry-run exited with ${result.status}`);
  process.exit(1);
}

const match = output.match(
  /Total Upload: ([\d.]+) (KiB|MiB) \/ gzip: ([\d.]+) (KiB|MiB)/,
);
if (!match) {
  console.error(output);
  console.error("Could not find Wrangler's 'Total Upload' line in its output.");
  process.exit(1);
}

const toKib = (value: string | undefined, unit: string | undefined) =>
  Number(value) * (unit === "MiB" ? 1024 : 1);
const rawKib = toKib(match[1], match[2]);
const gzipKib = toKib(match[3], match[4]);
const percent = ((gzipKib / budgetKib) * 100).toFixed(1);
const app = basename(process.cwd());
const summary = `${app}: ${gzipKib.toFixed(2)} KiB gzip (${rawKib.toFixed(2)} KiB raw), ${percent}% of the ${budgetKib} KiB budget`;

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${summary}\n`);
}
if (gzipKib > budgetKib) {
  console.error(`${app} is over its Worker size budget.`);
  process.exit(1);
}
