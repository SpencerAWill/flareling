/**
 * The Drizzle schema for the suite's D1 database. `pnpm --filter @flareling/db
 * db:generate` turns changes here into a migration in ../migrations, and CI's
 * drift check fails if this file and the migrations disagree.
 *
 * Migrations must stay backward compatible (expand, deploy, contract), because
 * they are applied before the code that uses them is deployed.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "./id.ts";

/**
 * Security-relevant actions, kept for investigation (who changed what, when).
 *
 * Non-PII only, like log lines: ids, never names, emails or free text a user
 * typed. That keeps the table out of data-export and erasure requests, and
 * means it can be retained after the people in it are gone.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    // Who did it: a users.id, or null for a system action such as a cron job.
    // Deliberately not a foreign key. The record must outlive the account,
    // and ON DELETE SET NULL would erase who did it, the one thing an audit
    // trail is for.
    actorId: text("actor_id"),
    // `namespace.verb_in_snake_case`, like log event names (`role.assigned`).
    action: text("action").notNull(),
    // What it was done to. Loose text, because the kinds of target grow with
    // the features; the action says how to read them.
    targetType: text("target_type"),
    targetId: text("target_id"),
    // Non-PII context as JSON. See the table comment.
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    // Newest first, the default view.
    index("audit_log_created_at_idx").on(t.createdAt),
    // "What did this person do?" and "what happened to this thing?"
    index("audit_log_actor_idx").on(t.actorId),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_action_idx").on(t.action),
  ],
);

// ── Authentication ──────────────────────────────────────────────────────────
//
// Passwordless: magic links and passkeys. Tokens are random (never a newId,
// which reveals its creation time) and stored only as SHA-256 hashes, so a
// copy of the database can't be used to sign in. See libs/auth.
//
// `users` is the parent of every foreign key here. D1 ignores
// `PRAGMA foreign_keys` inside migrations, so a migration that rebuilds a
// parent table (drizzle-kit does this for some column changes) silently runs
// every ON DELETE action on its children. Add columns to `users` with plain
// ALTER TABLE ADD only, and review every generated migration that touches it.

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(newId),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  // Set to stop the account signing in. Its sessions are deleted the next
  // time they are used. Product data (names, profiles) lives in app tables.
  disabledAt: integer("disabled_at", { mode: "timestamp_ms" }),
});

/**
 * The verified addresses an account signs in with. An address belongs to one
 * account (the UNIQUE index is the race boundary when two sign-ups collide),
 * and each account has exactly one primary.
 */
export const userEmails = sqliteTable(
  "user_emails",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Normalized (trimmed, lowercased) by libs/auth before it's stored.
    email: text("email").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    verifiedAt: integer("verified_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("user_emails_email_unique").on(t.email),
    // SQLite checks a partial unique index per statement, so swapping the
    // primary is demote-then-promote within one batch.
    uniqueIndex("user_emails_one_primary")
      .on(t.userId)
      .where(sql`${t.isPrimary} = 1`),
    index("user_emails_user_idx").on(t.userId),
  ],
);

/**
 * Signed-in browsers. The cookie holds a random token; only its hash is
 * stored. `id` is a non-secret handle for listing and revoking sessions.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

/** Single-use sign-in and email-verification links. */
export const magicLinks = sqliteTable(
  "magic_links",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    tokenHash: text("token_hash").notNull(),
    // Normalized; the address the link was sent to.
    email: text("email").notNull(),
    intent: text("intent", { enum: ["sign_in", "add_email"] }).notNull(),
    // For add_email: the signed-in account the address is being added to, so
    // consuming it from another account's session is refused.
    targetUserId: text("target_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("magic_links_token_hash_unique").on(t.tokenHash),
    index("magic_links_expires_at_idx").on(t.expiresAt),
  ],
);

/** WebAuthn credentials (passkeys). */
export const passkeyCredentials = sqliteTable(
  "passkey_credentials",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The authenticator's credential id, base64url.
    credentialId: text("credential_id").notNull(),
    // COSE public key, base64url.
    publicKey: text("public_key").notNull(),
    // Signature counter. Most passkeys always report 0; a non-zero value that
    // doesn't increase means a cloned authenticator and is rejected.
    counter: integer("counter").notNull().default(0),
    // JSON array of transports (`internal`, `hybrid`, ...).
    transports: text("transports"),
    // `singleDevice` or `multiDevice` (synced), and whether it is backed up.
    deviceType: text("device_type", {
      enum: ["singleDevice", "multiDevice"],
    }),
    backedUp: integer("backed_up", { mode: "boolean" }),
    // The user's label for it; how they decide which one to revoke.
    nickname: text("nickname"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("passkey_credentials_credential_id_unique").on(t.credentialId),
    index("passkey_credentials_user_idx").on(t.userId),
  ],
);

/**
 * In-flight WebAuthn ceremonies. `id` is the ceremony cookie's value, a random
 * token. A ceremony is finished by deleting its row (DELETE ... RETURNING), so
 * a challenge can only ever be used once, even by concurrent requests.
 */
