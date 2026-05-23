/**
 * Retry/backoff 策略服务
 *
 * 提供纯函数式的重试决策计算，支持指数退避、Retry-After 和 Jitter。
 */

export interface RetryConfig {
  /** 最大重试次数 */
  max_attempts: number
  /** 初始延迟（毫秒） */
  initial_delay_ms: number
  /** 退避因子 */
  backoff_factor: number
  /** 最大延迟（毫秒） */
  max_delay_ms: number
  /** 是否启用 jitter */
  jitter: boolean
  /** 是否尊重 Retry-After 头 */
  respect_retry_after: boolean
}

export interface RetryDecision {
  /** 是否可重试 */
  retryable: boolean
  /** 延迟时间（毫秒） */
  delay_ms: number
  /** 当前尝试次数 */
  attempt: number
  /** 决策原因 */
  reason: string
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  max_attempts: 3,
  initial_delay_ms: 1000,
  backoff_factor: 2,
  max_delay_ms: 30000,
  jitter: true,
  respect_retry_after: true,
}

/**
 * 计算重试延迟
 *
 * @param attempt - 当前尝试次数（从 0 开始）
 * @param config - 重试配置
 * @param retryAfterMs - 可选的 Retry-After 值（毫秒）
 * @returns 重试决策
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig,
  retryAfterMs?: number,
): RetryDecision {
  // 检查是否超过最大重试次数
  if (attempt >= config.max_attempts) {
    return {
      retryable: false,
      delay_ms: 0,
      attempt,
      reason: `max attempts (${config.max_attempts}) reached`,
    }
  }

  // 计算指数退避延迟
  const exponentialDelay =
    config.initial_delay_ms * Math.pow(config.backoff_factor, attempt)

  // 决定基础延迟
  let baseDelay: number
  let reason: string

  // 检查是否使用 Retry-After
  if (
    config.respect_retry_after &&
    retryAfterMs !== undefined &&
    retryAfterMs > 0
  ) {
    baseDelay = retryAfterMs
    reason = "Retry-After"
  } else {
    baseDelay = exponentialDelay
    reason = "exponential backoff"
  }

  // 应用最大延迟限制
  baseDelay = Math.min(baseDelay, config.max_delay_ms)

  // 应用 jitter
  let finalDelay: number
  if (config.jitter) {
    // Jitter 范围: [0.5 * baseDelay, 1.5 * baseDelay]
    const jitterRange = baseDelay * 0.5
    finalDelay = baseDelay + (Math.random() * 2 - 1) * jitterRange
    // 确保不低于 0
    finalDelay = Math.max(0, finalDelay)
  } else {
    finalDelay = baseDelay
  }

  return {
    retryable: true,
    delay_ms: Math.round(finalDelay),
    attempt,
    reason,
  }
}
