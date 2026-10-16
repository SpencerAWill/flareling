#!/usr/bin/env node
/**
 * Prints a Markdown table of coverage per package, from the json-summary
 * report each package writes to coverage/coverage-summary.json. quality.yml
 * appends it to the run summary. Run from the repo root.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Totals {
  total: Record<
    "statements" | "branches" | "functions" | "lines",
    { pct: number }
  >;
}

const rows: string[] = [];
for (const group of ["apps", "libs"]) {
  if (!existsSync(group)) continue;
  for (const name of readdirSync(group).sort()) {
    const file = join(group, name, "coverage", "coverage-summary.json");
    if (!existsSync(file)) continue;
    const { total } = JSON.parse(readFileSync(file, "utf8")) as Totals;
    rows.push(
      `| ${group}/${name} | ${total.statements.pct}% | ${total.branches.pct}% | ${total.functions.pct}% | ${total.lines.pct}% |`,
    );
  }
}

console.log("| Package | Statements | Branches | Functions | Lines |");
console.log("| --- | --- | --- | --- | --- |");
for (const row of rows) console.log(row);