export const webauthnChallenges = sqliteTable(
  "webauthn_challenges",
  {
    id: text("id").primaryKey(),
    challenge: text("challenge").notNull(),
    type: text("type", { enum: ["register", "authenticate"] }).notNull(),
    // Registration only: the account the passkey is being added to.
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("webauthn_challenges_expires_at_idx").on(t.expiresAt)],
);

// ── Roles and permissions ───────────────────────────────────────────────────
//
// Permissions are rows named `group:action` (`roles:manage`), added by
// migrations, because code checks for them by name. Roles and their grants are
// data, editable at runtime. `system_admin` implicitly holds every permission.
// Code refers to roles by `name`, never by id.

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    // A stable slug (`system_admin`), compared by code. Never shown.
    name: text("name").notNull(),
    // What people see.
    displayName: text("display_name").notNull(),
    description: text("description"),
    // Display order: system roles first.
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("roles_name_unique").on(t.name)],
);

export const permissions = sqliteTable(
  "permissions",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [uniqueIndex("permissions_name_unique").on(t.name)],
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index("role_permissions_permission_idx").on(t.permissionId),
  ],
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("user_roles_role_idx").on(t.roleId),
  ],
);

// ── Workspaces ──────────────────────────────────────────────────────────────
//
// The tenant: what's billed, and what product data belongs to. Tenancy is a
// `workspace_id` column on every product table in the shared database
// (docs/adr/0017-workspaces-as-tenants.md). Workspace roles say what a member
// may do inside one workspace; the global roles above are for running the
// platform itself.

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    name: text("name").notNull(),
    // Set for the workspace created automatically for a new account. Unique,
    // so two concurrent first requests can't create two.
    personalUserId: text("personal_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("workspaces_personal_user_unique").on(t.personalUserId)],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // owner: everything, including billing and deleting the workspace.
    // admin: manage members and billing. member: use the product.
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

/**
 * Emailed invitations to join a workspace. The link's token is random and
 * stored only as a hash, like a magic link's, but it never signs anyone in:
 * accepting needs a signed-in account that has the invited address. An
 * invite is open until it's accepted, declined or revoked; the daily sweep
 * deletes it once it expires either way (the audit log keeps what happened).
 */
export const workspaceInvites = sqliteTable(
  "workspace_invites",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Normalized; the address the invite was sent to.
    email: text("email").notNull(),
    // Never owner: ownership is granted to a member, not by email.
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    tokenHash: text("token_hash").notNull(),
    // Who sent it. Not a foreign key, so the invite outlives the inviter's
    // account, and so this isn't another child of `users` (see above).
    invitedBy: text("invited_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    declinedAt: integer("declined_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("workspace_invites_token_hash_unique").on(t.tokenHash),
    // One open invite per address per workspace; inviting again resends it.
    // Also how a workspace's open invites are listed and counted.
    uniqueIndex("workspace_invites_open_unique")
      .on(t.workspaceId, t.email)
      .where(
        sql`${t.acceptedAt} IS NULL AND ${t.declinedAt} IS NULL AND ${t.revokedAt} IS NULL`,
      ),
    index("workspace_invites_expires_at_idx").on(t.expiresAt),
  ],
);

// ── Billing ─────────────────────────────────────────────────────────────────
//
// Stripe is the source of truth; these tables are its latest state, as
// written by the billing consumer in apps/jobs (libs/billing). Plans and what
// they grant are defined in code (libs/billing/src/plans.ts), keyed by name.

/** The Stripe customer for each workspace that has started checkout. */
export const billingCustomers = sqliteTable(
  "billing_customers",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("billing_customers_stripe_unique").on(t.stripeCustomerId),
  ],
);

/**
 * Subscriptions as Stripe last reported them. Rewritten in full from a fresh
 * fetch of the subscription on every event, so events arriving late, twice or
 * out of order can't leave a stale state behind.
 */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    stripeSubscriptionId: text("stripe_subscription_id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Stripe's status: active, trialing, past_due, canceled, incomplete, ...
    status: text("status").notNull(),
    // The plan name from libs/billing, from the price's lookup key.
    plan: text("plan").notNull(),
    stripePriceId: text("stripe_price_id").notNull(),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("subscriptions_workspace_idx").on(t.workspaceId)],
);

/**
 * Stripe events already processed. Stripe delivers at least once, so the
 * consumer records each event id in the same batch as the writes it causes,
 * and skips an id it has seen.
 */
export const stripeEvents = sqliteTable(
  "stripe_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("stripe_events_processed_at_idx").on(t.processedAt)],
);

// ── Email outbox ────────────────────────────────────────────────────────────

/**
 * Emails a deployed dev environment "sent", for reading at /dev/outbox behind
 * Cloudflare Access instead of delivering them (docs/adr/0022-dev-email-outbox.md).
 * Holds working sign-in links, so it is never used in prod, and rows are
 * deleted after a day.
 */
export const emailOutbox = sqliteTable(
  "email_outbox",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    kind: text("kind").notNull(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    html: text("html"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("email_outbox_created_at_idx").on(t.createdAt)],
);
