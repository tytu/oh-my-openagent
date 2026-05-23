/**
 * Runtime Fallback Hook
 *
 * 处理 session.error 事件中的 provider 错误（quota、rate_limit），
 * 在 retry 耗尽后自动切换到 fallback 模型。
 *
 * 不处理：context_overflow（由 context-window-recovery 处理）、auth、bad_request。
 * 避让 sessionRecovery（可恢复错误优先由 sessionRecovery 处理）。
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { classifyProviderError } from "../../shared/provider-error-classifier"
import { calculateRetryDelay, DEFAULT_RETRY_CONFIG } from "../../shared/retry-strategy"
import { resolveNextFallbackModel } from "../../shared/runtime-fallback"

export interface RuntimeFallbackOptions {
  sessionRecovery?: {
    isRecoverableError: (error: unknown) => boolean
  }
}

interface RetryState {
  attempt: number
  lastAttemptTime: number
}

export function createRuntimeFallbackHook(ctx: PluginInput, options?: RuntimeFallbackOptions) {
  // Session-scoped retry state
  const retryStates = new Map<string, RetryState>()

  const handler = async ({
    event,
  }: {
    event: { type: string; properties?: unknown }
  }): Promise<boolean> => {
    // Only handle session.error events
    if (event.type !== "session.error") return false

    const props = event.properties as Record<string, unknown> | undefined
    const sessionID = props?.sessionID as string | undefined
    const error = props?.error

    // Guard: require sessionID and error
    if (!sessionID || error === undefined || error === null) return false

    // 1. Defer to sessionRecovery if it can handle this error
    if (options?.sessionRecovery?.isRecoverableError(error)) {
      return false
    }

    // 2. Classify the error
    const classification = classifyProviderError(error)

    // 3. context_overflow → not handled (let context-window-recovery handle it)
    if (classification.category === "context_overflow") {
      return false
    }

    // 4. auth / bad_request → not handled
    if (classification.category === "auth" || classification.category === "bad_request") {
      return false
    }

    // 5. rate_limit → retry or fallback
    if (classification.category === "rate_limit") {
      const state = retryStates.get(sessionID) ?? { attempt: 0, lastAttemptTime: Date.now() }
      const decision = calculateRetryDelay(
        state.attempt,
        DEFAULT_RETRY_CONFIG,
        classification.retryAfterMs,
      )

      if (decision.retryable) {
        // Update retry state and wait
        retryStates.set(sessionID, {
          attempt: state.attempt + 1,
          lastAttemptTime: Date.now(),
        })
        // Wait for the retry delay
        await new Promise((resolve) => setTimeout(resolve, decision.delay_ms))
        return false // Not handled yet - will retry
      }

      // Retries exhausted → fall through to fallback
      retryStates.delete(sessionID)
    }

    // 6. Only handle quota and rate_limit (with exhausted retries)
    if (classification.category !== "quota" && classification.category !== "rate_limit") {
      return false
    }

    // 7. Fallback: get current model from session messages
    // Get current model from session messages
    let currentModel = { providerID: "", modelID: "" }
    try {
      const messagesResp = await ctx.client.session.messages({ path: { id: sessionID } })
      const messages = (messagesResp.data ?? []) as Array<{
        info?: { model?: { providerID: string; modelID: string }; modelID?: string; providerID?: string }
      }>
      for (let i = messages.length - 1; i >= 0; i--) {
        const info = messages[i].info
        const msgModel = info?.model
        if (msgModel?.providerID && msgModel?.modelID) {
          currentModel = { providerID: msgModel.providerID, modelID: msgModel.modelID }
          break
        }
        if (info?.providerID && info?.modelID) {
          currentModel = { providerID: info.providerID, modelID: info.modelID }
          break
        }
      }
    } catch {
      // If we can't get messages, use empty model (fallback chain will still work)
    }

    // 7. Resolve next fallback model
    const fallbackResult = resolveNextFallbackModel({
      currentModel,
      attempts: [],
      lastErrorClassification: classification,
    })

    if (fallbackResult.kind === "exhausted") {
      return false // No fallback available
    }

    // 8. Inject fallback via session.prompt
    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          model: fallbackResult.model,
          parts: [{ type: "text", text: "continue" }],
        },
        query: { directory: ctx.directory },
      })
      return true
    } catch {
      return false
    }
  }

  return { handler }
}
