import type { PluginInput } from "@opencode-ai/plugin"
import {
  loadLanguageReminderState,
  saveLanguageReminderState,
  clearLanguageReminderState,
} from "./storage"
import { LANGUAGE_REMINDER_MESSAGE } from "./constants"
import type { LanguageReminderState } from "./types"

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}

interface EventInput {
  event: {
    type: string
    properties?: unknown
  }
}

function isEnglishText(text: string, threshold: number): boolean {
  const stripped = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[A-Za-z]:[\\/]\S+|[./~]\S+\/\S+/g, "")
  const meaningful = stripped.replace(/[\s\d\p{P}]/gu, "")
  if (meaningful.length < 20) return false
  const asciiLetters = (meaningful.match(/[a-zA-Z]/g) || []).length
  return asciiLetters / meaningful.length > threshold
}

export function createLanguageReminderHook(ctx: PluginInput) {
  const sessionStates = new Map<string, LanguageReminderState>()
  const userMessageHistory = new Map<string, string[]>()

  const config = (ctx as any).config as Record<string, any> | undefined
  const le = config?.language_enforcement as Record<string, any> | undefined
  const reminderInterval = le?.reminder_interval ?? 5
  const userEnglishThreshold = le?.user_message_english_threshold ?? 0.6
  const userMessageLookback = le?.user_message_lookback ?? 3

  function getOrCreateState(sessionID: string): LanguageReminderState {
    if (!sessionStates.has(sessionID)) {
      const persisted = loadLanguageReminderState(sessionID)
      const state: LanguageReminderState = persisted ?? {
        sessionID,
        toolCallCount: 0,
        suspendedDueToUserEnglish: false,
        updatedAt: Date.now(),
      }
      sessionStates.set(sessionID, state)
    }
    return sessionStates.get(sessionID)!
  }

  function resetState(sessionID: string): void {
    sessionStates.delete(sessionID)
    userMessageHistory.delete(sessionID)
    clearLanguageReminderState(sessionID)
  }

  function checkUserMessagesForSuspension(sessionID: string): boolean {
    const messages = userMessageHistory.get(sessionID)
    if (!messages || messages.length < userMessageLookback) return false
    const recent = messages.slice(-userMessageLookback)
    return recent.every(msg => isEnglishText(msg, userEnglishThreshold))
  }

  function recordUserMessage(sessionID: string, text: string): void {
    if (!userMessageHistory.has(sessionID)) {
      userMessageHistory.set(sessionID, [])
    }
    userMessageHistory.get(sessionID)!.push(text)
    if (userMessageHistory.get(sessionID)!.length > userMessageLookback * 2) {
      userMessageHistory.set(
        sessionID,
        userMessageHistory.get(sessionID)!.slice(-userMessageLookback)
      )
    }
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    const { sessionID } = input
    const state = getOrCreateState(sessionID)

    if (state.suspendedDueToUserEnglish) return

    state.toolCallCount++
    if (state.toolCallCount >= reminderInterval) {
      output.output += LANGUAGE_REMINDER_MESSAGE
      state.toolCallCount = 0
    }

    state.updatedAt = Date.now()
    saveLanguageReminderState(state)
  }

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        resetState(sessionInfo.id)
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        resetState(sessionID)
      }
    }

    if (event.type === "chat.message") {
      const message = props?.message as Record<string, any> | undefined
      const sessionID = props?.sessionID as string | undefined
      if (message?.role === "user" && sessionID) {
        const text = typeof message?.content === "string"
          ? message.content
          : (message?.parts as any[])?.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ") ?? ""
        recordUserMessage(sessionID, text)
        const state = getOrCreateState(sessionID)
        if (checkUserMessagesForSuspension(sessionID)) {
          state.suspendedDueToUserEnglish = true
          saveLanguageReminderState(state)
        }
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
