import type { FallbackAttempt } from "../../shared/runtime-fallback"

export type { FallbackAttempt }

export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "cancelled"

export interface PhaseTiming {
  /** queuedAt -> startedAt in ms */
  queueWaitMs: number
  /** startedAt -> completedAt in ms */
  totalRunMs: number
  /** startedAt -> first assistant message in ms */
  firstResponseMs?: number
  /** startedAt -> last message in ms */
  lastResponseMs?: number
  /** Total tool call count */
  toolCallCount: number
  /** toolCallCount / totalRunMs * 60000 (calls per minute) */
  toolCallRate?: number
}

export interface TaskProgress {
  toolCalls: number
  lastTool?: string
  lastUpdate: Date
  lastMessage?: string
  lastMessageAt?: Date
  phaseTiming?: PhaseTiming
  /** Timestamp when the current LLM step started (reset on each session.idle) */
  stepStartedAt?: number
}

export interface BackgroundTask {
  id: string
  sessionID?: string
  parentSessionID: string
  parentMessageID: string
  description: string
  prompt: string
  agent: string
  status: BackgroundTaskStatus
  queuedAt?: Date
  startedAt?: Date
  completedAt?: Date
  result?: string
  error?: string
  progress?: TaskProgress
  parentModel?: { providerID: string; modelID: string }
  model?: { providerID: string; modelID: string; variant?: string }
  /** Active concurrency slot key */
  concurrencyKey?: string
  /** Persistent key for re-acquiring concurrency on resume */
  concurrencyGroup?: string
  /** Parent session's agent name for notification */
  parentAgent?: string

  /** Last message count for stability detection */
  lastMsgCount?: number
  /** Number of consecutive polls with stable message count */
  stablePolls?: number
  /** Step count (incremented on session.idle events) */
  stepCount?: number
  /** Max steps before auto-completion (0 = unlimited) */
  maxSteps?: number
  /** Max runtime in ms before auto-completion (0 / undefined = unlimited, uses TASK_TTL_MS) */
  maxRuntimeMs?: number
  /** Max duration of a single step in ms (0 / undefined = unlimited) */
  stepTimeoutMs?: number
  /** Fallback attempts history */
  attempts?: FallbackAttempt[]
}

export interface LaunchInput {
  description: string
  prompt: string
  agent: string
  parentSessionID: string
  parentMessageID: string
  parentModel?: { providerID: string; modelID: string }
  parentAgent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  skills?: string[]
  skillContent?: string
}

export interface ResumeInput {
  sessionId: string
  prompt: string
  parentSessionID: string
  parentMessageID: string
  parentModel?: { providerID: string; modelID: string }
  parentAgent?: string
}
