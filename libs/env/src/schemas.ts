import { z } from "zod";

/**
 * Schemas for variables more than one app reads, so they are validated the
 * same way everywhere. App-specific variables live in the app's own schema.
 */

/** Threshold for @flareling/log. Optional: unset means `info`. */
export const logLevel = z.enum(["debug", "info", "warn", "error"]).optional();
