import { Context, Effect, Layer, Schema } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import { Database } from "@/storage/db"
import { eq, and, desc } from "drizzle-orm"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { Worktree } from "@/worktree"
import * as Log from "@opencode-ai/core/util/log"
import { KanbanTaskTable } from "./kanban.sql"
import { KanbanTaskID } from "./schema"
import type { ProjectID } from "../project/schema"
import type { SessionID } from "../session/schema"
import * as KanbanConfig from "./config"

const log = Log.create({ service: "kanban" })

const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
  Effect.sync(() => Database.use(fn))

export const Event = {
  Created: BusEvent.define(
    "kanban.task.created",
    Schema.Struct({
      taskID: KanbanTaskID,
      projectID: Schema.String,
    }),
  ),
  Updated: BusEvent.define(
    "kanban.task.updated",
    Schema.Struct({
      taskID: KanbanTaskID,
      projectID: Schema.String,
    }),
  ),
  Deleted: BusEvent.define(
    "kanban.task.deleted",
    Schema.Struct({
      taskID: KanbanTaskID,
      projectID: Schema.String,
    }),
  ),
}

export const Info = Schema.Struct({
  id: KanbanTaskID,
  projectID: Schema.String,
  profile: Schema.String,
  workspaceID: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  sessionDirectory: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  title: Schema.String,
  description: Schema.optional(Schema.String),
  stage: Schema.String,
  order: Schema.Number,
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "KanbanTask" })
export type Info = Schema.Schema.Type<typeof Info>

function fromRow(row: typeof KanbanTaskTable.$inferSelect): Info {
  return {
    id: row.id,
    projectID: row.project_id,
    profile: row.profile,
    workspaceID: row.workspace_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    sessionDirectory: row.worktree_directory ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    stage: row.stage,
    order: row.order,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export const CreateInput = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.String),
  stage: Schema.optional(Schema.String),
  profile: Schema.optional(Schema.String),
})

export const UpdateInput = Schema.Struct({
  taskID: KanbanTaskID,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  stage: Schema.optional(Schema.String),
})

export const TransitionInput = Schema.Struct({
  taskID: KanbanTaskID,
  targetStage: Schema.String,
})

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("KanbanTaskNotFoundError", {
  message: Schema.String,
}) {}

export class ConfigNotFoundError extends Schema.TaggedErrorClass<ConfigNotFoundError>()("KanbanConfigNotFoundError", {
  message: Schema.String,
}) {}

export class InvalidTransitionError extends Schema.TaggedErrorClass<InvalidTransitionError>()(
  "KanbanInvalidTransitionError",
  {
    message: Schema.String,
  },
) {}

export type KanbanError = NotFoundError | ConfigNotFoundError | InvalidTransitionError

