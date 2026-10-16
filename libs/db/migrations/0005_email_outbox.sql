CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`text` text NOT NULL,
	`html` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_outbox_created_at_idx` ON `email_outbox` (`created_at`);