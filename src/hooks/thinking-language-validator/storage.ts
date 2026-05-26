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
    return JSON.parse(content) as ThinkingValidatorState
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
