import { describe, expect, test } from "bun:test"
import { classifyProviderError } from "./provider-error-classifier"
import type { ErrorCategory, ProviderErrorClassification } from "./provider-error-classifier"

describe("classifyProviderError", () => {
  describe("OpenAI errors", () => {
    test("HTTP 429 + rate_limit_exceeded → retryable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          code: "rate_limit_exceeded",
          message: "Rate limit reached",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryable).toBe(true)
      expect(result.shouldFallback).toBe(false)
      expect(result.statusCode).toBe(429)
    })

    test("HTTP 429 + insufficient_quota code → quota fallbackable, not retryable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          code: "insufficient_quota",
          message: "You exceeded your current quota",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("HTTP 429 + insufficient_quota type → quota fallbackable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          type: "insufficient_quota",
          message: "Insufficient quota",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })
  })

  describe("Anthropic errors", () => {
    test("HTTP 429 + rate_limit_error → retryable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          type: "rate_limit_error",
          message: "Rate limit exceeded",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryable).toBe(true)
      expect(result.shouldFallback).toBe(false)
    })

    test("HTTP 402 + billing_error → billing fallbackable", () => {
      // #given
      const error = {
        status: 402,
        error: {
          type: "billing_error",
          message: "Payment required",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("HTTP 529 + overloaded_error → retryable", () => {
      // #given
      const error = {
        status: 529,
        error: {
          type: "overloaded_error",
          message: "API is currently overloaded",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("overloaded")
      expect(result.retryable).toBe(true)
      expect(result.shouldFallback).toBe(false)
    })
  })

  describe("Gemini errors", () => {
    test("HTTP 429 + RESOURCE_EXHAUSTED + per-minute details → retryable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          status: "RESOURCE_EXHAUSTED",
          message: "Quota exceeded for quota metric per_minute",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "30s",
            },
          ],
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryable).toBe(true)
      expect(result.shouldFallback).toBe(false)
    })

    test("HTTP 429 + RESOURCE_EXHAUSTED + quota details → quota fallbackable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          status: "RESOURCE_EXHAUSTED",
          message: "Quota exceeded for quota metric per_day",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [],
            },
          ],
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })
  })

  describe("xAI/Grok errors", () => {
    test("HTTP 429 → retryable", () => {
      // #given
      const error = {
        status: 429,
        message: "Rate limit exceeded",
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryable).toBe(true)
      expect(result.shouldFallback).toBe(false)
    })
  })

  describe("Zhipu/GLM errors", () => {
    test("HTTP 429 + error code 1302 (concurrency) → retryable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          code: 1302,
          message: "并发请求超过限制",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryable).toBe(true)
      expect(result.shouldFallback).toBe(false)
    })

    test("HTTP 429 + error code 1303 (frequency) → retryable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          code: 1303,
          message: "请求频率超过限制",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryable).toBe(true)
      expect(result.shouldFallback).toBe(false)
    })

    test("HTTP 429 + error code 1312 (load) → retryable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          code: 1312,
          message: "当前负载过高",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("overloaded")
      expect(result.retryable).toBe(true)
      expect(result.shouldFallback).toBe(false)
    })

    test("HTTP 429 + error code 1113 (arrears) → quota fallbackable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          code: 1113,
          message: "账户欠费",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("HTTP 429 + error code 1304 (call limit) → quota fallbackable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          code: 1304,
          message: "调用次数超过限额",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("HTTP 429 + error code 1308 (usage limit) → quota fallbackable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          code: 1308,
          message: "使用量超过上限",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("HTTP 429 + error code 1309 (package expired) → quota fallbackable", () => {
      // #given
      const error = {
        status: 429,
        error: {
          code: 1309,
          message: "套餐已到期",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })
  })

  describe("Generic quota message detection", () => {
    test("pure string 'You have exceeded the 5-hour usage quota' → quota fallbackable", () => {
      // #given
      const error = "You have exceeded the 5-hour usage quota. It will reset at 2026-05-24 22:01:42 +0800 CST."

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("object with message 'usage quota exceeded for plan' → quota fallbackable", () => {
      // #given
      const error = {
        message: "usage quota exceeded for plan",
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("object with status 429 and '5-hour usage quota exceeded' → quota (message wins over 429)", () => {
      // #given
      const error = {
        status: 429,
        message: "5-hour usage quota exceeded",
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("non-quota message 'rate limit exceeded, retry' → not quota", () => {
      // #given
      const error = {
        status: 429,
        message: "rate limit exceeded, retry after 30s",
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).not.toBe("quota")
    })
  })

  describe("Context overflow errors", () => {
    test("context_length_exceeded → context_overflow, not fallbackable", () => {
      // #given
      const error = {
        error: {
          message: "This model's maximum context length is 128000 tokens",
          code: "context_length_exceeded",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("context_overflow")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(false)
    })

    test("prompt is too long → context_overflow", () => {
      // #given
      const error = {
        error: {
          message: "prompt is too long: 200000 tokens > 128000 maximum",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("context_overflow")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(false)
    })
  })

  describe("Provider and model unavailable errors", () => {
    test("HTTP 400 invalid model → model_unavailable fallbackable", () => {
      // #given
      const error = {
        status: 400,
        error: {
          message: "invalid model: invalid-provider/invalid-model",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("model_unavailable")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("HTTP 404 model not found → model_unavailable fallbackable", () => {
      // #given
      const error = {
        status: 404,
        error: {
          message: "model not found: claude-nope",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("model_unavailable")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("HTTP 422 unsupported model → model_unavailable fallbackable", () => {
      // #given
      const error = {
        status: 422,
        error: {
          message: "unsupported model for this provider",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("model_unavailable")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("HTTP 400 invalid provider → provider_unavailable fallbackable", () => {
      // #given
      const error = {
        status: 400,
        error: {
          message: "unknown provider: invalid-provider",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("provider_unavailable")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })
  })

  describe("Non-recoverable errors", () => {
    test("HTTP 401 → auth error, not fallbackable", () => {
      // #given
      const error = {
        status: 401,
        error: {
          message: "Invalid API key",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("auth")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(false)
    })

    test("HTTP 403 → auth error, not fallbackable", () => {
      // #given
      const error = {
        status: 403,
        error: {
          message: "Permission denied",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("auth")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(false)
    })

    test("HTTP 400 → bad request, not fallbackable", () => {
      // #given
      const error = {
        status: 400,
        error: {
          message: "Invalid request body",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("bad_request")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(false)
    })
  })

  describe("Input format handling", () => {
    test("handles Error instance", () => {
      // #given
      const error = new Error("Rate limit exceeded")
      ;(error as any).status = 429

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryable).toBe(true)
    })

    test("handles string error", () => {
      // #given
      const error = "context_length_exceeded: prompt too long"

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("context_overflow")
      expect(result.retryable).toBe(false)
    })

    test("handles unknown error gracefully", () => {
      // #given
      const error = { some: "random", data: true }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("unknown")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(false)
    })
  })

  describe("Retry-After parsing", () => {
    test("parses Retry-After header in seconds", () => {
      // #given
      const error = {
        status: 429,
        headers: {
          "retry-after": "30",
        },
        error: {
          message: "Rate limit exceeded",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.retryAfterMs).toBe(30000)
    })

    test("parses x-ratelimit-reset header", () => {
      // #given
      const resetTime = Math.floor(Date.now() / 1000) + 60
      const error = {
        status: 429,
        headers: {
          "x-ratelimit-reset": String(resetTime),
        },
        error: {
          message: "Rate limit exceeded",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.retryAfterMs).toBeGreaterThan(0)
      expect(result.retryAfterMs).toBeLessThanOrEqual(60000)
    })
  })

  describe("OpenCode SDK ApiError", () => {
    test("data.message weekly usage limit reached → quota fallbackable", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          message: "weekly usage limit reached. It will reset in 9 hours 24 minutes. To continue using this model now, enable usage from your available balance",
          statusCode: 429,
          isRetryable: false,
          responseHeaders: {},
          responseBody: "",
          metadata: {},
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("data.message reason does not stringify payload as [object Object]", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          message: "weekly usage limit reached. It will reset in 9 hours 24 minutes. To continue using this model now, enable usage from your available balance",
          statusCode: 429,
          isRetryable: false,
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.reason).not.toContain("[object Object]")
    })

    test("data.statusCode is extracted into result.statusCode", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          message: "weekly usage limit reached. It will reset in 9 hours 24 minutes. To continue using this model now, enable usage from your available balance",
          statusCode: 429,
          isRetryable: false,
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.statusCode).toBe(429)
    })

    test("data.responseHeaders Retry-After is parsed for rate limits", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          message: "Rate limit exceeded",
          statusCode: 429,
          isRetryable: true,
          responseHeaders: {
            "retry-after": "30",
          },
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryAfterMs).toBe(30000)
    })

    test("data.responseBody JSON error message is used when data.message is missing", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          statusCode: 429,
          isRetryable: false,
          responseBody: JSON.stringify({
            error: {
              message: "weekly usage limit reached",
            },
          }),
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
    })

    test("invalid data.responseBody JSON does not throw and falls back safely", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          statusCode: 429,
          isRetryable: false,
          responseBody: "{not json",
        },
      }

      // #when
      const classify = () => classifyProviderError(error)
      const result = classifyProviderError(error)

      // #then
      expect(classify).not.toThrow()
      expect(["unknown", "quota", "rate_limit"]).toContain(result.category)
    })

    test("legacy object message weekly usage limit reached remains quota", () => {
      // #given
      const error = {
        message: "weekly usage limit reached",
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
    })

    test("legacy nested error message weekly usage limit reached remains quota", () => {
      // #given
      const error = {
        error: {
          message: "weekly usage limit reached",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
    })
  })

  describe("Usage limit quota messages", () => {
    test("weekly usage limit reached → quota", () => {
      // #given
      const error = "weekly usage limit reached. It will reset in 9 hours 54 minutes. To continue using this model now, enable usage from your available balance - https://opencode.ai/workspace/wrk_01KS08BB9W6ZEQC6701PHAJWT6/settings"

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("available balance message → quota", () => {
      // #given
      const error = "To continue using this model now, enable usage from your available balance"

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("daily usage limit reached → quota", () => {
      // #given
      const error = "daily usage limit reached"

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("monthly usage limit reached → quota", () => {
      // #given
      const error = "monthly usage limit reached"

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("429 + rate_limit_error + weekly usage limit → quota (not rate_limit)", () => {
      // #given - Anthropic 风格，message 语义优先于 type
      const error = {
        status: 429,
        error: {
          type: "rate_limit_error",
          message: "weekly usage limit reached. It will reset in 9 hours 54 minutes.",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("429 + generic quota message → quota", () => {
      // #given - xAI/Grok 风格
      const error = {
        status: 429,
        message: "usage limit reached. enable usage from your available balance",
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
    })

    test("429 + rate_limit_exceeded → rate_limit (not quota)", () => {
      // #given - 普通短期限流，不应误判为 quota
      const error = {
        status: 429,
        error: {
          code: "rate_limit_exceeded",
          message: "Rate limit reached",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryable).toBe(true)
      expect(result.shouldFallback).toBe(false)
    })

    test("too many requests → rate_limit (not quota)", () => {
      // #given - 普通短期限流
      const error = {
        status: 429,
        message: "too many requests, please retry later",
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryable).toBe(true)
      expect(result.shouldFallback).toBe(false)
    })

    test("context length exceeded → unknown (not quota)", () => {
      // #given - context overflow，不应误判为 quota
      const error = "context length exceeded, prompt too long"

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).not.toBe("quota")
    })

    test("maximum tokens exceeded → unknown (not quota)", () => {
      // #given - token limit，不应误判为 quota
      const error = "maximum tokens exceeded for this request"

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).not.toBe("quota")
    })
  })

  describe("OpenCode SDK ApiError", () => {
    test("ApiError.data.message with weekly usage limit → quota", () => {
      // #given - OpenCode SDK ApiError v1/v2 形态
      const error = {
        name: "APIError",
        data: {
          message: "weekly usage limit reached. It will reset in 9 hours 24 minutes. To continue using this model now, enable usage from your available balance",
          statusCode: 429,
          isRetryable: false,
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.retryable).toBe(false)
      expect(result.shouldFallback).toBe(true)
      expect(result.statusCode).toBe(429)
    })

    test("ApiError reason does not contain [object Object]", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          message: "weekly usage limit reached. It will reset in 9 hours 24 minutes.",
          statusCode: 429,
          isRetryable: false,
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.reason).not.toContain("[object Object]")
      expect(result.reason).toContain("weekly usage limit")
    })

    test("ApiError.data.statusCode extracted correctly", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          message: "quota exceeded",
          statusCode: 429,
          isRetryable: false,
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.statusCode).toBe(429)
    })

    test("ApiError.data.responseHeaders used for retryAfterMs", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          message: "Rate limit exceeded",
          statusCode: 429,
          isRetryable: true,
          responseHeaders: {
            "retry-after": "30",
          },
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("rate_limit")
      expect(result.retryAfterMs).toBe(30000)
    })

    test("ApiError.data.responseBody JSON fallback extracts message", () => {
      // #given - data.message 缺失，从 responseBody 提取
      const error = {
        name: "APIError",
        data: {
          statusCode: 429,
          isRetryable: false,
          responseBody: JSON.stringify({
            error: {
              message: "weekly usage limit reached. It will reset in 9 hours.",
            },
          }),
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
    })

    test("ApiError.data.responseBody with top-level message", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          statusCode: 429,
          isRetryable: false,
          responseBody: JSON.stringify({
            message: "usage limit reached",
          }),
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
    })

    test("ApiError.data.responseBody invalid JSON does not throw", () => {
      // #given
      const error = {
        name: "APIError",
        data: {
          statusCode: 500,
          isRetryable: false,
          responseBody: "not valid json {{{",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then - 不抛异常，安全降级
      expect(result.category).toBe("unknown")
      expect(result.shouldFallback).toBe(false)
    })

    test("ApiError v2 with metadata field does not break extraction", () => {
      // #given - v2 新增 metadata 字段
      const error = {
        name: "APIError",
        data: {
          message: "weekly usage limit reached",
          statusCode: 429,
          isRetryable: false,
          metadata: {
            requestId: "abc123",
          },
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
      expect(result.statusCode).toBe(429)
    })

    test("existing { message } object still works", () => {
      // #given - 旧形态回归
      const error = {
        message: "weekly usage limit reached",
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
    })

    test("existing { error: { message } } object still works", () => {
      // #given - 旧形态回归
      const error = {
        error: {
          message: "weekly usage limit reached",
        },
      }

      // #when
      const result = classifyProviderError(error)

      // #then
      expect(result.category).toBe("quota")
    })
  })
})
