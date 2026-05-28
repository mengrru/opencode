import { Kanban } from "@/kanban/kanban"
import { KanbanConfig } from "@/kanban/config"
import type { KanbanTaskID } from "@/kanban/schema"
import * as InstanceState from "@/effect/instance-state"
import { Session } from "@/session/session"
import { Worktree } from "@/worktree"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { TaskCreatePayload } from "../groups/kanban"

export const kanbanHandlers = HttpApiBuilder.group(InstanceHttpApi, "kanban", (handlers) =>
  Effect.gen(function* () {
    const kanban = yield* Kanban.Service
    const worktree = yield* Worktree.Service
    const sessionSvc = yield* Session.Service

    const profiles = Effect.fn("KanbanHttpApi.profiles")(function* () {
      return yield* kanban.listProfiles()
    })

    const config = Effect.fn("KanbanHttpApi.config")(function* (ctx: { params: { profile: string } }) {
      return yield* kanban.loadConfig(ctx.params.profile).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const list = Effect.fn("KanbanHttpApi.list")(function* (ctx: { params: { profile: string } }) {
      const instance = yield* InstanceState.context
      return yield* kanban.list({ projectID: instance.project.id, profile: ctx.params.profile })
    })

    const create = Effect.fn("KanbanHttpApi.create")(function* (ctx: {
      params: { profile: string }
      payload: typeof TaskCreatePayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* kanban
        .create({
          projectID: instance.project.id,
          profile: ctx.params.profile,
          title: ctx.payload.title,
          description: ctx.payload.description,
          stage: ctx.payload.stage,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const get = Effect.fn("KanbanHttpApi.get")(function* (ctx: { params: { taskID: KanbanTaskID } }) {
      return yield* kanban.get(ctx.params.taskID).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const update = Effect.fn("KanbanHttpApi.update")(function* (ctx: {
      params: { taskID: KanbanTaskID }
      payload: { title?: string; description?: string; stage?: string }
    }) {
      return yield* kanban
        .update({
          taskID: ctx.params.taskID,
          title: ctx.payload.title,
          description: ctx.payload.description,
          stage: ctx.payload.stage,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const remove = Effect.fn("KanbanHttpApi.remove")(function* (ctx: { params: { taskID: KanbanTaskID } }) {
      const task = yield* kanban.get(ctx.params.taskID).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      yield* kanban.remove(ctx.params.taskID).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return task
    })

    const start = Effect.fn("KanbanHttpApi.start")(function* (ctx: { params: { taskID: KanbanTaskID } }) {
      return yield* kanban
        .startTask(ctx.params.taskID, {
          createWorktree: (name: string) =>
            worktree.create({ name }).pipe(
              Effect.map((wt) => ({ directory: wt.directory })),
            ),
          createSession: (input: { title: string; directory: string }) =>
            sessionSvc.create({ title: input.title, directory: input.directory, agent: "build" }).pipe(
              Effect.map((s) => ({ sessionID: s.id })),
              Effect.mapError(() => new HttpApiError.BadRequest({})),
            ),
        })
        .pipe(Effect.tapError((e) => Effect.sync(() => console.error("[kanban] start failed:", e))))
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const approve = Effect.fn("KanbanHttpApi.approve")(function* (ctx: { params: { taskID: KanbanTaskID } }) {
      return yield* kanban.approveTask(ctx.params.taskID).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const transition = Effect.fn("KanbanHttpApi.transition")(function* (ctx: {
      params: { taskID: KanbanTaskID }
      payload: { targetStage: string }
    }) {
      return yield* kanban
        .transition({
          taskID: ctx.params.taskID,
          targetStage: ctx.payload.targetStage,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const manualTransition = Effect.fn("KanbanHttpApi.manualTransition")(function* (ctx: {
      params: { taskID: KanbanTaskID }
      payload: { targetStage: string }
    }) {
      const result = yield* kanban
        .transition({
          taskID: ctx.params.taskID,
          targetStage: ctx.payload.targetStage,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))

      const config = yield* kanban.loadConfig(result.profile).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const nextStage = KanbanConfig.getStage(config, ctx.payload.targetStage)
      if (!nextStage || nextStage.type !== "auto" || !result.sessionID) return result

      return { ...result, prompt: KanbanConfig.buildPrompt(result, nextStage) }
    })

    return handlers
      .handle("profiles", profiles)
      .handle("config", config)
      .handle("list", list)
      .handle("create", create)
      .handle("get", get)
      .handle("update", update)
      .handle("remove", remove)
      .handle("start", start)
      .handle("approve", approve)
      .handle("transition", transition)
      .handle("manualTransition", manualTransition)
  }),
)
