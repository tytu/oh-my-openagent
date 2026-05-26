export interface ThinkingValidatorState {
  sessionID: string
  notifiedFingerprints: string[]
  lastCheckedTextLength: number
  pendingViolationFingerprint: string | null
  updatedAt: number
}
