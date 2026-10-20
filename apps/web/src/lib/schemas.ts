/**
 * The input of each form, as zod schemas the browser and the server share:
 * the form validates with one as you type (src/components/form.tsx), and the
 * server function the form calls validates with the same one, so the two
 * can't disagree about what's allowed. Messages are written for people.
 *
 * Browser-safe: only zod and @flareling/core/client. libs/core still has the
 * final say on meaning (a normalized workspace name, seats, roles); these
 * are the shapes.
 */
import { WORKSPACE_NAME_MAX } from "@flareling/core/client";
import { z } from "zod";

/** An address, trimmed, as libs/auth's normalizeEmail would see it. */
const email = z
  .string()
  .trim()
  .min(1, "Enter an email address.")
  .max(254, "That address is too long.")
  .pipe(z.email("Enter a valid email address."));

/** Sign-in by emailed link. */
export const signInSchema = z.object({ email });

/** A new team workspace. libs/core normalizes the name further. */
export const newWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the workspace a name.")
    .max(
      WORKSPACE_NAME_MAX,
      `Keep the name to ${WORKSPACE_NAME_MAX} characters.`,
    ),
});

/** Inviting someone to a workspace. */
export const inviteSchema = z.object({
  email,
  role: z.enum(["admin", "member"]),
});
