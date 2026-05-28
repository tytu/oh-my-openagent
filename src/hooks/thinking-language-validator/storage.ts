import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs"
import { join } from "node:path"
import { THINKING_VALIDATOR_STORAGE } from "./constants"
import type { ThinkingValidatorState } from "./types"

function getStoragePath(sessionID: string): string {
  return join(THINKING_VALIDATOR_STORAGE, `${sessionID}.json`)
}

export function loadThinkingValidatorState(sessionID: string): ThinkingValidatorState | null {
  const filePath = getStoragePath(sessionID)
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content) as Record<string, unknown>

    const state: ThinkingValidatorState = {
      sessionID: (parsed.sessionID as string) ?? sessionID,
      notifiedFingerprints: Array.isArray(parsed.notifiedFingerprints) ? parsed.notifiedFingerprints.slice(0, 100) : [],
      lastCheckedTextLength: typeof parsed.lastCheckedTextLength === "number" ? parsed.lastCheckedTextLength : 0,
      pendingViolationFingerprint: typeof parsed.pendingViolationFingerprint === "string" ? parsed.pendingViolationFingerprint : null,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      totalDetectionCount: typeof parsed.totalDetectionCount === "number" ? parsed.totalDetectionCount : 0,
      triggerWordHitCount: typeof parsed.triggerWordHitCount === "number" ? parsed.triggerWordHitCount : 0,
      asciiRatioHitCount: typeof parsed.asciiRatioHitCount === "number" ? parsed.asciiRatioHitCount : 0,
      dedupSkipCount: typeof parsed.dedupSkipCount === "number" ? parsed.dedupSkipCount : 0,
      throttleSkipCount: typeof parsed.throttleSkipCount === "number" ? parsed.throttleSkipCount : 0,
      reminderInjectedCount: typeof parsed.reminderInjectedCount === "number" ? parsed.reminderInjectedCount : 0,
    }

    return state
  } catch {
    return null
  }
}

export function saveThinkingValidatorState(state: ThinkingValidatorState): void {
  if (!existsSync(THINKING_VALIDATOR_STORAGE)) {
    mkdirSync(THINKING_VALIDATOR_STORAGE, { recursive: true })
  }
  const filePath = getStoragePath(state.sessionID)
  writeFileSync(filePath, JSON.stringify(state, null, 2))
}

export function clearThinkingValidatorState(sessionID: string): void {
  const filePath = getStoragePath(sessionID)
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}
