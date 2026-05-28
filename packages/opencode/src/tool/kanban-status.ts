import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Kanban } from "@/kanban/kanban"
import { KanbanConfig } from "@/kanban/config"

const Parameters = Schema.Struct({})

type Metadata = {
  taskID: string
  stage: string
  title: string
}

export const KanbanStatusTool = Tool.define<typeof Parameters, Metadata, Kanban.Service>(
  "kanban-task-status",
  Effect.gen(function* () {
    const kanban = yield* Kanban.Service

    return {
      description:
        "Get the current status and stage of the kanban task associated with the current session. Use this to check where the task is in the pipeline.",
      parameters: Parameters,
      execute: (_params, ctx) =>
        Effect.gen(function* () {
          const task = yield* kanban.findBySession(ctx.sessionID)
          const config = yield* kanban.loadConfig(task.profile)
          const currentStage = KanbanConfig.getStage(config, task.stage)
          const stageType = currentStage ? currentStage.type : "unknown"
          return {
            title: `Task: ${task.title}`,
            output: [
              `ID: ${task.id}`,
              `Stage: ${task.stage} (${stageType})`,
              `Title: ${task.title}`,
              task.description ? `Description: ${task.description}` : null,
            ].filter(Boolean).join("\n"),
            metadata: { taskID: task.id, stage: task.stage, title: task.title },
          }
        }).pipe(
          Effect.catch((e) =>
            Effect.succeed({
              title: "Task lookup failed",
              output: `No kanban task found for current session. Error: ${String(e)}`,
              metadata: { taskID: ctx.sessionID, stage: "", title: "" },
            }),
          ),
        ),
    }
  }),
)
