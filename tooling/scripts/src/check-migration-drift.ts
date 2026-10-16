#!/usr/bin/env node
/**
 * Fails when the Drizzle schema has changes that no migration covers.
 *
 * Run from a package with a drizzle.config.ts (libs/db's `db:drift` script).
 * It runs `drizzle-kit generate` and compares the migrations directory before
 * and after: if generate wrote anything, someone changed the schema without
 * generating its migration, and deploys would ship code expecting columns the
 * database doesn't have. The new migration is left in place to review and
 * commit.
 *
 * This is what catches snapshot drift at the moment it starts. In
 * ucmc.spencerwill.com the snapshots fell behind the migrations unnoticed,
 * until `drizzle-kit generate` stopped working and every migration had to be
 * written by hand.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MIGRATIONS_DIR = "migrations";

function fingerprint(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { recursive: true })) {
    const path = join(dir, entry.toString());
    if (statSync(path).isFile()) {
      const hash = createHash("sha256")
        .update(readFileSync(path))
        .digest("hex");
      files.set(relative(dir, path), hash);
    }
  }
  return files;
}

const before = fingerprint(MIGRATIONS_DIR);
const result = spawnSync("drizzle-kit", ["generate"], { encoding: "utf8" });
if (result.status !== 0) {
  console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  console.error(`drizzle-kit generate exited with ${result.status}`);
  process.exit(1);
}
const after = fingerprint(MIGRATIONS_DIR);

const changed = [...after]
  .filter(([file, hash]) => before.get(file) !== hash)
  .map(([file]) => file);
if (changed.length > 0) {
  console.error(
    "The schema has changes that no migration covers. drizzle-kit generate just wrote:",
  );
  for (const file of changed) console.error(`  ${MIGRATIONS_DIR}/${file}`);
  console.error(
    "Review that migration (it must be backward compatible) and commit it.",
  );
  process.exit(1);
}
console.log("Schema and migrations agree.");
