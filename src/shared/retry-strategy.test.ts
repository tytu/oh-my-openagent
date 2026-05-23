import { describe, test, expect } from "bun:test"
import {
  calculateRetryDelay,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
  type RetryDecision,
} from "./retry-strategy"

describe("retry-strategy", () => {
  describe("calculateRetryDelay", () => {
    describe("指数退避计算", () => {
      test("#given 第1次重试 #when 计算延迟 #then delay = initial_delay_ms", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }

        // #when
        const result = calculateRetryDelay(0, config)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.delay_ms).toBe(1000)
        expect(result.attempt).toBe(0)
      })

      test("#given 第2次重试 #when 计算延迟 #then delay = initial_delay_ms * backoff_factor", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }

        // #when
        const result = calculateRetryDelay(1, config)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.delay_ms).toBe(2000)
        expect(result.attempt).toBe(1)
      })

      test("#given 第3次重试 #when 计算延迟 #then delay = initial_delay_ms * backoff_factor^2", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }

        // #when
        const result = calculateRetryDelay(2, config)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.delay_ms).toBe(4000)
        expect(result.attempt).toBe(2)
      })

      test("#given 计算结果超过 max_delay_ms #when 计算延迟 #then delay 不超过 max_delay_ms", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 10,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 5000,
          jitter: false,
          respect_retry_after: true,
        }

        // #when
        const result = calculateRetryDelay(5, config)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.delay_ms).toBe(5000)
        expect(result.attempt).toBe(5)
      })
    })

    describe("Retry-After 优先级", () => {
      test("#given 有效 Retry-After（秒）#when respect_retry_after=true #then 优先使用 Retry-After", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }
        const retryAfterMs = 5000

        // #when
        const result = calculateRetryDelay(0, config, retryAfterMs)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.delay_ms).toBe(5000)
        expect(result.attempt).toBe(0)
        expect(result.reason).toContain("Retry-After")
      })

      test("#given 无效 Retry-After（负数）#when 计算延迟 #then 回退到指数退避", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }
        const retryAfterMs = -1000

        // #when
        const result = calculateRetryDelay(0, config, retryAfterMs)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.delay_ms).toBe(1000)
        expect(result.attempt).toBe(0)
        expect(result.reason).toContain("exponential")
      })

      test("#given Retry-After 超过 max_delay_ms #when 计算延迟 #then 使用 max_delay_ms", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 5000,
          jitter: false,
          respect_retry_after: true,
        }
        const retryAfterMs = 60000

        // #when
        const result = calculateRetryDelay(0, config, retryAfterMs)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.delay_ms).toBe(5000)
        expect(result.attempt).toBe(0)
        expect(result.reason).toContain("Retry-After")
      })

      test("#given respect_retry_after=false #when 有 Retry-After #then 忽略 Retry-After 使用指数退避", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: false,
        }
        const retryAfterMs = 5000

        // #when
        const result = calculateRetryDelay(0, config, retryAfterMs)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.delay_ms).toBe(1000)
        expect(result.attempt).toBe(0)
        expect(result.reason).toContain("exponential")
      })
    })

    describe("Jitter", () => {
      test("#given jitter=true #when 计算延迟 #then delay 在 [0.5*delay, 1.5*delay] 范围内", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: true,
          respect_retry_after: true,
        }

        // #when - 运行多次验证范围
        for (let i = 0; i < 100; i++) {
          const result = calculateRetryDelay(0, config)

          // #then
          expect(result.retryable).toBe(true)
          expect(result.delay_ms).toBeGreaterThanOrEqual(500)
          expect(result.delay_ms).toBeLessThanOrEqual(1500)
        }
      })

      test("#given jitter=false #when 计算延迟 #then delay 精确等于计算值", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }

        // #when
        const result = calculateRetryDelay(1, config)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.delay_ms).toBe(2000)
      })
    })

    describe("最大重试次数", () => {
      test("#given attempt < max_attempts #when 计算重试 #then retryable=true", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 3,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }

        // #when
        const result = calculateRetryDelay(2, config)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.attempt).toBe(2)
      })

      test("#given attempt >= max_attempts #when 计算重试 #then retryable=false", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 3,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }

        // #when
        const result = calculateRetryDelay(3, config)

        // #then
        expect(result.retryable).toBe(false)
        expect(result.delay_ms).toBe(0)
        expect(result.attempt).toBe(3)
        expect(result.reason).toContain("max attempts")
      })
    })

    describe("边界情况", () => {
      test("#given max_attempts=0 #when 计算重试 #then 永远不重试", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 0,
          initial_delay_ms: 1000,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }

        // #when
        const result = calculateRetryDelay(0, config)

        // #then
        expect(result.retryable).toBe(false)
        expect(result.delay_ms).toBe(0)
        expect(result.reason).toContain("max attempts")
      })

      test("#given initial_delay_ms=0 #when 计算延迟 #then delay=0", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 0,
          backoff_factor: 2,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }

        // #when
        const result = calculateRetryDelay(0, config)

        // #then
        expect(result.retryable).toBe(true)
        expect(result.delay_ms).toBe(0)
      })

      test("#given backoff_factor=1 #when 计算延迟 #then delay 不变", () => {
        // #given
        const config: RetryConfig = {
          max_attempts: 5,
          initial_delay_ms: 1000,
          backoff_factor: 1,
          max_delay_ms: 30000,
          jitter: false,
          respect_retry_after: true,
        }

        // #when
        const result1 = calculateRetryDelay(0, config)
        const result2 = calculateRetryDelay(1, config)
        const result3 = calculateRetryDelay(2, config)

        // #then
        expect(result1.delay_ms).toBe(1000)
        expect(result2.delay_ms).toBe(1000)
        expect(result3.delay_ms).toBe(1000)
      })
    })
  })

  describe("DEFAULT_RETRY_CONFIG", () => {
    test("#given 默认配置 #when 检查值 #then 包含合理的默认值", () => {
      // #then
      expect(DEFAULT_RETRY_CONFIG.max_attempts).toBeGreaterThan(0)
      expect(DEFAULT_RETRY_CONFIG.initial_delay_ms).toBeGreaterThan(0)
      expect(DEFAULT_RETRY_CONFIG.backoff_factor).toBeGreaterThanOrEqual(1)
      expect(DEFAULT_RETRY_CONFIG.max_delay_ms).toBeGreaterThan(0)
      expect(typeof DEFAULT_RETRY_CONFIG.jitter).toBe("boolean")
      expect(typeof DEFAULT_RETRY_CONFIG.respect_retry_after).toBe("boolean")
    })
  })
})
