CREATE TABLE IF NOT EXISTS `kanban_task` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`session_id` text,
	`worktree_directory` text,
	`title` text NOT NULL,
	`description` text,
	`stage` text NOT NULL,
	`profile` text DEFAULT 'default' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_kanban_task_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `kanban_task_project_idx` ON `kanban_task` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `kanban_task_stage_idx` ON `kanban_task` (`project_id`,`stage`);
