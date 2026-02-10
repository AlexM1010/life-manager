CREATE TABLE `plan_exports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`plan_id` integer NOT NULL,
	`calendar_id` text NOT NULL,
	`exported_at` text NOT NULL,
	`task_count` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	FOREIGN KEY (`plan_id`) REFERENCES `today_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_plan_exports_user` ON `plan_exports` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_plan_exports_plan` ON `plan_exports` (`plan_id`);--> statement-breakpoint
CREATE INDEX `idx_plan_exports_exported_at` ON `plan_exports` (`exported_at`);--> statement-breakpoint
CREATE TABLE `task_skips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`domain_id` integer NOT NULL,
	`skipped_at` text NOT NULL,
	`skipped_date` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `task_completions` ADD `source` text DEFAULT 'web' NOT NULL;