import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs"
import { join } from "node:path"
import { LANGUAGE_REMINDER_STORAGE } from "./constants"
import type { LanguageReminderState } from "./types"

function getStoragePath(sessionID: string): string {
  return join(LANGUAGE_REMINDER_STORAGE, `${sessionID}.json`)
}

export function loadLanguageReminderState(sessionID: string): LanguageReminderState | null {
  const filePath = getStoragePath(sessionID)
  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as LanguageReminderState
  } catch {
    return null
  }
}

export function saveLanguageReminderState(state: LanguageReminderState): void {
  if (!existsSync(LANGUAGE_REMINDER_STORAGE)) {
    mkdirSync(LANGUAGE_REMINDER_STORAGE, { recursive: true })
  }

  const filePath = getStoragePath(state.sessionID)
  writeFileSync(filePath, JSON.stringify(state, null, 2))
}

export function clearLanguageReminderState(sessionID: string): void {
  const filePath = getStoragePath(sessionID)
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}
