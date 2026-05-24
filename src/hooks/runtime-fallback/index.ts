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
import type { RuntimeFallbackConfig } from "../../config/schema"
import { classifyProviderError } from "../../shared/provider-error-classifier"
import { calculateRetryDelay, DEFAULT_RETRY_CONFIG } from "../../shared/retry-strategy"
import { log } from "../../shared/logger"
import { resolveNextFallbackModel, type FallbackAttempt, type FallbackModel } from "../../shared/runtime-fallback"

export interface RuntimeFallbackOptions {
  config?: RuntimeFallbackConfig
  sessionRecovery?: {
    isRecoverableError: (error: unknown) => boolean
  }
  getConfiguredFallbackModels?: (agent?: string, category?: string) => FallbackModel[] | undefined
}

interface RetryState {
  attempt: number
  lastAttemptTime: number
}

export function createRuntimeFallbackHook(ctx: PluginInput, options?: RuntimeFallbackOptions) {
  const retryStates = new Map<string, RetryState>()
  const fallbackAttempts = new Map<string, FallbackAttempt[]>()
  const config = options?.config ?? {
    enabled: true,
    max_attempts: 3,
    max_retries_before_fallback: 2,
    initial_delay_ms: DEFAULT_RETRY_CONFIG.initial_delay_ms,
    backoff_factor: DEFAULT_RETRY_CONFIG.backoff_factor,
    max_delay_ms: DEFAULT_RETRY_CONFIG.max_delay_ms,
    respect_retry_after: DEFAULT_RETRY_CONFIG.respect_retry_after,
    jitter: DEFAULT_RETRY_CONFIG.jitter,
  }

  const handler = async ({
    event,
  }: {
    event: { type: string; properties?: unknown }
  }): Promise<boolean> => {
    if (!config.enabled) return false

    if (event.type === "session.deleted") {
      const props = event.properties as Record<string, unknown> | undefined
      const info = props?.info as { id?: string } | undefined
      const sessionID = info?.id ?? props?.sessionID as string | undefined
      if (sessionID) {
        retryStates.delete(sessionID)
        fallbackAttempts.delete(sessionID)
      }
      return false
    }

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
        config,
        classification.retryAfterMs,
      )

      if (decision.retryable && state.attempt < config.max_retries_before_fallback) {
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

    let currentModel = { providerID: "", modelID: "" }
    let agent = props?.agent as string | undefined
    const category = props?.category as string | undefined
    try {
      const messagesResp = await ctx.client.session.messages?.({ path: { id: sessionID } })
      const messages = (messagesResp?.data ?? []) as Array<{
        info?: { agent?: string; model?: { providerID: string; modelID: string }; modelID?: string; providerID?: string }
      }>
      for (let i = messages.length - 1; i >= 0; i--) {
        const info = messages[i].info
        if (!agent && info?.agent) agent = info.agent
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
    } catch (messageReadError) {
      log("[runtime-fallback] failed to read session messages", { sessionID, error: String(messageReadError) })
    }

    agent ??= "sisyphus"
    const attempts = fallbackAttempts.get(sessionID) ?? []
    const fallbackResult = resolveNextFallbackModel({
      agent,
      category,
      currentModel,
      attempts,
      configuredFallbackModels: options?.getConfiguredFallbackModels?.(agent, category),
      maxAttempts: config.max_attempts,
      lastErrorClassification: classification,
    })

    if (fallbackResult.kind !== "next") {
      return false
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
      fallbackAttempts.delete(sessionID)
      return true
    } catch (fallbackError) {
      fallbackAttempts.set(sessionID, [
        ...attempts,
        { model: fallbackResult.model, error: classifyProviderError(fallbackError) },
      ])
      return false
    }
  }

  return { handler }
}
