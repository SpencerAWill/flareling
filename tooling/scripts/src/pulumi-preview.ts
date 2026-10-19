/**
 * Renders `pulumi preview --json` as Markdown for a PR comment and the run's
 * job summary (render-pulumi-preview.ts, used by cicd.yml's `preview:` jobs).
 *
 * Changes are diffed from each step's old and new *inputs*, the values the
 * program declares, so computed outputs (`modifiedOn`, ids) don't show up as
 * noise. `pulumi preview --json` masks secrets as "[secret]" unless asked
 * not to, so a secret's change never shows, only that the resource changes.
 *
 * Comments are capped at 65,536 characters, so the comment falls back in
 * tiers until it fits: every property's old and new value, then the changed
 * resources with the names of their changed properties, then the counts
 * alone. The job summary (1 MiB) gets the fullest tier that fits there, and
 * every tier but the first links to it.
 */

/** GitHub rejects a comment body over 65,536 characters; leave headroom. */
export const COMMENT_LIMIT = 60_000;
/** GitHub's job summary limit is 1 MiB per step, in bytes. */
export const SUMMARY_LIMIT = 1_000_000;

/** Pulumi's placeholder for a value only known once applied. */
const UNKNOWN = "04da6b54-80e4-46f7-96ec-b56ff0331ba9";
/** Longest value shown in full; longer ones (Worker scripts) are cut. */
const VALUE_LIMIT = 200;
/** Tail of a failed preview's output shown in its comment. */
const LOG_LIMIT = 20_000;

interface ResourceState {
  readonly inputs?: Record<string, unknown>;
}

export interface PreviewStep {
  readonly op: string;
  readonly urn: string;
  readonly oldState?: ResourceState | null;
  readonly newState?: ResourceState | null;
  readonly replaceReasons?: readonly string[] | null;
}

export interface PreviewJson {
  readonly changeSummary?: Readonly<Record<string, number>> | null;
  readonly steps?: readonly PreviewStep[] | null;
  readonly diagnostics?: readonly { readonly message?: string }[] | null;
}

export interface RenderContext {
  /** The stack, also the comment's sticky marker. */
  readonly stack: string;
  /** The PR head commit the preview ran for. */
  readonly commit: string;
  /** The workflow run, whose job summary holds the full preview. */
  readonly runUrl: string;
}

export interface Rendered {
  readonly comment: string;
  readonly summary: string;
}

/** Where a sticky comment is found again on the next push. */
export function commentMarker(stack: string): string {
  return `<!-- flareling:pulumi-preview:${stack} -->`;
}

/** Symbol, label and display order of each change kind Pulumi counts. */
const kinds = [
  ["create", "+", "to create"],
  ["update", "~", "to update"],
  ["replace", "+-", "to replace"],
  ["delete", "-", "to delete"],
  ["import", "=", "to import"],
] as const;

/** Steps that change nothing, or repeat a `replace` step's resource. */
const skippedOps = new Set([
  "same",
  "read",
  "refresh",
  "delete-replaced",
  "discard-replaced",
]);

const symbols: Readonly<Record<string, string>> = {
  create: "+",
  update: "~",
  replace: "+-",
  "create-replacement": "+-",
  delete: "-",
  discard: "-",
  import: "=",
  "import-replacement": "=",
};

interface Change {
  readonly sign: "-" | "+";
  readonly path: string;
  readonly value: unknown;
}

interface Resource {
  readonly symbol: string;
  readonly type: string;
  readonly name: string;
  readonly replaceReasons: readonly string[];
  readonly changes: readonly Change[];
}

