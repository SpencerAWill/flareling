import * as pulumi from "@pulumi/pulumi";
import { hostname } from "./config.ts";
import { emailOutboxEnabled } from "./outbox.ts";

/**
 * How this stack's apps/web sends email: the dev outbox (outbox.ts), or
 * Resend (docs/adr/0023-resend-for-production-email.md). Exactly one, so a
 * stack can't deploy with no way to send a sign-in link, and a dev stack
 * never holds a key that could email real people.
 *
 * Resend's key and from-address come from this stack's config, either:
 *
 *   - directly: `resendApiKey` (a secret) and `emailFrom`, or
 *   - from another Pulumi stack that owns the Resend account and domain,
 *     through `emailStack`: `{ "stack": "<org>/<project>/<stack>",
 *     "apiKeyOutput": "...", "fromOutput": "..." }`. That stack must be
 *     applied first: a missing output fails this one's `up`.
 *
 * Template users bring their own Resend account and verified domain; nothing
 * here creates Resend resources.
 */
const config = new pulumi.Config();

interface EmailStack {
  readonly stack: string;
  readonly apiKeyOutput: string;
  readonly fromOutput: string;
}

const emailStack = config.getObject<EmailStack>("emailStack");
for (const field of ["stack", "apiKeyOutput", "fromOutput"] as const) {
  if (emailStack && typeof emailStack[field] !== "string") {
    throw new Error(
      `emailStack needs ${field}: { "stack", "apiKeyOutput", "fromOutput" }.`,
    );
  }
}
const directKey = config.getSecret("resendApiKey");
const directFrom = config.get("emailFrom");

if (emailStack && (directKey || directFrom)) {
  throw new Error(
    "Set emailStack, or resendApiKey and emailFrom, not both: they'd disagree about who sends.",
  );
}
const resendConfigured = Boolean(emailStack || directKey);
if (emailOutboxEnabled && resendConfigured) {
  throw new Error(
    "emailOutbox and Resend are exclusive: a stack whose email goes to the outbox must not hold a sending key.",
  );
}
if (!emailOutboxEnabled && !resendConfigured) {
  throw new Error(
    "No email transport: set resendApiKey and emailFrom, or emailStack (docs/adr/0023-resend-for-production-email.md), or emailOutbox on a dev stack.",
  );
}
if (directKey && !directFrom) {
  throw new Error(
    "resendApiKey needs emailFrom, an address on the domain verified in Resend.",
  );
}

const ref = emailStack ? new pulumi.StackReference(emailStack.stack) : null;

/**
 * One string output of `emailStack`. `requireOutput` only rejects a missing
 * output, so an empty one would otherwise deploy and fail at the first
 * sign-in instead of here.
 */
function sharedString(
  ref: pulumi.StackReference,
  name: string,
  isValid: (value: string) => boolean,
): pulumi.Output<string> {
  return ref.requireOutput(name).apply((value: unknown) => {
    if (typeof value !== "string" || !isValid(value)) {
      throw new Error(
        `${emailStack?.stack} output \`${name}\` is missing or malformed.`,
      );
    }
    return value;
  });
}

/**
 * apps/web refuses a key without this prefix on every request, so a bad one
 * fails the `up` here rather than taking the deployed site down.
 */
const isResendKey = (key: string) => /^re_\S+$/.test(key);

/**
 * The Resend key, empty without one. Wrapped in `pulumi.secret` here rather
 * than trusted to arrive as one, so it never sits unencrypted in this
 * stack's state. The deploy action uploads it as RESEND_API_KEY.
 */
export const resendApiKey = pulumi.secret(
  ref && emailStack
    ? sharedString(ref, emailStack.apiKeyOutput, isResendKey)
    : (directKey?.apply((key) => {
        if (!isResendKey(key)) {
          throw new Error("resendApiKey must be a Resend key (re_...).");
        }
        return key;
      }) ?? pulumi.output("")),
);

/** The address emails come from: on Resend's verified domain when sending. */
export const emailFrom: pulumi.Output<string> =
  ref && emailStack
    ? sharedString(ref, emailStack.fromOutput, (from) => from.includes("@"))
    : pulumi.output(directFrom ?? `noreply@${hostname}`);
