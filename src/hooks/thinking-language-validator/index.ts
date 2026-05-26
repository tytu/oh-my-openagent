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
      const state: ThinkingValidatorState = {
        sessionID,
        notifiedFingerprints: [],
        lastCheckedTextLength: 0,
        pendingViolationFingerprint: null,
        updatedAt: Date.now(),
        ...persisted,
      }
      sessionStates.set(sessionID, state)
    }
    return sessionStates.get(sessionID)!
  }

  function resetState(sessionID: string): void {
    sessionStates.delete(sessionID)
    clearThinkingValidatorState(sessionID)
  }

  function computeFingerprint(text: string): string {
    const hasher = new Bun.CryptoHasher("sha256")
    hasher.update(text)
    return hasher.digest("hex").slice(0, 16)
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    const { sessionID } = input
    const state = getOrCreateState(sessionID)

    if (state.pendingViolationFingerprint) {
      output.output += THINKING_VIOLATION_REMINDER
      state.notifiedFingerprints.push(state.pendingViolationFingerprint)
      if (state.notifiedFingerprints.length > 100) {
        state.notifiedFingerprints.shift()
      }
      state.pendingViolationFingerprint = null
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

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (!sessionID || role !== "assistant") return

      const agent = info?.agent as string | undefined
      if (agent && excludedAgents.includes(agent.toLowerCase())) return

      const part = props?.part as Record<string, unknown> | undefined
      if (!part) return

      const partType = part.type as string
      if (partType !== "thinking" && partType !== "reasoning") return

      const thinkingText = ((part.thinking || part.text || "") as string).trim()
      if (!thinkingText || thinkingText.length < 20) return

      const state = getOrCreateState(sessionID)

      if (state.lastCheckedTextLength > 0 && thinkingText.length - state.lastCheckedTextLength < 100) {
        return
      }

      const isViolation = detectEnglishViolation(thinkingText, violationThreshold)
      if (isViolation) {
        const fingerprint = computeFingerprint(thinkingText)
        if (!state.notifiedFingerprints.includes(fingerprint)) {
          state.pendingViolationFingerprint = fingerprint
          state.lastCheckedTextLength = thinkingText.length
          state.updatedAt = Date.now()
          saveThinkingValidatorState(state)
        }
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
