import { Kanban } from "@/kanban/kanban"
import { KanbanConfig } from "@/kanban/config"
import { KanbanTaskID } from "@/kanban/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiError, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/kanban"

const ProfileParam = Schema.Struct({
  profile: Schema.String,
})

const TaskIDParams = Schema.Struct({
  profile: Schema.String,
  taskID: KanbanTaskID,
})

const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
})

export const TaskCreatePayload = Schema.Struct({
  ...Kanban.CreateInput.fields,
})

export const KanbanPaths = {
  profiles: `${root}/profiles`,
  config: `${root}/profile/:profile/config`,
  list: `${root}/profile/:profile/task`,
  create: `${root}/profile/:profile/task`,
  get: `${root}/profile/:profile/task/:taskID`,
  update: `${root}/profile/:profile/task/:taskID`,
  remove: `${root}/profile/:profile/task/:taskID`,
  start: `${root}/profile/:profile/task/:taskID/start`,
  approve: `${root}/profile/:profile/task/:taskID/approve`,
  transition: `${root}/profile/:profile/task/:taskID/transition`,
  manualTransition: `${root}/profile/:profile/task/:taskID/manual-transition`,
} as const

export const KanbanApi = HttpApi.make("kanban")
  .add(
    HttpApiGroup.make("kanban")
      .add(
        HttpApiEndpoint.get("profiles", KanbanPaths.profiles, {
          query: ListQuery,
          success: described(Schema.Array(Schema.String), "Kanban profile names"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profiles",
            summary: "List kanban profiles",
            description: "List available kanban profile names for the current project.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("config", KanbanPaths.config, {
          params: ProfileParam,
          query: ListQuery,
          success: described(KanbanConfig.Config, "Kanban stage configuration"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profile.config",
            summary: "Get kanban config",
            description: "Get the kanban stage configuration for a profile.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("list", KanbanPaths.list, {
          params: ProfileParam,
          query: ListQuery,
          success: described(Schema.Array(Kanban.Info), "Kanban tasks"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profile.task.list",
            summary: "List kanban tasks",
            description: "List all kanban tasks for a profile.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("get", KanbanPaths.get, {
          params: TaskIDParams,
          query: ListQuery,
          success: described(Kanban.Info, "Kanban task"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profile.task.get",
            summary: "Get kanban task",
            description: "Get a specific kanban task by ID.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("create", KanbanPaths.create, {
          params: ProfileParam,
          query: ListQuery,
          payload: TaskCreatePayload,
          success: described(Kanban.Info, "Created kanban task"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profile.task.create",
            summary: "Create kanban task",
            description: "Create a new kanban task.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.patch("update", KanbanPaths.update, {
          params: TaskIDParams,
          query: ListQuery,
          payload: Schema.Struct({
            title: Schema.optional(Schema.String),
            description: Schema.optional(Schema.String),
            stage: Schema.optional(Schema.String),
          }),
          success: described(Kanban.Info, "Updated kanban task"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profile.task.update",
            summary: "Update kanban task",
            description: "Update a kanban task's title, description, or stage.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.delete("remove", KanbanPaths.remove, {
          params: TaskIDParams,
          query: ListQuery,
          success: described(Kanban.Info, "Deleted kanban task"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profile.task.remove",
            summary: "Remove kanban task",
            description: "Delete a kanban task.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("start", KanbanPaths.start, {
          params: TaskIDParams,
          query: ListQuery,
          success: described(Kanban.Info, "Started kanban task"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profile.task.start",
            summary: "Start kanban task",
            description:
              "Start a kanban task: creates a workspace (worktree), a new session, injects the stage prompt, and transitions to the first active stage.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("approve", KanbanPaths.approve, {
          params: TaskIDParams,
          query: ListQuery,
          success: described(Kanban.Info, "Approved kanban task"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profile.task.approve",
            summary: "Approve kanban task",
            description: "Approve a task at a human-gate stage, moving it to the next stage.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("transition", KanbanPaths.transition, {
          params: TaskIDParams,
          query: ListQuery,
          payload: Schema.Struct({
            targetStage: Schema.String,
          }),
          success: described(Kanban.Info, "Transitioned kanban task"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profile.task.transition",
            summary: "Transition kanban task",
            description: "Manually transition a kanban task to a target stage.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("manualTransition", KanbanPaths.manualTransition, {
          params: TaskIDParams,
          query: ListQuery,
          payload: Schema.Struct({
            targetStage: Schema.String,
          }),
          success: described(Kanban.Info, "Manual transition with auto-prompt"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kanban.profile.task.manualTransition",
            summary: "Manually transition kanban task with auto-prompt",
            description: "Manually transition a kanban task to a target stage. If the target stage has a prompt and the task has an active session, generates and returns the prompt.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "kanban", description: "Kanban board management API." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode kanban HttpApi",
      version: "0.0.1",
      description: "Kanban board management for project tasks.",
    }),
  )
