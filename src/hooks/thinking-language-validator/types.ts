export interface ThinkingValidatorState {
  sessionID: string
  notifiedFingerprints: string[]
  lastCheckedTextLength: number
  pendingViolationFingerprint: string | null
  updatedAt: number
  totalDetectionCount: number
  triggerWordHitCount: number
  asciiRatioHitCount: number
  dedupSkipCount: number
  throttleSkipCount: number
  reminderInjectedCount: number
}