export interface Interface {
  readonly list: (input: { projectID: ProjectID; profile: string }) => Effect.Effect<Info[]>
  readonly get: (taskID: KanbanTaskID) => Effect.Effect<Info, NotFoundError>
  readonly findBySession: (sessionID: SessionID) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: {
    projectID: ProjectID
    profile: string
    title: string
    description?: string
    stage?: string
  }) => Effect.Effect<Info>
  readonly update: (input: {
    taskID: KanbanTaskID
    title?: string
    description?: string
    stage?: string
  }) => Effect.Effect<Info, NotFoundError>
  readonly remove: (taskID: KanbanTaskID) => Effect.Effect<void, NotFoundError>
  readonly transition: (input: { taskID: KanbanTaskID; targetStage: string }) => Effect.Effect<Info, KanbanError>
  readonly startTask: (
    taskID: KanbanTaskID,
    deps: {
      createWorktree: (name: string) => Effect.Effect<{ directory: string }, Worktree.Error>
      createSession: (input: { title: string; directory: string }) => Effect.Effect<{ sessionID: SessionID }, HttpApiError.BadRequest>
    },
  ) => Effect.Effect<Info, KanbanError>
  readonly approveTask: (taskID: KanbanTaskID) => Effect.Effect<Info, KanbanError>
  readonly loadConfig: (profile: string) => Effect.Effect<KanbanConfig.Config, ConfigNotFoundError>
  readonly listProfiles: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Kanban") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const get = Effect.fn("Kanban.get")(function* (taskID: KanbanTaskID) {
      const row = yield* db((d) => d.select().from(KanbanTaskTable).where(eq(KanbanTaskTable.id, taskID)).get())
      if (!row) return yield* new NotFoundError({ message: `Kanban task not found: ${taskID}` })
      return fromRow(row)
    })

    const findBySession = Effect.fn("Kanban.findBySession")(function* (sessionID: SessionID) {
      const row = yield* db((d) =>
        d.select().from(KanbanTaskTable).where(eq(KanbanTaskTable.session_id, sessionID)).get(),
      )
      if (!row) return yield* new NotFoundError({ message: `No kanban task found for session: ${sessionID}` })
      return fromRow(row)
    })

    const list = Effect.fn("Kanban.list")(function* (input: { projectID: ProjectID; profile: string }) {
      const rows = yield* db((d) =>
        d
          .select()
          .from(KanbanTaskTable)
          .where(and(eq(KanbanTaskTable.project_id, input.projectID), eq(KanbanTaskTable.profile, input.profile)))
          .orderBy(desc(KanbanTaskTable.order))
          .all(),
      )
      return rows.map(fromRow)
    })

    const listProfiles = Effect.fn("Kanban.listProfiles")(function* () {
      const rows = yield* db((d) =>
        d
          .selectDistinct({ profile: KanbanTaskTable.profile })
          .from(KanbanTaskTable)
          .all(),
      )
      const dbProfiles = rows.map((r) => r.profile)
      const configProfiles = yield* KanbanConfig.listProfiles().pipe(Effect.orElseSucceed(() => [] as string[]))
      return [...new Set(["default", ...configProfiles, ...dbProfiles])]
    })

    const create = Effect.fn("Kanban.create")(function* (input: {
      projectID: ProjectID
      profile: string
      title: string
      description?: string
      stage?: string
    }) {
      const id = KanbanTaskID.ascending()
      const now = Date.now()
      const stage = input.stage ?? "backlog"

      const maxOrder = yield* db((d) =>
        d
          .select({ order: KanbanTaskTable.order })
          .from(KanbanTaskTable)
          .where(and(
            eq(KanbanTaskTable.project_id, input.projectID),
            eq(KanbanTaskTable.profile, input.profile),
            eq(KanbanTaskTable.stage, stage),
          ))
          .orderBy(desc(KanbanTaskTable.order))
          .get(),
      )
      const order = (maxOrder?.order ?? 0) + 1

      yield* db((d) =>
        d
          .insert(KanbanTaskTable)
          .values({
            id,
            project_id: input.projectID,
            profile: input.profile,
            title: input.title,
            description: input.description ?? null,
            stage,
            order,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )

      log.info("created", { id, profile: input.profile, title: input.title, stage })
      yield* bus.publish(Event.Created, { taskID: id, projectID: input.projectID })

      return {
        id,
        projectID: input.projectID,
        profile: input.profile,
        title: input.title,
        description: input.description,
        stage,
        order,
        timeCreated: now,
        timeUpdated: now,
      } satisfies Info
    })

    const update = Effect.fn("Kanban.update")(function* (input: {
      taskID: KanbanTaskID
      title?: string
      description?: string
      stage?: string
    }) {
      const task = yield* get(input.taskID)
      const now = Date.now()

      const updates: Record<string, unknown> = { time_updated: now }
      if (input.title !== undefined) updates.title = input.title
      if (input.description !== undefined) updates.description = input.description
      if (input.stage !== undefined) updates.stage = input.stage

      yield* db((d) => d.update(KanbanTaskTable).set(updates).where(eq(KanbanTaskTable.id, input.taskID)).run())
      yield* bus.publish(Event.Updated, { taskID: task.id, projectID: task.projectID })

      return { ...task, ...updates, timeUpdated: now } as Info
    })

    const remove = Effect.fn("Kanban.remove")(function* (taskID: KanbanTaskID) {
      const task = yield* get(taskID)
      yield* db((d) => d.delete(KanbanTaskTable).where(eq(KanbanTaskTable.id, taskID)).run())
      yield* bus.publish(Event.Deleted, { taskID: task.id, projectID: task.projectID })
    })

    const loadConfig = Effect.fn("Kanban.loadConfig")(function* (profile: string) {
      const config = yield* KanbanConfig.load(profile)
      if (!config) return yield* new ConfigNotFoundError({ message: `No kanban config found for profile "${profile}"` })
      return config
    })

    const transition = Effect.fn("Kanban.transition")(function* (input: {
      taskID: KanbanTaskID
      targetStage: string
    }) {
      const task = yield* get(input.taskID)
      const config = yield* loadConfig(task.profile)

      const currentStage = KanbanConfig.getStage(config, task.stage)
      if (!currentStage) {
        return yield* new InvalidTransitionError({ message: `Current stage "${task.stage}" not found in config` })
      }

      if (!("next" in currentStage)) {
        return yield* new InvalidTransitionError({
          message: `Stage "${task.stage}" has no next stage`,
        })
      }

      if (currentStage.next !== input.targetStage) {
        return yield* new InvalidTransitionError({
          message: `Cannot transition from "${task.stage}" to "${input.targetStage}". Expected "${currentStage.next}".`,
        })
      }

      const now = Date.now()
      yield* db((d) =>
        d
          .update(KanbanTaskTable)
          .set({ stage: input.targetStage, time_updated: now })
          .where(eq(KanbanTaskTable.id, input.taskID))
          .run(),
      )

      log.info("transitioned", { taskID: input.taskID, from: task.stage, to: input.targetStage })
      yield* bus.publish(Event.Updated, { taskID: task.id, projectID: task.projectID })

      return { ...task, stage: input.targetStage, timeUpdated: now }
    })

    const startTask = Effect.fn("Kanban.startTask")(function* (
      taskID: KanbanTaskID,
      deps: {
      createWorktree: (name: string) => Effect.Effect<{ directory: string }, Worktree.Error>
      createSession: (input: { title: string; directory: string }) => Effect.Effect<{ sessionID: SessionID }, HttpApiError.BadRequest>
      },
    ) {
      const task = yield* get(taskID)
      const config = yield* loadConfig(task.profile)

      const nextStage = KanbanConfig.getNextStage(config, task.stage) ?? KanbanConfig.getFirstAutoStage(config)
      if (!nextStage || nextStage.type !== "auto") {
        return yield* new InvalidTransitionError({
          message: `Cannot start task in stage "${task.stage}": no active stage found`,
        })
      }

      const slug = Math.random().toString(36).slice(2, 10)
      const worktreeResult = yield* deps.createWorktree(`kanban-${slug}`)
      const sessionResult = yield* deps.createSession({
        title: task.title,
        directory: worktreeResult.directory,
      })

      const now = Date.now()
      yield* db((d) =>
        d
          .update(KanbanTaskTable)
          .set({
            stage: nextStage.name,
            session_id: sessionResult.sessionID,
            worktree_directory: worktreeResult.directory,
            time_updated: now,
          })
          .where(eq(KanbanTaskTable.id, taskID))
          .run(),
      )

      log.info("started task", { taskID, stage: nextStage.name, sessionID: sessionResult.sessionID })

      return {
        ...task,
        stage: nextStage.name,
        sessionID: sessionResult.sessionID,
        sessionDirectory: worktreeResult.directory,
        prompt: KanbanConfig.buildPrompt(task, nextStage),
        timeUpdated: now,
      }
    })

    const approveTask = Effect.fn("Kanban.approveTask")(function* (taskID: KanbanTaskID) {
      const task = yield* get(taskID)
      const config = yield* loadConfig(task.profile)

      const currentStage = KanbanConfig.getStage(config, task.stage)
      if (!currentStage || currentStage.type !== "human-gate") {
        return yield* new InvalidTransitionError({
          message: `Stage "${task.stage}" is not a human-gate stage`,
        })
      }

      const result = yield* transition({ taskID, targetStage: currentStage.next })

      const nextStage = KanbanConfig.getStage(config, currentStage.next)
      if (!nextStage || nextStage.type !== "auto" || !task.sessionID) {
        return result
      }

      return { ...result, prompt: KanbanConfig.buildPrompt(task, nextStage) }
    })

    return Service.of({ list, get, findBySession, create, update, remove, transition, startTask, approveTask, loadConfig, listProfiles } as unknown as Interface)
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.defaultLayer),
)

export * as Kanban from "./kanban"
