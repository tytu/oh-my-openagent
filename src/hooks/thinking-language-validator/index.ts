import type { PluginInput } from "@opencode-ai/plugin"
import { detectEnglishViolation } from "./detector"
import {
  loadThinkingValidatorState,
  saveThinkingValidatorState,
  clearThinkingValidatorState,
} from "./storage"
import { THINKING_VIOLATION_REMINDER } from "./constants"
import type { ThinkingValidatorState } from "./types"
import { agentNameMatches } from "../../shared/agent-display-names"

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
        totalDetectionCount: 0,
        triggerWordHitCount: 0,
        asciiRatioHitCount: 0,
        dedupSkipCount: 0,
        throttleSkipCount: 0,
        reminderInjectedCount: 0,
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
      state.reminderInjectedCount++
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
      if (agent && excludedAgents.some((a) => agentNameMatches(agent, a))) return

      const part = props?.part as Record<string, unknown> | undefined
      if (!part) return

      const partType = part.type as string
      if (partType !== "thinking" && partType !== "reasoning") return

      const thinkingText = ((part.thinking || part.text || "") as string).trim()
      if (!thinkingText || thinkingText.length < 4) return

      const state = getOrCreateState(sessionID)

      if (state.lastCheckedTextLength > 0 && thinkingText.length - state.lastCheckedTextLength < 100) {
        state.throttleSkipCount++
        saveThinkingValidatorState(state)
        return
      }

      const isViolation = detectEnglishViolation(thinkingText, violationThreshold)
      if (isViolation) {
        state.totalDetectionCount++
        if (isViolation === 'trigger') {
          state.triggerWordHitCount++
        } else {
          state.asciiRatioHitCount++
        }

        const fingerprint = computeFingerprint(thinkingText)
        if (!state.notifiedFingerprints.includes(fingerprint)) {
          state.pendingViolationFingerprint = fingerprint
          state.lastCheckedTextLength = thinkingText.length
          state.updatedAt = Date.now()
          saveThinkingValidatorState(state)
        } else {
          state.dedupSkipCount++
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