export function renderPreview(
  preview: PreviewJson,
  context: RenderContext,
): Rendered {
  const resources = changedResources(preview.steps ?? []);
  const head = header(context, countsLine(preview.changeSummary ?? {}));
  if (resources.length === 0) {
    const body = `${head}\n\nNo changes.\n`;
    return {
      comment: `${commentMarker(context.stack)}\n${body}`,
      summary: body,
    };
  }

  const full = changesBlock(resources.flatMap(fullLines), "Changes");
  const brief = changesBlock(resources.map(briefLine), "Changed resources");
  const summaryLink = `[run summary](${context.runUrl})`;
  const marker = `${commentMarker(context.stack)}\n`;

  const comment = firstThatFits(`${marker}${head}\n`, COMMENT_LIMIT, [
    full,
    `${brief}\nProperty values are too long for a comment; they're in the ${summaryLink}.\n`,
    `\nThe list of changed resources is too long for a comment; it's in the ${summaryLink}.\n`,
  ]);
  const summary = firstThatFits(`${head}\n`, SUMMARY_LIMIT, [
    full,
    `${brief}\nProperty values are too long for the job summary.\n`,
    "\nThe list of changed resources is too long for the job summary.\n",
  ]);
  return { comment, summary };
}

/**
 * `prefix` and the first tier that fits within `limit` UTF-8 bytes, else the
 * last. Bytes, since the job summary's limit is in bytes; for the comment's
 * character limit, bytes are never fewer than characters.
 */
function firstThatFits(
  prefix: string,
  limit: number,
  tiers: readonly string[],
): string {
  const tier =
    tiers.find(
      (candidate) => Buffer.byteLength(`${prefix}${candidate}`) <= limit,
    ) ??
    tiers.at(-1) ??
    "";
  return `${prefix}${tier}`;
}

/** For a preview that exited non-zero or wrote no JSON. */
export function renderFailure(log: string, context: RenderContext): Rendered {
  const tail =
    log.length > LOG_LIMIT
      ? `…\n${log.slice(-LOG_LIMIT)}`
      : log || "(no output)";
  const body = `${header(context, "**The preview failed.**")}\n\n<details open>\n<summary>Output</summary>\n\n${fenced("text", tail.trimEnd())}\n\n</details>\n`;
  return { comment: `${commentMarker(context.stack)}\n${body}`, summary: body };
}

/** The failure log: Pulumi's stderr, then any diagnostics in its JSON. */
export function failureLog(stderr: string, stdout: string): string {
  let diagnostics: string[] = [];
  try {
    const parsed = JSON.parse(stdout) as PreviewJson;
    diagnostics = (parsed.diagnostics ?? []).flatMap((d) =>
      d.message ? [d.message.trimEnd()] : [],
    );
  } catch {
    if (stdout.trim()) diagnostics = [stdout.trimEnd()];
  }
  return [stderr.trimEnd(), ...diagnostics].filter(Boolean).join("\n");
}

function header(context: RenderContext, status: string): string {
  return `### Pulumi preview: \`${context.stack}\`\n\n${status}\n\n\`${context.commit.slice(0, 7)}\` · [Workflow run](${context.runUrl})`;
}

function countsLine(changeSummary: Readonly<Record<string, number>>): string {
  const parts = kinds.flatMap(([kind, symbol, label]) => {
    const count = changeSummary[kind] ?? 0;
    return count > 0 ? [`${symbol}${count} ${label}`] : [];
  });
  const same = changeSummary.same ?? 0;
  if (same > 0) parts.push(`${same} unchanged`);
  return parts.length > 0 ? `**${parts.join(" · ")}**` : "**No resources.**";
}

function changedResources(steps: readonly PreviewStep[]): Resource[] {
  const seen = new Set<string>();
  return steps.flatMap((step) => {
    if (skippedOps.has(step.op) || seen.has(step.urn)) return [];
    seen.add(step.urn);
    const { type, name } = parseUrn(step.urn);
    return [
      {
        symbol: symbols[step.op] ?? "~",
        type,
        name,
        replaceReasons: step.replaceReasons ?? [],
        changes: diff(step.oldState?.inputs, step.newState?.inputs, ""),
      },
    ];
  });
}

/**
 * `urn:pulumi:<stack>::<project>::<parent types$>type::<name>`, shown as
 * `cloudflare:WorkersCustomDomain` and its name.
 */
