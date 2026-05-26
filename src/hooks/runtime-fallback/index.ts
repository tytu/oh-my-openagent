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
import { classifyProviderError, classifyTextMessage } from "../../shared/provider-error-classifier"
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

interface ModelHealthEntry {
  lastErrorTime: number
  errorCount: number
  lastCategory: string
  sessions: Set<string>
}

const REGISTRY_TTL = 60 * 60 * 1000 // 1 hour
const MAX_ERROR_COUNT = 5

export function createRuntimeFallbackHook(ctx: PluginInput, options?: RuntimeFallbackOptions) {
  const retryStates = new Map<string, RetryState>()
  const fallbackAttempts = new Map<string, FallbackAttempt[]>()
  const interruptingSessions = new Map<string, boolean>()
  const modelHealthRegistry = new Map<string, ModelHealthEntry>()
  const config = options?.config ?? {
    enabled: true,
    max_attempts: 6,
    max_retries_before_fallback: 2,
    initial_delay_ms: DEFAULT_RETRY_CONFIG.initial_delay_ms,
    backoff_factor: DEFAULT_RETRY_CONFIG.backoff_factor,
    max_delay_ms: DEFAULT_RETRY_CONFIG.max_delay_ms,
    respect_retry_after: DEFAULT_RETRY_CONFIG.respect_retry_after,
    jitter: DEFAULT_RETRY_CONFIG.jitter,
  }

  function registerModelError(providerID: string, modelID: string, category: string, sessionID: string) {
    const key = `${providerID}/${modelID}`
    const now = Date.now()
    const existing = modelHealthRegistry.get(key)
    if (existing) {
      existing.lastErrorTime = now
      existing.errorCount++
      existing.lastCategory = category
      existing.sessions.add(sessionID)
    } else {
      if (modelHealthRegistry.size >= 100) {
        const oldestKey = modelHealthRegistry.keys().next().value
        if (oldestKey) modelHealthRegistry.delete(oldestKey)
      }
      modelHealthRegistry.set(key, {
        lastErrorTime: now,
        errorCount: 1,
        lastCategory: category,
        sessions: new Set([sessionID]),
      })
    }
  }

  function checkModelHealth(providerID: string, modelID: string): ModelHealthEntry | undefined {
    const key = `${providerID}/${modelID}`
    const entry = modelHealthRegistry.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.lastErrorTime > REGISTRY_TTL) {
      modelHealthRegistry.delete(key)
      return undefined
    }
    return entry
  }

  function isModelHealthy(providerID: string, modelID: string): boolean {
    const entry = checkModelHealth(providerID, modelID)
    if (!entry) return true
    return entry.errorCount < MAX_ERROR_COUNT
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
        interruptingSessions.delete(sessionID)
        // cleanup compound keys (sessionID:retryAttempt)
        for (const [key] of interruptingSessions) {
          if (key.startsWith(`${sessionID}:`)) {
            interruptingSessions.delete(key)
          }
        }
        for (const [key, entry] of modelHealthRegistry) {
          entry.sessions.delete(sessionID)
          if (entry.sessions.size === 0 && Date.now() - entry.lastErrorTime > REGISTRY_TTL) {
            modelHealthRegistry.delete(key)
          }
        }
      }
      return false
    }

    // handle session.error, message.updated, message.part.updated (RetryPart), session.status (retry)
    if (event.type !== "session.error" && event.type !== "message.updated" && event.type !== "message.part.updated" && event.type !== "session.status") return false

    const props = event.properties as Record<string, unknown> | undefined
    let sessionID: string | undefined
    let error: unknown
    let retryAttempt: number | undefined

    if (event.type === "session.status") {
      const status = props?.status as { type?: string; message?: string; attempt?: number } | undefined
      if (status?.type !== "retry") return false
      sessionID = props?.sessionID as string | undefined
      error = status.message ? { name: "RetryMessage", message: status.message } : undefined
      retryAttempt = status.attempt
    } else if (event.type === "session.error") {
      sessionID = props?.sessionID as string | undefined
      error = props?.error
    } else if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      sessionID = info?.sessionID as string | undefined
      error = info?.error
    } else {
      // message.part.updated: check for RetryPart
      const part = props?.part as Record<string, unknown> | undefined
      if (part?.type !== "retry") return false
      const retryPart = part as { type: "retry"; attempt: number; error: unknown; sessionID?: string }
      sessionID = retryPart.sessionID ?? props?.sessionID as string | undefined
      error = retryPart.error
      retryAttempt = retryPart.attempt
    }

    // Guard: require sessionID and error
    if (!sessionID || error === undefined || error === null) return false

    // 1. Defer to sessionRecovery if it can handle this error
    if (options?.sessionRecovery?.isRecoverableError(error)) {
      return false
    }

    // 2. Classify the error
    const classification = (error as { name?: string })?.name === "RetryMessage"
      ? classifyTextMessage((error as { message: string }).message)
      : classifyProviderError(error)

    log("[runtime-fallback] DEBUG error classified", {
      category: classification.category,
      shouldFallback: classification.shouldFallback,
      errorType: typeof error,
      errorKeys: error && typeof error === "object" ? Object.keys(error as object) : [],
      messageSnippet: classification.reason?.substring(0, 100),
      sessionID,
      eventType: event.type,
      retryAttempt,
    })

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
      // If this is a RetryPart, use OpenCode's attempt count directly
      const effectiveAttempt = retryAttempt ?? retryStates.get(sessionID)?.attempt ?? 0

      if (retryAttempt !== undefined) {
        // RetryPart: OpenCode is already retrying, check threshold
        if (effectiveAttempt >= config.max_retries_before_fallback) {
          retryStates.delete(sessionID)
          // fall through to fallback
        } else {
          return false // let OpenCode continue retrying
        }
      } else {
        // session.error / message.updated: use internal retry counter
        const state = retryStates.get(sessionID) ?? { attempt: 0, lastAttemptTime: Date.now() }
        const decision = calculateRetryDelay(
          state.attempt,
          config,
          classification.retryAfterMs,
        )

        if (decision.retryable && state.attempt < config.max_retries_before_fallback) {
          retryStates.set(sessionID, {
            attempt: state.attempt + 1,
            lastAttemptTime: Date.now(),
          })
          await new Promise((resolve) => setTimeout(resolve, decision.delay_ms))
          return false
        }

        retryStates.delete(sessionID)
      }
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

    if (currentModel.providerID && currentModel.modelID && sessionID) {
      registerModelError(currentModel.providerID, currentModel.modelID, classification.category, sessionID)
    }

    agent ??= "sisyphus"
    let attempts = fallbackAttempts.get(sessionID) ?? []

    // Record current model as a failed attempt so the chain never goes back to it
    if (currentModel.providerID && currentModel.modelID) {
      const currentKey = `${currentModel.providerID}/${currentModel.modelID}`
      if (!attempts.some(a => `${a.model.providerID}/${a.model.modelID}` === currentKey)) {
        attempts = [...attempts, { model: currentModel, error: classification }]
        fallbackAttempts.set(sessionID, attempts)
      }
    }

    const fallbackResult = resolveNextFallbackModel({
      agent,
      category,
      currentModel,
      attempts,
      configuredFallbackModels: options?.getConfiguredFallbackModels?.(agent, category),
      maxAttempts: config.max_attempts,
      lastErrorClassification: classification,
    })

    log("[runtime-fallback] fallback resolution result", {
      kind: fallbackResult.kind,
      sessionID,
      attemptsCount: attempts.length,
      nextModel: fallbackResult.kind === "next"
        ? `${fallbackResult.model.providerID}/${fallbackResult.model.modelID}`
        : "N/A",
      exhaustedReason: fallbackResult.kind !== "next" ? fallbackResult.reason : undefined,
    })

    if (fallbackResult.kind !== "next") {
      if (retryAttempt !== undefined) {
        try {
          await ctx.client.session.abort({ path: { id: sessionID } })
          log("[runtime-fallback] aborted retry loop (fallback exhausted)", { sessionID })
        } catch (abortErr) {
          log("[runtime-fallback] abort failed during exhausted handling", {
            sessionID, error: String(abortErr),
          })
        }
      }
      log("[runtime-fallback] fallback chain exhausted", {
        sessionID, eventType: event.type,
        attemptsCount: attempts.length,
        reason: fallbackResult.kind === "exhausted" ? fallbackResult.reason : "unconfigured",
      })
      return false
    }

    if (!isModelHealthy(fallbackResult.model.providerID, fallbackResult.model.modelID)) {
      log("[runtime-fallback] fallback model unhealthy, skipping", {
        modelKey: `${fallbackResult.model.providerID}/${fallbackResult.model.modelID}`,
        sessionID,
      })
      return false
    }

    // For retry-related events: abort the ongoing retry loop first
    const needsRetryAbort = retryAttempt !== undefined
    const guardKey = needsRetryAbort ? `${sessionID}:${retryAttempt}` : null
    if (needsRetryAbort) {
      if (guardKey && interruptingSessions.get(guardKey)) {
        log("[runtime-fallback] re-entry guard: interrupting session, skipping", {
          sessionID,
          retryAttempt,
          guardKey,
        })
        return false
      }
      if (guardKey) interruptingSessions.set(guardKey, true)
      try {
        await ctx.client.session.abort({ path: { id: sessionID } })
        log("[runtime-fallback] aborted retry loop", { sessionID, retryAttempt })
      } catch (abortErr) {
        log("[runtime-fallback] abort failed, falling through to direct prompt", {
          sessionID,
          error: String(abortErr),
        })
      }
    }

    // Record the fallback model attempt BEFORE prompt so chain advances even if model also fails
    const promptAttempts = [...attempts, { model: fallbackResult.model }]
    fallbackAttempts.set(sessionID, promptAttempts)

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
      // 不清空 fallbackAttempts：session.prompt 成功只表示消息被队列，
      // 异步模型调用可能仍然失败。清空会导致下次 retry 重复尝试同一模型，造成无限循环。
      return true
    } catch (fallbackError) {
      const currentAttempts = fallbackAttempts.get(sessionID) ?? []
      const lastAttempt = currentAttempts[currentAttempts.length - 1]
      const fallbackErrorClass = classifyProviderError(fallbackError)

      log("[runtime-fallback] fallback prompt failed", {
        sessionID,
        errorCategory: fallbackErrorClass.category,
        errorMessage: String(fallbackError).substring(0, 200),
        fallbackModel: `${fallbackResult.model.providerID}/${fallbackResult.model.modelID}`,
      })

      if (lastAttempt && !lastAttempt.error) {
        lastAttempt.error = fallbackErrorClass
      }
      // Register the fallback model's error only after it actually fails
      if (sessionID) {
        registerModelError(
          fallbackResult.model.providerID,
          fallbackResult.model.modelID,
          fallbackErrorClass.category,
          sessionID,
        )
      }
      // 即使 prompt 失败也返回 true：已经 aborted retry，
      // 返回 false 会让 OpenCode 继续 native retry，导致用户看到 "retrying in 53m 1s"
      return true
    } finally {
      if (needsRetryAbort && guardKey) {
        interruptingSessions.delete(guardKey)
      }
    }
  }

  return { handler, checkModelHealth }
}
