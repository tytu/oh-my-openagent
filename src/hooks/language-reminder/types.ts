export interface LanguageReminderState {
  sessionID: string
  toolCallCount: number
  suspendedDueToUserEnglish: boolean
  updatedAt: number
}
