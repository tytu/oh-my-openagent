/**
 * Provider Error Classifier
 *
 * 统一的 provider 错误分类逻辑，用于判断错误类型和是否可重试/fallback。
 * 支持 OpenAI、Anthropic、Gemini、xAI、Zhipu 等主流 provider。
 */

export type ErrorCategory =
  | "rate_limit"        // 可重试的速率限制
  | "quota"             // 额度/billing 问题，直接 fallback
  | "overloaded"        // 服务过载，可重试
  | "context_overflow"  // context 太长，不 fallback
  | "auth"              // 认证错误，不 fallback
  | "bad_request"       // 请求错误，不 fallback
  | "model_unavailable"
  | "provider_unavailable"
  | "unknown"           // 未知错误

export interface ProviderErrorClassification {
  category: ErrorCategory
  retryable: boolean
  shouldFallback: boolean
  statusCode?: number
  providerGuess?: string
  retryAfterMs?: number
  reason: string  // 用户可读的错误描述
}

/**
 * 从 unknown 类型的 error 中提取结构化信息
 */
function extractErrorInfo(error: unknown): {
  statusCode?: number
  code?: string | number
  type?: string
  message: string
  status?: string
  headers?: Record<string, string>
} {
  // 处理 string 类型
  if (typeof error === "string") {
    return { message: error }
  }

  // 处理 Error 实例
  if (error instanceof Error) {
    const anyErr = error as any
    return {
      statusCode: anyErr.status ?? anyErr.statusCode ?? anyErr.httpStatus,
      code: anyErr.code ?? anyErr.error?.code,
      type: anyErr.type ?? anyErr.error?.type,
      message: error.message,
      status: anyErr.status ?? anyErr.error?.status,
      headers: anyErr.headers,
    }
  }

  // 处理 object 类型
  if (typeof error === "object" && error !== null) {
    const obj = error as any
    const inner = obj.error ?? {}
    return {
      statusCode: obj.status ?? obj.statusCode ?? inner.status,
      code: inner.code ?? obj.code,
      type: inner.type ?? obj.type,
      message: inner.message ?? obj.message ?? String(error),
      status: inner.status ?? obj.status,
      headers: obj.headers,
    }
  }

  return { message: String(error) }
}

/**
 * 解析 Retry-After 相关 header，返回毫秒数
 */
function parseRetryAfterMs(headers?: Record<string, string>): number | undefined {
  if (!headers) return undefined

  // 标准 Retry-After header（秒数）
  const retryAfter = headers["retry-after"] ?? headers["Retry-After"]
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (!isNaN(seconds) && seconds > 0) {
      return seconds * 1000
    }
  }

  // x-ratelimit-reset header（Unix timestamp）
  const reset = headers["x-ratelimit-reset"] ?? headers["X-Ratelimit-Reset"]
  if (reset) {
    const resetTimestamp = Number(reset)
    if (!isNaN(resetTimestamp)) {
      // 如果是秒级 timestamp
      const resetMs = resetTimestamp > 1e12 ? resetTimestamp : resetTimestamp * 1000
      const delayMs = resetMs - Date.now()
      return delayMs > 0 ? delayMs : 0
    }
  }

  return undefined
}

/**
 * 检查是否为 context overflow 错误
 */
function isContextOverflow(message: string, code?: string | number): boolean {
  const lowerMessage = message.toLowerCase()
  return (
    lowerMessage.includes("context_length_exceeded") ||
    lowerMessage.includes("prompt is too long") ||
    lowerMessage.includes("maximum context length") ||
    code === "context_length_exceeded"
  )
}

/**
 * 检查 Zhipu/GLM 的 quota 相关错误码
 */
function isZhipuQuotaCode(code?: string | number): boolean {
  if (typeof code !== "number") return false
  // 1113: 欠费, 1304: 调用限额, 1308: 使用上限, 1309: 套餐到期
  return [1113, 1304, 1308, 1309].includes(code)
}

/**
 * 通用 quota 消息关键词检测（provider-agnostic）
 */
function isGenericQuotaMessage(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes("usage quota") ||
    m.includes("quota exceeded") ||
    m.includes("exceeded your quota") ||
    (m.includes("quota") && m.includes("exceeded")) ||
    m.includes("upgrade your plan")
  )
}

/**
 * 检查 Zhipu/GLM 的 rate limit 相关错误码
 */
function isZhipuRateLimitCode(code?: string | number): boolean {
  if (typeof code !== "number") return false
  // 1302: 并发, 1303: 频率
  return [1302, 1303].includes(code)
}

