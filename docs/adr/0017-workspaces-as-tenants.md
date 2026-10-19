# 0017. Workspaces as tenants, in one shared database

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Billing needs a customer, and most B2B products bill a team, not a person: several people share one subscription and one set of data. Choosing "per user" now would mean migrating every billing record and permission check later. The other open question was how tenants are isolated in D1:

- **One database per tenant:** strong isolation, but D1 allows 10 databases per account on Free and 50,000 on Paid. Every migration has to run against every database, and cross-tenant queries (admin, analytics) need fan-out.
- **One shared database with a tenant column:** one migration, simple admin queries. Isolation is the application's job: every query must filter by tenant.

## Decision

We will make the **workspace** the tenant. Accounts belong to workspaces through `workspace_members` with a per-workspace role (`owner`, `admin`, `member`). Every account gets a personal workspace on first use (`ensurePersonalWorkspace`, race-safe through a unique `personal_user_id`). The workspace is the Stripe customer.

Tenant data lives in the **shared D1 database**, with a `workspace_id` column on every product table. Access goes through `requireWorkspaceRole(principal, workspaceId, minimum)` in `libs/core`. Non-members get the same `ForbiddenError` as members without the role, so an id doesn't reveal whether a workspace exists.

Workspace roles are separate from the platform roles in `libs/auth` (`system_admin` and friends), which are for running the service and grant no access to a workspace's data.

## Consequences

- One schema and one migration path. D1's database size limit (500 MB on Workers Free, 10 GB on Paid; ADR 0020) becomes the ceiling for all tenants together, so a very large tenant would need to move to its own database later.
- Isolation depends on every query filtering by `workspace_id`. A query that forgets is a cross-tenant leak, so workspace-scoped repository functions take the id as a required argument, and tests cover cross-workspace access.
- Inviting members (ADR 0024) and switching workspaces in the UI came next. There's no separate ownership transfer: an owner makes someone else an owner, then steps down or leaves.
