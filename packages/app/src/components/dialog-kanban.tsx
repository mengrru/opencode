import { Component, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Select } from "@opencode-ai/ui/select"
import { useServerSDK } from "@/context/server-sdk"

type KanbanTask = {
  id: string
  projectID: string
  profile: string
  workspaceID?: string
  sessionID?: string
  sessionDirectory?: string
  prompt?: string
  title: string
  description?: string
  stage: string
  order: number
  timeCreated: number
  timeUpdated: number
}

type KanbanStage =
  | { name: string; type: "entry" }
  | { name: string; type: "human-gate"; next: string }
  | { name: string; type: "auto"; prompt: string; completion: string; next: string }
  | { name: string; type: "terminal" }

type KanbanConfig = {
  stages: KanbanStage[]
}

interface Props {
  directory: string
  onNavigate: (directory: string, sessionID: string, prompt?: string) => void
}

export const DialogKanban: Component<Props> = (props) => {
  const globalSDK = useServerSDK()
  const dialog = useDialog()
  const [tasks, setTasks] = createSignal<KanbanTask[]>([])
  const [config, setConfig] = createSignal<KanbanConfig | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = createSignal("")
  const [startingTaskId, setStartingTaskId] = createSignal<string | null>(null)
  const [editingTaskId, setEditingTaskId] = createSignal<string | null>(null)
  const [editValue, setEditValue] = createSignal("")
  const [profile, setProfile] = createSignal("default")
  const [profiles, setProfiles] = createSignal<string[]>(["default"])

  const dir = () => props.directory

  function navigateAndClose(directory: string, sessionID: string, prompt?: string) {
    props.onNavigate(directory, sessionID, prompt)
    dialog.close()
  }

  const [sessionStatuses, setSessionStatuses] = createStore<Record<string, { type: "idle" | "busy" | "retry" }>>({})

  const isSessionWorking = (sessionID: string) => (sessionStatuses[sessionID]?.type ?? "idle") !== "idle"

  createEffect(() => {
    const directory = dir()

    globalSDK.client.session.status({ directory }).then((result) => {
      if (!result.data) return
      const statuses = result.data as Record<string, { type: string }>
      for (const [id, status] of Object.entries(statuses)) {
        setSessionStatuses(id, status as any)
      }
    }).catch(() => {})

    const unsub = globalSDK.event.listen((e) => {
      if (e.details?.type === "session.status") {
        const props = e.details.properties as { sessionID: string; status: { type: string } }
        if (!props?.sessionID) return
        setSessionStatuses(props.sessionID, props.status as any)
        return
      }
      if (e.details?.type === "kanban.task.created" || e.details?.type === "kanban.task.updated" || e.details?.type === "kanban.task.deleted") {
        loadTasks()
      }
    })
    onCleanup(unsub)
  })

  const p = () => profile()

  async function loadProfiles() {
    try {
      const result = await globalSDK.client.kanban.profiles({ directory: dir() })
      const list = (result.data ?? []) as string[]
      setProfiles(list.length > 0 ? list : ["default"])
      if (!list.includes(p())) setProfile(list[0] || "default")
    } catch {
      setProfiles(["default"])
    }
  }

  async function loadTasks() {
    try {
      const result = await globalSDK.client.kanban.profile.task.list({ profile: p(), directory: dir() })
      setTasks((result.data ?? []) as KanbanTask[])
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function loadConfig() {
    try {
      const result = await globalSDK.client.kanban.profile.config({ profile: p(), directory: dir() })
      setConfig(result.data as KanbanConfig)
    } catch {
      setConfig(null)
    }
  }

  async function loadAll() {
    setLoading(true)
    setError(null)
    await Promise.all([loadProfiles(), loadConfig(), loadTasks()])
    setLoading(false)
  }

  async function handleCreate() {
    const raw = newTaskTitle().trim()
    if (!raw) return
    const lines = raw.split("\n")
    const title = lines[0]
    const description = lines.slice(1).join("\n") || undefined
    setNewTaskTitle("")
    try {
      await globalSDK.client.kanban.profile.task.create({ path_profile: p(), directory: dir(), title, description })
      await loadTasks()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleStart(taskID: string) {
    setStartingTaskId(taskID)
    try {
      const result = await globalSDK.client.kanban.profile.task.start({ profile: p(), taskID, directory: dir() })
      await loadTasks()
      const data = result.data as KanbanTask | undefined
      if (data?.sessionID && data?.sessionDirectory) {
        props.onNavigate(data.sessionDirectory, data.sessionID, data.prompt)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setStartingTaskId(null)
    }
  }

  async function handleApprove(taskID: string) {
    try {
      const result = await globalSDK.client.kanban.profile.task.approve({ profile: p(), taskID, directory: dir() })
      await loadTasks()
      const data = result.data as KanbanTask | undefined
      if (data?.prompt && data?.sessionID && data?.sessionDirectory) {
        props.onNavigate(data.sessionDirectory, data.sessionID, data.prompt)
      }
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleDelete(taskID: string) {
    try {
      await globalSDK.client.kanban.profile.task.remove({ profile: p(), taskID, directory: dir() })
      await loadTasks()
    } catch (e: any) {
      setError(e.message)
    }
  }

  function startEdit(task: KanbanTask) {
    setEditingTaskId(task.id)
    setEditValue(task.description ? `${task.title}\n${task.description}` : task.title)
  }

  async function handleEditSubmit() {
    const taskID = editingTaskId()
    if (!taskID) return
    const raw = editValue().trim()
    if (!raw) return
    const lines = raw.split("\n")
    const title = lines[0]
    const description = lines.slice(1).join("\n") || undefined
    try {
      await globalSDK.client.kanban.profile.task.update({ profile: p(), taskID, directory: dir(), title, description })
      setEditingTaskId(null)
      await loadTasks()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleTransition(taskID: string, taskStage: string) {
    const next = stageNext().get(taskStage)
    if (!next) return
    try {
      const result = await globalSDK.client.kanban.profile.task.manualTransition({ profile: p(), taskID, directory: dir(), targetStage: next })
      await loadTasks()
      const data = result.data as KanbanTask | undefined
      if (data?.prompt && data?.sessionID && data?.sessionDirectory) {
        navigateAndClose(data.sessionDirectory, data.sessionID, data.prompt)
      }
    } catch (e: any) {
      setError(e.message)
    }
  }

  const stageNext = createMemo(() => {
    const cfg = config()
    if (!cfg) return new Map<string, string>()
    const map = new Map<string, string>()
    for (const s of cfg.stages) {
      if ("next" in s && typeof s.next === "string") map.set(s.name, s.next)
    }
    return map
  })

  const profileOptions = createMemo(() => profiles().map((name) => ({ value: name, label: name })))

  onMount(() => {
    void loadAll()
  })

  createEffect(on(profile, () => {
    if (!loading()) void loadAll()
  }))

  async function handleExport() {
    const data = {
      version: 1,
      profile: p(),
      tasks: tasks().map((t) => ({
        title: t.title,
        description: t.description,
        stage: t.stage,
        order: t.order,
      })),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `kanban-${p()}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data?.tasks || !Array.isArray(data.tasks)) {
        setError("Invalid import file: missing tasks array")
        return
      }
      for (const item of data.tasks) {
        if (!item.title) continue
        await globalSDK.client.kanban.profile.task.create({
          path_profile: p(),
          directory: dir(),
          title: item.title,
          description: item.description,
          stage: item.stage,
        })
      }
      await loadTasks()
    } catch (e: any) {
      setError(e.message ?? "Failed to import tasks")
    }
  }

  const stages = () => {
    const cfg = config()
    if (!cfg) return []
    return cfg.stages
  }

  const tasksByStage = (stageName: string) => tasks().filter((t) => t.stage === stageName)

  const stageLabel = (stage: KanbanStage) => {
    if (stage.type === "human-gate") return `${stage.name} (review)`
    if (stage.type === "terminal") return stage.name
    if (stage.type === "entry") return stage.name
    return stage.name
  }

  return (
    <Dialog size="x-large" transition class="!max-w-[85vw]">
      <div class="flex flex-col h-full">
        <div class="flex items-center justify-between px-6 pt-4 pb-3">
           <div class="flex items-center gap-3">
            <h2 class="text-16-semibold text-text-base">Kanban Board</h2>
            <Select
              options={profileOptions()}
              current={profileOptions().find((o) => o.value === profile())}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => { if (o && o.value !== p()) setProfile(o.value) }}
              variant="secondary"
              size="small"
            />
           </div>
           <div class="flex items-center gap-1.5">
            <Button variant="ghost" size="small" onClick={handleExport} disabled={tasks().length === 0}>
              <Icon name="download" size="small" />
            </Button>
            <Button variant="ghost" size="small" onClick={() => document.getElementById("kanban-import-input")?.click()}>
              <Icon name="cloud-upload" size="small" />
            </Button>
            <input
              id="kanban-import-input"
              type="file"
              accept=".json"
              class="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                if (file) handleImport(file)
                e.currentTarget.value = ""
              }}
            />
           </div>
        </div>

        <Show when={error()}>
          <div class="mx-6 mb-2 px-3 py-2 bg-red-100 text-red-800 text-13-medium rounded-md">
            {error()}
            <button class="ml-2 underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        </Show>

        <Show
          when={!loading()}
          fallback={
            <div class="flex-1 flex items-center justify-center text-text-weak text-14-medium">
              Loading...
            </div>
          }
        >
          <Show
            when={config()}
            fallback={
              <div class="flex-1 flex flex-col items-center justify-center gap-3 text-text-weak px-6">
                <Icon name="checklist" size="large" />
                <p class="text-14-medium">No kanban configuration found</p>
                <p class="text-13-regular text-center">
                  Create a <code class="bg-background-base px-1.5 py-0.5 rounded text-12-mono">.opencode/kanban/default.json</code> file in your project to enable the kanban board.
                </p>
              </div>
            }
          >
            <div class="flex-1 overflow-x-auto overflow-y-hidden px-4 pb-4">
              <div class="flex gap-3 h-full min-w-max">
                <For each={stages()}>
                  {(stage) => {
                    const stageTasks = () => tasksByStage(stage.name)
                    const isEntry = stage.type === "entry"
                    return (
                      <div class="flex flex-col w-72 min-w-[18rem] bg-background-base rounded-lg border border-border-base">
                        <div class="flex items-center justify-between px-3 py-2.5 border-b border-border-base">
                          <span class="text-13-semibold text-text-base capitalize">
                            {stageLabel(stage)}
                          </span>
                          <span class="text-12-regular text-text-weak">{stageTasks().length}</span>
                        </div>
                        <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                          <Show when={isEntry}>
                            <form
                              class="flex gap-1.5 items-start"
                              onSubmit={(e) => {
                                e.preventDefault()
                                handleCreate()
                              }}
                            >
                              <textarea
                                ref={(el) => {
                                  const adjust = () => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px" }
                                  el.addEventListener("input", adjust)
                                }}
                                value={newTaskTitle()}
                                onInput={(e) => setNewTaskTitle(e.currentTarget.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreate() }
                                }}
                                placeholder="Add task..."
                                rows={1}
                                class="flex-1 min-w-0 px-2 py-1.5 text-13-regular bg-background-surface border border-border-base rounded-md text-text-base placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                              />
                              <Button type="submit" variant="ghost" size="small" disabled={!newTaskTitle().trim()}>
                                <Icon name="plus" size="small" />
                              </Button>
                            </form>
                          </Show>
                          <For each={stageTasks()}>
                            {(t) => {
                              const isEditing = () => editingTaskId() === t.id
                              return (
                                <div class="bg-background-surface rounded-md border border-border-base p-3 flex flex-col gap-2">
                                  <div class="flex items-start justify-between gap-2">
                                    <Show when={isEditing()} fallback={
                                      <div class="flex items-center gap-1.5 min-w-0 flex-1">
                                        <Show when={t.sessionID && isSessionWorking(t.sessionID)}>
                                          <Spinner class="size-[11px] shrink-0" />
                                        </Show>
                                        <span class="text-13-medium text-text-base break-words">
                                          {t.title}
                                        </span>
                                      </div>
                                    }>
                                      <textarea
                                        ref={(el) => {
                                          const adjust = () => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px" }
                                          el.addEventListener("input", adjust)
                                          requestAnimationFrame(adjust)
                                        }}
                                        value={editValue()}
                                        onInput={(e) => setEditValue(e.currentTarget.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSubmit() }
                                          if (e.key === "Escape") setEditingTaskId(null)
                                        }}
                                        class="flex-1 min-w-0 px-1.5 py-1 text-13-regular bg-background-base border border-border-base rounded text-text-base resize-none focus:outline-none focus:ring-1 focus:ring-accent"
                                        autofocus
                                      />
                                    </Show>
                                    <DropdownMenu>
                                      <DropdownMenu.Trigger as={IconButton} icon="dot-grid" variant="ghost" size="small" class="shrink-0" />
                                      <DropdownMenu.Portal>
                                        <DropdownMenu.Content>
                                          <Show when={isEntry}>
                                            <Show when={isEditing()} fallback={
                                              <DropdownMenu.Item onSelect={() => startEdit(t)}>Edit</DropdownMenu.Item>
                                            }>
                                              <DropdownMenu.Item onSelect={handleEditSubmit}>Save</DropdownMenu.Item>
                                            </Show>
                                          </Show>
                                          <Show when={!isEntry}>
                                            <DropdownMenu.Item
                                              onSelect={() => handleTransition(t.id, t.stage)}
                                              disabled={isSessionWorking(t.sessionID!) || !stageNext().get(t.stage)}
                                            >
                                              Move to next stage
                                            </DropdownMenu.Item>
                                          </Show>
                                          <DropdownMenu.Item onSelect={() => handleDelete(t.id)}>
                                            Delete
                                          </DropdownMenu.Item>
                                        </DropdownMenu.Content>
                                      </DropdownMenu.Portal>
                                    </DropdownMenu>
                                  </div>
                                  <Show when={t.description && !isEditing()}>
                                    <p class="text-12-regular text-text-weak break-words">
                                      {t.description}
                                    </p>
                                  </Show>
                                  <div class="flex gap-1.5 flex-wrap">
                                    <Show when={isEntry}>
                                      <Button
                                        variant="primary"
                                        size="small"
                                        onClick={() => handleStart(t.id)}
                                        disabled={startingTaskId() === t.id}
                                      >
                                        {startingTaskId() === t.id ? "Starting..." : "Start"}
                                      </Button>
                                    </Show>
                                    <Show when={stage.type === "human-gate"}>
                                      <Button
                                        variant="primary"
                                        size="small"
                                        onClick={() => handleApprove(t.id)}
                                        disabled={t.sessionID ? isSessionWorking(t.sessionID) : false}
                                      >
                                        Approve
                                      </Button>
                                    </Show>
                                    <Show when={t.sessionID && !isEntry}>
                                      <Button
                                        variant="ghost"
                                        size="small"
                                        onClick={() =>
                                          t.sessionID &&
                                          navigateAndClose(t.sessionDirectory ?? props.directory, t.sessionID!)
                                        }
                                      >
                                        View Session
                                      </Button>
                                    </Show>
                                  </div>
                                </div>
                              )
                            }}
                          </For>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </Dialog>
  )
}
