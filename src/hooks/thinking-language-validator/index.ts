import type { PluginInput } from "@opencode-ai/plugin"
import { detectEnglishViolation } from "./detector"
import {
  loadThinkingValidatorState,
  saveThinkingValidatorState,
  clearThinkingValidatorState,
} from "./storage"
import { THINKING_VIOLATION_REMINDER } from "./constants"
import type { ThinkingValidatorState } from "./types"

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

export function createThinkingLanguageValidatorHook(ctx: PluginInput) {
  const sessionStates = new Map<string, ThinkingValidatorState>()

  const config = (ctx as any).config as Record<string, any> | undefined
  const le = config?.language_enforcement as Record<string, any> | undefined
  const violationThreshold = le?.violation_threshold ?? 0.6
  const excludedAgents: string[] = le?.excluded_agents ?? ["librarian", "multimodal-looker"]

  function getOrCreateState(sessionID: string): ThinkingValidatorState {
    if (!sessionStates.has(sessionID)) {
      const persisted = loadThinkingValidatorState(sessionID)
      const state: ThinkingValidatorState = persisted ?? {
        sessionID,
        pendingViolation: null,
        updatedAt: Date.now(),
      }
      sessionStates.set(sessionID, state)
    }
    return sessionStates.get(sessionID)!
  }

  function resetState(sessionID: string): void {
    sessionStates.delete(sessionID)
    clearThinkingValidatorState(sessionID)
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    const { sessionID } = input
    const state = getOrCreateState(sessionID)

    if (state.pendingViolation && state.pendingViolation.violationCount === 0) {
      output.output += THINKING_VIOLATION_REMINDER
      state.pendingViolation.violationCount = 1
      state.updatedAt = Date.now()
      saveThinkingValidatorState(state)
    }
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

    if (event.type === "message.updated") {
      const message = props?.message as Record<string, any> | undefined
      const sessionID = props?.sessionID as string | undefined
      if (!message || !sessionID) return

      const agent = message.agent as string | undefined
      if (agent && excludedAgents.includes(agent.toLowerCase())) return

      const parts = message.parts as any[] | undefined
      if (!parts || parts.length === 0) return

      for (const part of parts) {
        const type = part.type as string
        if (type === "thinking" || type === "reasoning") {
          const thinkingText = (part.thinking || part.text || "") as string
          if (thinkingText && detectEnglishViolation(thinkingText, violationThreshold)) {
            const state = getOrCreateState(sessionID)
            state.pendingViolation = { messageId: message.id, violationCount: 0 }
            state.updatedAt = Date.now()
            saveThinkingValidatorState(state)
          }
        }
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
