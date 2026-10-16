-- Seed roles and permissions. Hand-written (drizzle-kit generate --custom).
--
-- Ids are fixed UUIDv7 literals: newId() runs in application code, not in SQL,
-- and code refers to roles and permissions by `name`, so the ids only need to
-- be unique. INSERT OR IGNORE keeps this safe to re-run.
--
-- system_admin needs no role_permissions rows: it implicitly holds every
-- permission, including ones added later. member is the default role granted
-- at sign-up and holds nothing yet; products add their own grants.

INSERT OR IGNORE INTO `roles` (`id`, `name`, `display_name`, `description`, `position`) VALUES
  ('01a14599-a1d7-7bc3-ad98-b41c65f85dcd', 'system_admin', 'System administrator', 'Full access, including every permission added later.', 0),
  ('01a14599-a1d9-72aa-92ff-3b92093ad933', 'member', 'Member', 'Every signed-in account.', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `permissions` (`id`, `name`, `description`) VALUES
  ('01a14599-a1da-70e9-98a5-4d99f704eed0', 'roles:manage', 'Create, rename or delete roles, and edit their permissions.'),
  ('01a14599-a1da-70e9-98a5-4d9a631f39c5', 'roles:assign', 'Assign roles to accounts or remove them.');
