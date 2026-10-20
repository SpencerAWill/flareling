import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMENT_LIMIT,
  commentMarker,
  diff,
  failureLog,
  formatValue,
  type PreviewStep,
  parseUrn,
  renderFailure,
  renderPreview,
} from "./pulumi-preview.ts";

const context = {
  stack: "prod",
  commit: "abc1234def5678",
  runUrl: "https://github.com/o/r/actions/runs/1",
};

const urn = (type: string, name: string) =>
  `urn:pulumi:prod::flareling-cloudflare::${type}::${name}`;

// Shaped like a real `pulumi preview --json` of infra/cloudflare.
const steps: PreviewStep[] = [
  {
    op: "same",
    urn: urn("pulumi:pulumi:Stack", "flareling-cloudflare-prod"),
  },
  {
    op: "update",
    urn: urn("cloudflare:index/turnstileWidget:TurnstileWidget", "sign-in"),
    oldState: { inputs: { domains: ["old.example.com"], mode: "managed" } },
    newState: { inputs: { domains: ["new.example.com"], mode: "managed" } },
  },
  {
    op: "replace",
    urn: urn("cloudflare:index/workersCustomDomain:WorkersCustomDomain", "web"),
    oldState: { inputs: { hostname: "old.example.com" } },
    newState: { inputs: { hostname: "new.example.com" } },
    replaceReasons: ["hostname"],
  },
  {
    op: "delete-replaced",
    urn: urn("cloudflare:index/workersCustomDomain:WorkersCustomDomain", "web"),
  },
];

const preview = {
  changeSummary: { update: 1, replace: 1, same: 6 },
  steps,
};

