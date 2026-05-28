import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

const EntryStage = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("entry"),
})

const HumanGateStage = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("human-gate"),
  next: Schema.String,
})

const AutoStage = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("auto"),
  prompt: Schema.String,
  completion: Schema.String,
  next: Schema.String,
})

const TerminalStage = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("terminal"),
})

export const Stage = Schema.Union([EntryStage, HumanGateStage, AutoStage, TerminalStage])
export type Stage = Schema.Schema.Type<typeof Stage>

export const Config = Schema.Struct({
  stages: Schema.Array(Stage),
})
export type Config = Schema.Schema.Type<typeof Config>

function withTypeDefault(stages: unknown[]): unknown[] {
  return stages.map((s: unknown) => {
    const stage = s as Record<string, unknown>
    if (stage.type !== undefined || typeof stage.prompt !== "string") return stage
    return { ...stage, type: "auto" }
  })
}

const parseConfig = (content: string): Config | null => {
  const raw = JSON.parse(content)
  return Schema.decodeUnknownSync(Config)({ ...raw, stages: withTypeDefault(raw.stages ?? []) })
}

const loadFile = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const content = yield* fs.readFileStringSafe(filePath).pipe(Effect.orElseSucceed(() => null))
    if (!content) return undefined
    return yield* Effect.sync(() => parseConfig(content)).pipe(
      Effect.orElseSucceed(() => null as Config | null),
    )
  })

export const load = Effect.fn("KanbanConfig.load")(function* (profile: string) {
  const ctx = yield* InstanceState.context
  const dir = path.join(ctx.directory, ".opencode", "kanban")

  if (profile !== "default") {
    const config = yield* loadFile(path.join(dir, `${profile}.json`))
    if (config) return config
  }

  const defaultConfig = yield* loadFile(path.join(dir, "default.json"))
  if (defaultConfig) return defaultConfig

  const legacyConfig = yield* loadFile(path.join(ctx.directory, ".opencode", "kanban.json"))
  if (legacyConfig) return legacyConfig

  return undefined
})

export const listProfiles = Effect.fn("KanbanConfig.listProfiles")(function* () {
  const ctx = yield* InstanceState.context
  const fs = yield* AppFileSystem.Service
  const dir = path.join(ctx.directory, ".opencode", "kanban")

  const dirProfiles = yield* fs.readDirectoryEntries(dir).pipe(
    Effect.map((entries) =>
      entries
        .filter((e) => e.name.endsWith(".json"))
        .map((e) => e.name.replace(/\.json$/, ""))
    ),
    Effect.orElseSucceed(() => [] as string[]),
  )

  const legacyExists = yield* fs
    .readFileStringSafe(path.join(ctx.directory, ".opencode", "kanban.json"))
    .pipe(Effect.map(() => true), Effect.orElseSucceed(() => false))

  const profiles = [...dirProfiles]
  if (legacyExists && !profiles.includes("default")) profiles.push("default")
  return profiles
})

export const getStage = (config: Config, stageName: string): Stage | undefined =>
  config.stages.find((s) => s.name === stageName)

export const getNextStage = (config: Config, stageName: string): Stage | undefined => {
  const current = getStage(config, stageName)
  if (!current) return undefined
  if ("next" in current) return getStage(config, current.next)
  if (current.type === "entry") return getFirstAutoStage(config)
  return undefined
}

export const getFirstAutoStage = (config: Config): Stage | undefined =>
  config.stages.find((s) => s.type === "auto")

export const buildPrompt = (
  task: { id: string; title: string; description?: string },
  stage: { prompt: string; completion: string; next: string },
  prefix?: string,
): string => {
  const content = [task.title, task.description].filter(Boolean).join("\n")
  const resolved = stage.prompt
    .replace(/\{\{task\.content\}\}/g, content)
    .replace(/\{\{task\.id\}\}/g, task.id)
    .replace(/\{\{task\.title\}\}/g, task.title)
  const lines = [
    prefix,
    `Complete the following task:`,
    resolved,
    ``,
    `This task is complete when:`,
    stage.completion,
    ``,
    `Once the completion criteria are met, call kanban-task-transition to move the task to the "${stage.next}" stage.`,
  ]
  return lines.filter(Boolean).join("\n")
}

export * as KanbanConfig from "./config"
