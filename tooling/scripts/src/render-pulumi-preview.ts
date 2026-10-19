#!/usr/bin/env node
/**
 * Turns one stack's `pulumi preview --json` into its PR comment and job
 * summary (see pulumi-preview.ts). Used by cicd.yml's `preview:` jobs:
 *
 *   pulumi preview --stack dev --json > preview.json 2> preview.log
 *   render-pulumi-preview --stack dev --exit-code $? \
 *     --preview preview.json --log preview.log \
 *     --commit <sha> --run-url <url> --comment comment.md >> "$GITHUB_STEP_SUMMARY"
 *
 * Writes the comment to --comment and the job summary to stdout. A non-zero
 * --exit-code, or output that isn't preview JSON, renders as a failure with
 * the tail of the log.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  failureLog,
  type PreviewJson,
  type Rendered,
  renderFailure,
  renderPreview,
} from "./pulumi-preview.ts";

const { values } = parseArgs({
  options: {
    stack: { type: "string" },
    "exit-code": { type: "string", default: "0" },
    preview: { type: "string" },
    log: { type: "string" },
    commit: { type: "string" },
    "run-url": { type: "string" },
    comment: { type: "string" },
  },
});

const { stack, preview, log, commit, comment } = values;
const runUrl = values["run-url"];
if (!stack || !preview || !log || !commit || !runUrl || !comment) {
  console.error(
    "Usage: render-pulumi-preview --stack <name> --exit-code <n> --preview <json> --log <stderr> --commit <sha> --run-url <url> --comment <out.md>",
  );
  process.exit(2);
}

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

const context = { stack, commit, runUrl };
const stdout = read(preview);
let rendered: Rendered | undefined;
if (values["exit-code"] === "0") {
  try {
    rendered = renderPreview(JSON.parse(stdout) as PreviewJson, context);
  } catch {
    // Not JSON: rendered as a failure below.
  }
}
rendered ??= renderFailure(failureLog(read(log), stdout), context);

writeFileSync(comment, rendered.comment);
process.stdout.write(rendered.summary);