describe("renderPreview", () => {
  it("starts the comment with the stack's sticky marker", () => {
    const { comment, summary } = renderPreview(preview, context);
    assert.ok(comment.startsWith(`${commentMarker("prod")}\n`));
    assert.ok(!summary.includes(commentMarker("prod")));
  });

  it("shows the counts, short commit and run link", () => {
    const { comment } = renderPreview(preview, context);
    assert.match(
      comment,
      /\*\*~1 to update · \+-1 to replace · 6 unchanged\*\*/,
    );
    assert.match(
      comment,
      /`abc1234` · \[Workflow run\]\(https:\/\/github\.com/,
    );
  });

  it("shows each changed property's old and new value", () => {
    const { comment } = renderPreview(preview, context);
    assert.ok(comment.includes("~ cloudflare:TurnstileWidget  sign-in\n"));
    assert.ok(comment.includes('-     domains[0]: "old.example.com"\n'));
    assert.ok(comment.includes('+     domains[0]: "new.example.com"\n'));
    assert.ok(!comment.includes("mode"));
    assert.ok(
      comment.includes(
        "+- cloudflare:WorkersCustomDomain  web  [replaced: hostname]\n",
      ),
    );
  });

  it("lists a replaced resource once", () => {
    const { comment } = renderPreview(preview, context);
    assert.equal(comment.split("WorkersCustomDomain  web").length - 1, 1);
  });

  it("says so when nothing changes", () => {
    const { comment } = renderPreview(
      { changeSummary: { same: 9 }, steps: [steps[0] as PreviewStep] },
      context,
    );
    assert.match(comment, /\*\*9 unchanged\*\*\n\n.*\n\nNo changes\.\n$/);
    assert.ok(!comment.includes("<details"));
  });

  it("falls back to property names when the values don't fit", () => {
    const big = manyChanges(400, 200);
    const { comment, summary } = renderPreview(big, context);
    assert.ok(comment.length <= COMMENT_LIMIT);
    assert.ok(comment.includes("<summary>Changed resources</summary>"));
    assert.ok(comment.includes("~ cloudflare:Thing  thing-0  (a, b)\n"));
    assert.ok(comment.includes(`[run summary](${context.runUrl})`));
    // The job summary has room for every value.
    assert.ok(summary.includes('+     a: "new-0"'));
  });

  it("names a quoted top-level key in the brief list", () => {
    const { comment } = renderPreview(
      {
        changeSummary: { update: 400 },
        steps: Array.from({ length: 400 }, (_, i) => ({
          op: "update",
          urn: urn("cloudflare:index/thing:Thing", `thing-${i}`),
          oldState: { inputs: { "kebab-key": { a: "y".repeat(200) } } },
          newState: { inputs: { "kebab-key": { a: "z".repeat(200) } } },
        })),
      },
      context,
    );
    assert.ok(
      comment.includes('~ cloudflare:Thing  thing-0  (["kebab-key"])\n'),
    );
  });

  it("falls back to the counts when even the names don't fit", () => {
    const { comment } = renderPreview(manyChanges(3000, 1), context);
    assert.ok(comment.length <= COMMENT_LIMIT);
    assert.ok(!comment.includes("<details"));
    assert.match(
      comment,
      /too long for a comment; it's in the \[run summary\]/,
    );
    assert.match(comment, /\*\*~3000 to update\*\*/);
  });

  it("keeps a backtick in a value from closing the code block", () => {
    const { comment } = renderPreview(
      {
        changeSummary: { create: 1 },
        steps: [
          {
            op: "create",
            urn: urn("cloudflare:index/thing:Thing", "t"),
            newState: { inputs: { script: "```\nend" } },
          },
        ],
      },
      context,
    );
    assert.ok(comment.includes("````diff\n"));
  });
});

describe("diff", () => {
  it("is empty for the same values in another key order", () => {
    assert.deepEqual(
      diff({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }, ""),
      [],
    );
  });

  it("descends into arrays and objects to the leaves", () => {
    assert.deepEqual(
      diff(
        { policies: [{ includes: [{ email: "a@x" }] }] },
        { policies: [{ includes: [{ email: "a@x" }, { email: "b@x" }] }] },
        "",
      ),
      [{ sign: "+", path: "policies[0].includes[1].email", value: "b@x" }],
    );
  });

  it("shows an added empty list as itself", () => {
    assert.deepEqual(diff({}, { tags: [] }, ""), [
      { sign: "+", path: "tags", value: [] },
    ]);
  });

  it("quotes keys that aren't identifiers, and skips __defaults", () => {
    assert.deepEqual(
      diff({ __defaults: ["a"] }, { "kebab-key": 1, __defaults: ["b"] }, ""),
      [{ sign: "+", path: '["kebab-key"]', value: 1 }],
    );
  });

  it("shows a type change as removal and addition", () => {
    assert.deepEqual(diff({ v: [1] }, { v: "1" }, ""), [
      { sign: "-", path: "v", value: [1] },
      { sign: "+", path: "v", value: "1" },
    ]);
  });
});

describe("parseUrn", () => {
  it("shortens the type and takes the name", () => {
    assert.deepEqual(
      parseUrn(urn("cloudflare:index/d1Database:D1Database", "db")),
      { type: "cloudflare:D1Database", name: "db" },
    );
  });

  it("drops parent types", () => {
    assert.deepEqual(
      parseUrn(urn("my:component:App$cloudflare:index/queue:Queue", "jobs")),
      { type: "cloudflare:Queue", name: "jobs" },
    );
  });
});

describe("formatValue", () => {
  it("shows unknowns, secrets and long strings readably", () => {
    assert.equal(
      formatValue("04da6b54-80e4-46f7-96ec-b56ff0331ba9"),
      "(known after apply)",
    );
    assert.equal(formatValue("[secret]"), '"[secret]"');
    assert.match(
      formatValue("x".repeat(500)),
      /^"x{199}… \(302 more characters\)$/,
    );
  });
});

describe("renderFailure", () => {
  it("shows the end of the log", () => {
    const { comment } = renderFailure("error: boom", context);
    assert.ok(comment.startsWith(commentMarker("prod")));
    assert.match(comment, /\*\*The preview failed\.\*\*/);
    assert.ok(comment.includes("```text\nerror: boom\n```"));
  });
});

describe("failureLog", () => {
  it("adds the JSON's diagnostics to stderr", () => {
    const stdout = JSON.stringify({
      diagnostics: [{ message: "bad input\n" }],
    });
    assert.equal(failureLog("error: x\n", stdout), "error: x\nbad input");
  });

  it("keeps stdout that isn't JSON", () => {
    assert.equal(failureLog("", "plain text\n"), "plain text");
  });

  it("keeps stdout that is JSON but not a preview's shape", () => {
    const stdout = JSON.stringify({ diagnostics: "not a list" });
    assert.equal(failureLog("", stdout), stdout);
  });
});

function manyChanges(count: number, valueLength: number) {
  return {
    changeSummary: { update: count },
    steps: Array.from({ length: count }, (_, i) => ({
      op: "update",
      urn: urn("cloudflare:index/thing:Thing", `thing-${i}`),
      oldState: { inputs: { a: `old-${i}`, b: "y".repeat(valueLength) } },
      newState: { inputs: { a: `new-${i}`, b: "z".repeat(valueLength) } },
    })),
  };
}
