import type { PluginInput } from "@opencode-ai/plugin"
import type { TrackedTask, TaskStatus, ModelFallbackInfo } from "./types"
import type { ConcurrencyManager } from "../background-agent/concurrency"
import { PerfTimer } from "../../shared/perf-timer"

type OpencodeClient = PluginInput["client"]

export class TaskToastManager {
  private tasks: Map<string, TrackedTask> = new Map()
  private client: OpencodeClient
  private concurrencyManager?: ConcurrencyManager
  private completionBatch: Array<{ id: string; description: string; duration: string }> = []
  private completionDebounceTimer?: ReturnType<typeof setTimeout>
  private static COMPLETION_DEBOUNCE_MS = 800  // Batch completions within 800ms

  constructor(client: OpencodeClient, concurrencyManager?: ConcurrencyManager) {
    this.client = client
    this.concurrencyManager = concurrencyManager
  }

  setConcurrencyManager(manager: ConcurrencyManager): void {
    this.concurrencyManager = manager
  }

  addTask(task: {
    id: string
    description: string
    agent: string
    isBackground: boolean
    status?: TaskStatus
    category?: string
    skills?: string[]
    modelInfo?: ModelFallbackInfo
  }): void {
    const trackedTask: TrackedTask = {
      id: task.id,
      description: task.description,
      agent: task.agent,
      status: task.status ?? "running",
      startedAt: new Date(),
      isBackground: task.isBackground,
      category: task.category,
      skills: task.skills,
      modelInfo: task.modelInfo,
    }

    this.tasks.set(task.id, trackedTask)
    this.showTaskListToast(trackedTask)
  }

  /**
   * Update task status
   */
  updateTask(id: string, status: TaskStatus): void {
    const task = this.tasks.get(id)
    if (task) {
      task.status = status
    }
  }

  /**
   * Remove completed/error task
   */
  removeTask(id: string): void {
    this.tasks.delete(id)
  }

  /**
   * Get all running tasks (newest first)
   */
  getRunningTasks(): TrackedTask[] {
    const running = Array.from(this.tasks.values())
      .filter((t) => t.status === "running")
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    return running
  }

  /**
   * Get all queued tasks
   */
  getQueuedTasks(): TrackedTask[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.status === "queued")
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  }

  /**
   * Format duration since task started
   */
  private formatDuration(startedAt: Date): string {
    return PerfTimer.formatDuration(startedAt, undefined, { precision: "compact" })
  }

  private getConcurrencyInfo(): string {
    if (!this.concurrencyManager) return ""
    const running = this.getRunningTasks()
    const queued = this.getQueuedTasks()
    const total = running.length + queued.length
    const limit = this.concurrencyManager.getConcurrencyLimit("default")
    if (limit === Infinity) return ""
    return ` [${total}/${limit}]`
  }

  private buildTaskListMessage(newTask: TrackedTask): string {
    const running = this.getRunningTasks()
    const queued = this.getQueuedTasks()
    const concurrencyInfo = this.getConcurrencyInfo()

    const lines: string[] = []

    const isFallback = newTask.modelInfo && (
      newTask.modelInfo.type === "inherited" || newTask.modelInfo.type === "system-default"
    )
    if (isFallback) {
      const suffixMap: Record<"inherited" | "system-default", string> = {
        inherited: "（继承自父任务）",
        "system-default": "（系统默认回退）",
      }
      const suffix = suffixMap[newTask.modelInfo!.type as "inherited" | "system-default"]
      lines.push(`[回退] 模型：${newTask.modelInfo!.model}${suffix}`)
      lines.push("")
    }

    if (running.length > 0) {
      lines.push(`运行中 (${running.length})：${concurrencyInfo}`)
      for (const task of running) {
        const duration = this.formatDuration(task.startedAt)
        const bgIcon = task.isBackground ? "[后台]" : "[运行]"
        const isNew = task.id === newTask.id ? " ← NEW" : ""
        const categoryInfo = task.category ? `/${task.category}` : ""
        const skillsInfo = task.skills?.length ? ` [${task.skills.join(", ")}]` : ""
        lines.push(`${bgIcon} ${task.description} (${task.agent}${categoryInfo})${skillsInfo} - ${duration}${isNew}`)
      }
    }

    if (queued.length > 0) {
      if (lines.length > 0) lines.push("")
      lines.push(`排队中 (${queued.length})：`)
      for (const task of queued) {
        const bgIcon = task.isBackground ? "[队]" : "[等]"
        const categoryInfo = task.category ? `/${task.category}` : ""
        const skillsInfo = task.skills?.length ? ` [${task.skills.join(", ")}]` : ""
        const isNew = task.id === newTask.id ? " ← NEW" : ""
        lines.push(`${bgIcon} ${task.description} (${task.agent}${categoryInfo})${skillsInfo} - 排队中${isNew}`)
      }
    }

    return lines.join("\n")
  }

  /**
   * Show consolidated toast with all running/queued tasks
   */
  private showTaskListToast(newTask: TrackedTask): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tuiClient = this.client as any
    if (!tuiClient.tui?.showToast) return

    const message = this.buildTaskListMessage(newTask)
    const running = this.getRunningTasks()
    const queued = this.getQueuedTasks()

    const title = newTask.isBackground
      ? `新后台任务`
      : `新任务已执行`

    tuiClient.tui.showToast({
      body: {
        title,
        message: message || `${newTask.description} (${newTask.agent})`,
        variant: "info",
        duration: running.length + queued.length > 2 ? 5000 : 3000,
      },
    }).catch(() => {})
  }

  /**
   * Show task completion toast with debounce to batch rapid completions.
   */
  showCompletionToast(task: { id: string; description: string; duration: string }): void {
    this.removeTask(task.id)
    this.completionBatch.push(task)

    if (this.completionDebounceTimer) {
      clearTimeout(this.completionDebounceTimer)
    }

    this.completionDebounceTimer = setTimeout(() => {
      this.flushCompletionBatch()
    }, TaskToastManager.COMPLETION_DEBOUNCE_MS)
  }

  private flushCompletionBatch(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tuiClient = this.client as any
    if (!tuiClient.tui?.showToast) {
      this.completionBatch = []
      return
    }

    const batch = [...this.completionBatch]
    this.completionBatch = []

    if (batch.length === 0) return

    const remaining = this.getRunningTasks()
    const queued = this.getQueuedTasks()

    let message: string
    if (batch.length === 1) {
      message = `"${batch[0].description}" 已完成，耗时 ${batch[0].duration}`
    } else {
      const lines = batch.map(t => `  ✓ "${t.description}" (${t.duration})`)
      message = `${batch.length} 个任务已完成：\n${lines.join("\n")}`
    }

    if (remaining.length > 0 || queued.length > 0) {
      message += `\n\n运行中：${remaining.length} | 排队：${queued.length}`
    }

    tuiClient.tui.showToast({
      body: {
        title: batch.length === 1 ? "任务完成" : `${batch.length} 个任务已完成`,
        message,
        variant: "success",
        duration: batch.length > 1 ? 7000 : 5000,
      },
    }).catch(() => {})

    this.completionDebounceTimer = undefined
  }
}

let instance: TaskToastManager | null = null

export function getTaskToastManager(): TaskToastManager | null {
  return instance
}

export function initTaskToastManager(
  client: OpencodeClient,
  concurrencyManager?: ConcurrencyManager
): TaskToastManager {
  instance = new TaskToastManager(client, concurrencyManager)
  return instance
}
