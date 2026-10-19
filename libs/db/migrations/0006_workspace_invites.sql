CREATE TABLE `workspace_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`declined_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invites_token_hash_unique` ON `workspace_invites` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invites_open_unique` ON `workspace_invites` (`workspace_id`,`email`) WHERE "workspace_invites"."accepted_at" IS NULL AND "workspace_invites"."declined_at" IS NULL AND "workspace_invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `workspace_invites_expires_at_idx` ON `workspace_invites` (`expires_at`);