export function parseUrn(urn: string): { type: string; name: string } {
  const parts = urn.split("::");
  const name = parts.at(-1) ?? urn;
  const fullType = (parts.at(-2) ?? "").split("$").at(-1) ?? "";
  const [pkg = "", , kind] = fullType.split(":");
  return { type: kind ? `${pkg}:${kind}` : fullType, name };
}

/** Leaf-level differences between two input trees, in key order. */
export function diff(before: unknown, after: unknown, path: string): Change[] {
  if (deepEqual(before, after)) return [];
  if (isContainer(before) || isContainer(after)) {
    const bothArrays =
      (before === undefined || Array.isArray(before)) &&
      (after === undefined || Array.isArray(after));
    const bothObjects =
      (before === undefined || isObject(before)) &&
      (after === undefined || isObject(after));
    if (bothArrays) {
      const a = (before ?? []) as unknown[];
      const b = (after ?? []) as unknown[];
      const changes = Array.from(
        { length: Math.max(a.length, b.length) },
        (_, i) => diff(a[i], b[i], `${path}[${i}]`),
      ).flat();
      return changes.length > 0 ? changes : emptyContainer(before, after, path);
    }
    if (bothObjects) {
      const a = (before ?? {}) as Record<string, unknown>;
      const b = (after ?? {}) as Record<string, unknown>;
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter((key) => key !== "__defaults")
        .sort();
      const changes = keys.flatMap((key) =>
        diff(a[key], b[key], join(path, key)),
      );
      return changes.length > 0 ? changes : emptyContainer(before, after, path);
    }
  }
  return leaf(before, after, path);
}

/**
 * No leaf differs: the same values in another key order, or an empty array
 * or object added or removed, which is shown as itself.
 */
function emptyContainer(
  before: unknown,
  after: unknown,
  path: string,
): Change[] {
  return before === undefined || after === undefined
    ? leaf(before, after, path)
    : [];
}

function leaf(before: unknown, after: unknown, path: string): Change[] {
  const changes: Change[] = [];
  if (before !== undefined) changes.push({ sign: "-", path, value: before });
  if (after !== undefined) changes.push({ sign: "+", path, value: after });
  return changes;
}

function join(path: string, key: string): string {
  const segment = /^[A-Za-z_$][\w$]*$/.test(key)
    ? key
    : `[${JSON.stringify(key)}]`;
  return path === "" || segment.startsWith("[")
    ? `${path}${segment}`
    : `${path}.${segment}`;
}

function fullLines(resource: Resource): string[] {
  return [
    resourceLine(resource),
    ...resource.changes.map(
      (change) =>
        `${change.sign}     ${change.path}: ${formatValue(change.value)}`,
    ),
  ];
}

function briefLine(resource: Resource): string {
  const properties = [
    ...new Set(resource.changes.map((change) => topLevelKey(change.path))),
  ];
  const list = properties.length > 0 ? `  (${properties.join(", ")})` : "";
  return `${resourceLine(resource)}${list}`;
}

/** The first segment of a `join`ed path: `a` of `a.b[0]`, `["k-k"]` of `["k-k"].c`. */
function topLevelKey(path: string): string {
  return path.match(/^(?:\[(?:"(?:[^"\\]|\\.)*"|\d+)\]|[^.[]+)/)?.[0] ?? path;
}

function resourceLine(resource: Resource): string {
  const reasons =
    resource.replaceReasons.length > 0
      ? `  [replaced: ${resource.replaceReasons.join(", ")}]`
      : "";
  return `${resource.symbol} ${resource.type}  ${resource.name}${reasons}`;
}

export function formatValue(value: unknown): string {
  if (value === UNKNOWN) return "(known after apply)";
  const text = JSON.stringify(value) ?? String(value);
  return text.length > VALUE_LIMIT
    ? `${text.slice(0, VALUE_LIMIT)}… (${text.length - VALUE_LIMIT} more characters)`
    : text;
}

function changesBlock(lines: readonly string[], title: string): string {
  return `\n<details open>\n<summary>${title}</summary>\n\n${fenced("diff", lines.join("\n"))}\n\n</details>\n`;
}

/** A code fence longer than any run of backticks in `text`. */
function fenced(language: string, text: string): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContainer(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
