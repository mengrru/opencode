import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import type { KanbanTaskID } from "./schema"
import type { WorkspaceID } from "../control-plane/schema"
import type { SessionID } from "../session/schema"
import { Timestamps } from "../storage/schema.sql"

export const KanbanTaskTable = sqliteTable(
  "kanban_task",
  {
    id: text().$type<KanbanTaskID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text().$type<WorkspaceID>(),
    session_id: text().$type<SessionID>(),
    worktree_directory: text(),
    title: text().notNull(),
    description: text(),
    stage: text().notNull(),
    profile: text().notNull().default("default"),
    order: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("kanban_task_project_idx").on(table.project_id),
    index("kanban_task_stage_idx").on(table.project_id, table.stage),
  ],
)
