export interface PendingViolation {
  messageId: string
  violationCount: number
}

export interface ThinkingValidatorState {
  sessionID: string
  pendingViolation: PendingViolation | null
  updatedAt: number
}
