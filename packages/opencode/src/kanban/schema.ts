import { Schema } from "effect"
import { Identifier } from "@/id/id"
import { withStatics } from "@opencode-ai/core/schema"

const kanbanTaskIdSchema = Schema.String.check(Schema.isStartsWith("kbn")).pipe(Schema.brand("KanbanTaskID"))

export type KanbanTaskID = typeof kanbanTaskIdSchema.Type

export const KanbanTaskID = kanbanTaskIdSchema.pipe(
  withStatics((schema: typeof kanbanTaskIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("kanban", id)),
  })),
)