/**
 * 检查 Zhipu/GLM 的 overloaded 相关错误码
 */
function isZhipuOverloadedCode(code?: string | number): boolean {
  if (typeof code !== "number") return false
  // 1312: 负载过高
  return code === 1312
}

/**
 * 检查 Gemini 的 quota 细节
 */
function isGeminiQuotaDetails(details?: any[]): boolean {
  if (!Array.isArray(details)) return false
  return details.some(
    (d) =>
      d?.["@type"]?.includes("QuotaFailure") ||
      d?.["@type"]?.includes("google.rpc.QuotaFailure")
  )
}

/**
 * 检查 Gemini 的 per-minute 限制
 */
function isGeminiPerMinuteLimit(message: string, details?: any[]): boolean {
  const lowerMessage = message.toLowerCase()
  if (lowerMessage.includes("per_minute") || lowerMessage.includes("per minute")) {
    return true
  }
  if (Array.isArray(details)) {
    return details.some((d) => d?.["@type"]?.includes("RetryInfo"))
  }
  return false
}

/**
 * 分类 provider 错误
 *
 * @param error - 未知类型的错误对象
 * @returns 包含错误分类、可重试性、是否应该 fallback 等信息
 */
export function classifyProviderError(error: unknown): ProviderErrorClassification {
  const info = extractErrorInfo(error)
  const { statusCode, code, type, message, status, headers } = info

  // 1. Context overflow 检查（最高优先级）
  if (isContextOverflow(message, code)) {
    return {
      category: "context_overflow",
      retryable: false,
      shouldFallback: false,
      statusCode,
      reason: "Context length exceeded, prompt too long for model",
    }
  }

  // 2. Auth 错误检查
  if (statusCode === 401 || statusCode === 403) {
    return {
      category: "auth",
      retryable: false,
      shouldFallback: false,
      statusCode,
      reason: statusCode === 401 ? "Invalid API key or authentication" : "Permission denied",
    }
  }

  // 2.5. Provider/model unavailable 检查（在 bad_request 之前）
  const lowerMessage = message.toLowerCase()
  const isModelUnavailableMessage =
    lowerMessage.includes("model not found") ||
    lowerMessage.includes("model unavailable") ||
    lowerMessage.includes("unsupported model") ||
    lowerMessage.includes("invalid model") ||
    lowerMessage.includes("unknown model")
  const isProviderUnavailableMessage =
    lowerMessage.includes("provider not found") ||
    lowerMessage.includes("unknown provider") ||
    lowerMessage.includes("invalid provider")

  if (isProviderUnavailableMessage && (statusCode === 400 || statusCode === 404 || statusCode === 422)) {
    return {
      category: "provider_unavailable",
      retryable: false,
      shouldFallback: true,
      statusCode,
      reason: `Provider unavailable: ${message.substring(0, 100)}`,
    }
  }

  if (isModelUnavailableMessage && (statusCode === 400 || statusCode === 404 || statusCode === 422)) {
    return {
      category: "model_unavailable",
      retryable: false,
      shouldFallback: true,
      statusCode,
      reason: `Model unavailable: ${message.substring(0, 100)}`,
    }
  }

  if (statusCode === 404) {
    return {
      category: "model_unavailable",
      retryable: false,
      shouldFallback: true,
      statusCode,
      reason: `Model not found (404): ${message.substring(0, 100)}`,
    }
  }

  // 3. Bad request 检查
  if (statusCode === 400) {
    return {
      category: "bad_request",
      retryable: false,
      shouldFallback: false,
      statusCode,
      reason: "Invalid request parameters",
    }
  }

  // 4. Quota/Billing 错误检查（在 rate_limit 之前）
  // OpenAI insufficient_quota
  if (
    statusCode === 429 &&
    (code === "insufficient_quota" || type === "insufficient_quota")
  ) {
    return {
      category: "quota",
      retryable: false,
      shouldFallback: true,
      statusCode,
      providerGuess: "openai",
      reason: "OpenAI quota exceeded, billing issue",
    }
  }

  // Anthropic billing_error
  if (statusCode === 402 && type === "billing_error") {
    return {
      category: "quota",
      retryable: false,
      shouldFallback: true,
      statusCode,
      providerGuess: "anthropic",
      reason: "Anthropic billing error, payment required",
    }
  }

  // Gemini quota details
  if (statusCode === 429 && status === "RESOURCE_EXHAUSTED" && isGeminiQuotaDetails(info.headers ? undefined : (error as any)?.error?.details)) {
    return {
      category: "quota",
      retryable: false,
      shouldFallback: true,
      statusCode,
      providerGuess: "gemini",
      reason: "Gemini daily quota exceeded",
    }
  }

  // Zhipu/GLM quota 错误码
  if (statusCode === 429 && isZhipuQuotaCode(code)) {
    const quotaReasons: Record<number, string> = {
      1113: "账户欠费",
      1304: "调用次数超过限额",
      1308: "使用量超过上限",
      1309: "套餐已到期",
    }
    return {
      category: "quota",
      retryable: false,
      shouldFallback: true,
      statusCode,
      providerGuess: "zhipu",
      reason: `Zhipu/GLM: ${quotaReasons[code as number] ?? "quota exceeded"}`,
    }
  }

  // 5. Overloaded 错误检查（在 rate_limit 之前，因为部分 429 也是 overloaded）
  // Anthropic overloaded_error
  if (statusCode === 529 && type === "overloaded_error") {
    return {
      category: "overloaded",
      retryable: true,
      shouldFallback: false,
      statusCode,
      providerGuess: "anthropic",
      reason: "Anthropic API overloaded",
    }
  }

  // Zhipu/GLM overloaded 错误码（1312: 负载过高）
  if (statusCode === 429 && isZhipuOverloadedCode(code)) {
    return {
      category: "overloaded",
      retryable: true,
      shouldFallback: false,
      statusCode,
      providerGuess: "zhipu",
      reason: "Zhipu/GLM: 当前负载过高",
    }
  }

  // 6. Rate limit 错误检查
  // Anthropic rate_limit_error
  if (statusCode === 429 && type === "rate_limit_error") {
    return {
      category: "rate_limit",
      retryable: true,
      shouldFallback: false,
      statusCode,
      providerGuess: "anthropic",
      retryAfterMs: parseRetryAfterMs(headers),
      reason: "Anthropic rate limit exceeded",
    }
  }

  // OpenAI rate_limit_exceeded
  if (statusCode === 429 && code === "rate_limit_exceeded") {
    return {
      category: "rate_limit",
      retryable: true,
      shouldFallback: false,
      statusCode,
      providerGuess: "openai",
      retryAfterMs: parseRetryAfterMs(headers),
      reason: "OpenAI rate limit exceeded",
    }
  }

  // Gemini per-minute rate limit
  if (statusCode === 429 && status === "RESOURCE_EXHAUSTED" && isGeminiPerMinuteLimit(message, (error as any)?.error?.details)) {
    return {
      category: "rate_limit",
      retryable: true,
      shouldFallback: false,
      statusCode,
      providerGuess: "gemini",
      retryAfterMs: parseRetryAfterMs(headers),
      reason: "Gemini per-minute rate limit exceeded",
    }
  }

  // Zhipu/GLM rate limit 错误码（1302: 并发, 1303: 频率）
  if (statusCode === 429 && isZhipuRateLimitCode(code)) {
    const rateLimitReasons: Record<number, string> = {
      1302: "并发请求超过限制",
      1303: "请求频率超过限制",
    }
    return {
      category: "rate_limit",
      retryable: true,
      shouldFallback: false,
      statusCode,
      providerGuess: "zhipu",
      retryAfterMs: parseRetryAfterMs(headers),
      reason: `Zhipu/GLM: ${rateLimitReasons[code as number] ?? "rate limit exceeded"}`,
    }
  }

  // xAI/Grok generic 429 — quota 消息优先
  if (statusCode === 429) {
    if (isGenericQuotaMessage(message)) {
      return {
        category: "quota",
        retryable: false,
        shouldFallback: true,
        statusCode,
        reason: `Quota exceeded: ${message.substring(0, 100)}`,
      }
    }
    return {
      category: "rate_limit",
      retryable: true,
      shouldFallback: false,
      statusCode,
      retryAfterMs: parseRetryAfterMs(headers),
      reason: "Rate limit exceeded (generic 429)",
    }
  }

  // 6.5. 通用 quota 消息检测（无 statusCode 时兜底）
  if (isGenericQuotaMessage(message)) {
    return {
      category: "quota",
      retryable: false,
      shouldFallback: true,
      statusCode,
      reason: `Quota exceeded: ${message.substring(0, 100)}`,
    }
  }

  // 7. Unknown 错误
  return {
    category: "unknown",
    retryable: false,
    shouldFallback: false,
    statusCode,
    reason: `Unknown error: ${message.substring(0, 100)}`,
  }
}
