import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Kanban } from "@/kanban/kanban"
import { KanbanConfig } from "@/kanban/config"

const Parameters = Schema.Struct({
  completion_summary: Schema.String.annotate({
    description: "A brief summary explaining why the task is ready to move to the next stage",
  }),
})

type Metadata = {
  taskID: string
  fromStage: string
  toStage: string
}

export const KanbanTransitionTool = Tool.define<typeof Parameters, Metadata, Kanban.Service>(
  "kanban-task-transition",
  Effect.gen(function* () {
    const kanban = yield* Kanban.Service

    return {
      description:
        "Transition the kanban task associated with the current session to its next stage. Only call this when you believe the current stage's completion criteria have been met. The system will validate the transition is allowed. NOTE: You cannot transition tasks that are in a human-gate stage — those require human approval.",
      parameters: Parameters,
      execute: (_params, ctx) =>
        Effect.gen(function* () {
          const task = yield* kanban.findBySession(ctx.sessionID)
          const config = yield* kanban.loadConfig(task.profile)
          const currentStage = KanbanConfig.getStage(config, task.stage)

          if (!currentStage) {
            return {
              title: "Invalid stage",
              output: `Current stage "${task.stage}" not found in kanban config.`,
              metadata: { taskID: task.id, fromStage: task.stage, toStage: task.stage },
            }
          }

          if (currentStage.type === "human-gate") {
            return {
              title: "Human approval required",
              output: `Task "${task.title}" is in stage "${task.stage}" which requires human approval. You cannot transition this task automatically. Wait for a human to approve it.`,
              metadata: { taskID: task.id, fromStage: task.stage, toStage: task.stage },
            }
          }

          if (!("next" in currentStage)) {
            return {
              title: "Cannot transition",
              output: `Stage "${task.stage}" has no next stage defined.`,
              metadata: { taskID: task.id, fromStage: task.stage, toStage: task.stage },
            }
          }

          const result = yield* kanban.transition({
            taskID: task.id,
            targetStage: currentStage.next,
          })

          const nextStage = KanbanConfig.getStage(config, currentStage.next)

          if (nextStage && nextStage.type === "human-gate") {
            return {
              title: `Task moved to ${result.stage} (awaiting approval)`,
              output: `Task "${task.title}" transitioned from "${task.stage}" to "${result.stage}".\nReason: ${_params.completion_summary}\n\nThis stage requires human approval. Stop here and wait for approval.`,
              metadata: { taskID: task.id, fromStage: task.stage, toStage: result.stage },
            }
          }

          if (nextStage && nextStage.type === "auto") {
            const prefix = [
              `Task transitioned from "${task.stage}" to "${result.stage}".`,
              `Reason: ${_params.completion_summary}`,
              ``,
              `---`,
            ].join("\n")

            return {
              title: `Task moved to ${result.stage} — continue working`,
              output: KanbanConfig.buildPrompt(task, nextStage, prefix),
              metadata: { taskID: task.id, fromStage: task.stage, toStage: result.stage },
            }
          }

          return {
            title: `Task moved to ${result.stage}`,
            output: `Task "${task.title}" transitioned from "${task.stage}" to "${result.stage}".\nReason: ${_params.completion_summary}`,
            metadata: { taskID: task.id, fromStage: task.stage, toStage: result.stage },
          }
        }).pipe(
          Effect.catch((e) =>
            Effect.succeed({
              title: "Transition failed",
              output: `Failed to transition task: ${String(e)}`,
              metadata: { taskID: ctx.sessionID, fromStage: "", toStage: "" },
            }),
          ),
        ),
    }
  }),
)
