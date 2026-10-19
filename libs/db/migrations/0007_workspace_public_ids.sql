ALTER TABLE `workspaces` ADD `public_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Existing workspaces get a public id before the unique index exists: 10 hex
-- characters, a subset of newPublicId's alphabet and the same length. New
-- workspaces get theirs from libs/core.
UPDATE `workspaces` SET `public_id` = lower(hex(randomblob(5))) WHERE `public_id` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_public_id_unique` ON `workspaces` (`public_id`);
