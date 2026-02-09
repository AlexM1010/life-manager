CREATE TABLE `oauth_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_user_provider_unique` ON `oauth_tokens` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `idx_oauth_tokens_user` ON `oauth_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`operation` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`status` text NOT NULL,
	`details` text,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sync_log_user_timestamp` ON `sync_log` (`user_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `sync_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`operation` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sync_queue_user_status` ON `sync_queue` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_sync_queue_next_retry` ON `sync_queue` (`next_retry_at`);--> statement-breakpoint
CREATE TABLE `task_sync_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`google_task_id` text,
	`google_event_id` text,
	`is_fixed` integer DEFAULT false NOT NULL,
	`last_sync_time` text,
	`sync_status` text NOT NULL,
	`sync_error` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_sync_metadata_task_id_unique` ON `task_sync_metadata` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_sync_metadata_task` ON `task_sync_metadata` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_sync_metadata_google_task` ON `task_sync_metadata` (`google_task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_sync_metadata_google_event` ON `task_sync_metadata` (`google_event_id`);