import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { ProviderErrorClassification } from "../../shared/provider-error-classifier"
import type { RetryDecision } from "../../shared/retry-strategy"
import type { FallbackResult } from "../../shared/runtime-fallback"

// ── Mock shared modules ──────────────────────────────────────────────
const mockClassifyProviderError = mock(
  (_error: unknown): ProviderErrorClassification => ({
    category: "unknown",
    retryable: false,
    shouldFallback: false,
    reason: "test",
  }),
)

const mockClassifyTextMessage = mock(
  (_message: string): ProviderErrorClassification => ({
    category: "unknown",
    retryable: false,
    shouldFallback: false,
    reason: "test",
  }),
)

const mockCalculateRetryDelay = mock(
  (_attempt: number, _config?: unknown, _retryAfterMs?: number): RetryDecision => ({
    retryable: true,
    delay_ms: 1000,
    attempt: 0,
    reason: "test",
  }),
)

const mockResolveNextFallbackModel = mock(
  (_input: unknown): FallbackResult => ({
    kind: "next",
    model: { providerID: "openai", modelID: "gpt-4o" },
    attempts: [],
  }),
)

mock.module("../../shared/provider-error-classifier", () => ({
  classifyProviderError: mockClassifyProviderError,
  classifyTextMessage: mockClassifyTextMessage,
}))

mock.module("../../shared/retry-strategy", () => ({
  calculateRetryDelay: mockCalculateRetryDelay,
  DEFAULT_RETRY_CONFIG: {
    max_attempts: 3,
    initial_delay_ms: 1000,
    backoff_factor: 2,
    max_delay_ms: 30000,
    jitter: true,
    respect_retry_after: true,
  },
}))

mock.module("../../shared/runtime-fallback", () => ({
  resolveNextFallbackModel: mockResolveNextFallbackModel,
}))

// Import after mocks are set up
import { createRuntimeFallbackHook } from "./index"

// ── Helpers ──────────────────────────────────────────────────────────
function createMockCtx() {
  return {
    client: {
      session: {
        prompt: mock(() => Promise.resolve({})),
        abort: mock(() => Promise.resolve(true)),
        messages: mock(() => Promise.resolve({ data: [] })),
      },
    },
    directory: "/test",
  } as any
}

function createSessionErrorEvent(
  sessionID: string,
  error: unknown,
): { type: string; properties: Record<string, unknown> } {
  return {
    type: "session.error",
    properties: { sessionID, error },
  }
}

function createRetryPartEvent(
  sessionID: string,
  error: unknown,
  attempt: number,
): { type: string; properties: Record<string, unknown> } {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        type: "retry",
        attempt,
        error,
        sessionID,
      },
    },
  }
}

function createSessionStatusEvent(
  sessionID: string,
  statusType: string,
  message?: string,
  attempt?: number,
): { type: string; properties: Record<string, unknown> } {
  return {
    type: "session.status",
    properties: {
      sessionID,
      status: {
        type: statusType,
        message,
        attempt,
      },
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────────
describe("runtime-fallback", () => {
  beforeEach(() => {
    mockClassifyProviderError.mockClear()
    mockClassifyTextMessage.mockClear()
    mockCalculateRetryDelay.mockClear()
    mockResolveNextFallbackModel.mockClear()
  })

  describe("Configuration", () => {
    test("enabled=false returns false without fallback", async () => {
      // #given
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx, { config: { enabled: false, max_attempts: 3, max_retries_before_fallback: 2, initial_delay_ms: 0, backoff_factor: 2, max_delay_ms: 0, respect_retry_after: true, jitter: false } })
      const event = createSessionErrorEvent("ses_123", { status: 402 })

      // #when
      const result = await hook.handler({ event })

      // #then
      expect(result).toBe(false)
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
      expect(mockResolveNextFallbackModel).not.toHaveBeenCalled()
    })

    test("passes configured fallback models and maxAttempts to resolver", async () => {
      // #given
      const ctx = createMockCtx()
      const configuredFallbackModels = [{ providerID: "volcengine", modelID: "deepseek-v4-flash" }]
      const hook = createRuntimeFallbackHook(ctx, {
        config: { enabled: true, max_attempts: 1, max_retries_before_fallback: 2, initial_delay_ms: 0, backoff_factor: 2, max_delay_ms: 0, respect_retry_after: true, jitter: false },
        getConfiguredFallbackModels: () => configuredFallbackModels,
      })
      mockClassifyProviderError.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "quota",
      })
      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: configuredFallbackModels[0],
        attempts: [],
      })
      const event = createSessionErrorEvent("ses_123", { status: 402 })

      // #when
      await hook.handler({ event })

      // #then
      expect(mockResolveNextFallbackModel).toHaveBeenCalledWith(expect.objectContaining({
        agent: "sisyphus",
        configuredFallbackModels,
        maxAttempts: 1,
      }))
    })
  })

  describe("Fallback 触发", () => {
    // #given 402 quota error
    // #when handler processes the event
    // #then should call session.prompt with fallback model
    test("402/quota error triggers fallback and calls session.prompt", async () => {
      // Arrange
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        statusCode: 402,
        providerGuess: "anthropic",
        reason: "Anthropic billing error",
      })

      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })

      const event = createSessionErrorEvent("ses_123", {
        status: 402,
        type: "billing_error",
      })

      // Act
      const result = await hook.handler({ event })

      // Assert
      expect(result).toBe(true)
      expect(mockClassifyProviderError).toHaveBeenCalledWith(event.properties.error)
      expect(mockResolveNextFallbackModel).toHaveBeenCalled()
      expect(ctx.client.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: "ses_123" },
          body: expect.objectContaining({
            model: { providerID: "openai", modelID: "gpt-4o" },
          }),
        }),
      )
    })

    // #given quota error with exhausted fallback chain
    // #when handler processes the event
    // #then should not call session.prompt
    test("quota error with exhausted fallback does not call session.prompt", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        statusCode: 402,
        reason: "billing error",
      })

      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "exhausted",
        attempts: [],
        reason: "No fallback candidates available",
      })

      const event = createSessionErrorEvent("ses_123", { status: 402 })
      const result = await hook.handler({ event })

      expect(result).toBe(false)
      expect(ctx.client.session.prompt).not.toHaveBeenCalled()
    })
  })

  describe("Retry 逻辑", () => {
    // #given 429 rate_limit error with retries remaining
    // #when handler processes the event
    // #then should not fallback (retry instead)
    test("429 rate_limit with retries remaining does not fallback", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValue({
        category: "rate_limit",
        retryable: true,
        shouldFallback: false,
        statusCode: 429,
        reason: "rate limit exceeded",
      })

      // First attempt - retries remaining
      mockCalculateRetryDelay.mockReturnValueOnce({
        retryable: true,
        delay_ms: 1000,
        attempt: 0,
        reason: "exponential backoff",
      })

      const event = createSessionErrorEvent("ses_123", { status: 429 })
      const result = await hook.handler({ event })

      expect(result).toBe(false) // Not handled - will retry
      expect(mockResolveNextFallbackModel).not.toHaveBeenCalled()
      expect(ctx.client.session.prompt).not.toHaveBeenCalled()
    })

    // #given 429 rate_limit error with retries exhausted
    // #when handler processes the event
    // #then should trigger fallback
    test("429 rate_limit with retries exhausted triggers fallback", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValue({
        category: "rate_limit",
        retryable: true,
        shouldFallback: false,
        statusCode: 429,
        reason: "rate limit exceeded",
      })

      // Exhaust retries: call handler 3 times (max_attempts)
      mockCalculateRetryDelay
        .mockReturnValueOnce({ retryable: true, delay_ms: 1000, attempt: 0, reason: "backoff" })
        .mockReturnValueOnce({ retryable: true, delay_ms: 2000, attempt: 1, reason: "backoff" })
        .mockReturnValueOnce({ retryable: false, delay_ms: 0, attempt: 2, reason: "max attempts reached" })

      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "google", modelID: "gemini-3-flash" },
        attempts: [],
      })

      const event = createSessionErrorEvent("ses_123", { status: 429 })

      // First two calls - retries
      await hook.handler({ event })
      await hook.handler({ event })

      // Third call - retries exhausted, should fallback
      const result = await hook.handler({ event })

      expect(result).toBe(true)
      expect(mockResolveNextFallbackModel).toHaveBeenCalled()
      expect(ctx.client.session.prompt).toHaveBeenCalled()
    })
  })

  describe("max_retries_before_fallback", () => {
    // #given rate_limit error with max_retries_before_fallback=2
    // #when 3rd attempt arrives
    // #then should skip retry and fallback directly
    test("max_retries_before_fallback=2 triggers fallback after 2 retries", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx, {
        config: {
          enabled: true,
          max_attempts: 5,
          max_retries_before_fallback: 2,
          initial_delay_ms: 0,
          backoff_factor: 2,
          max_delay_ms: 0,
          respect_retry_after: true,
          jitter: false,
        },
      })

      mockClassifyProviderError.mockReturnValue({
        category: "rate_limit",
        retryable: true,
        shouldFallback: false,
        statusCode: 429,
        reason: "rate limit exceeded",
      })

      mockCalculateRetryDelay.mockReturnValue({
        retryable: true,
        delay_ms: 0,
        attempt: 0,
        reason: "backoff",
      })

      mockResolveNextFallbackModel.mockReturnValue({
        kind: "next",
        model: { providerID: "google", modelID: "gemini-3-flash" },
        attempts: [],
      })

      const event = createSessionErrorEvent("ses_123", { status: 429 })

      // First two calls - retries (attempt 0 and 1 < max_retries_before_fallback=2)
      await hook.handler({ event })
      await hook.handler({ event })

      // Third call - attempt=2, should skip retry and fallback
      const result = await hook.handler({ event })

      expect(result).toBe(true)
      expect(mockResolveNextFallbackModel).toHaveBeenCalled()
      expect(ctx.client.session.prompt).toHaveBeenCalled()
    })

    // #given rate_limit error with max_retries_before_fallback=0
    // #when first attempt arrives
    // #then should fallback immediately without retry
    test("max_retries_before_fallback=0 triggers fallback immediately", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx, {
        config: {
          enabled: true,
          max_attempts: 3,
          max_retries_before_fallback: 0,
          initial_delay_ms: 0,
          backoff_factor: 2,
          max_delay_ms: 0,
          respect_retry_after: true,
          jitter: false,
        },
      })

      mockClassifyProviderError.mockReturnValue({
        category: "rate_limit",
        retryable: true,
        shouldFallback: false,
        statusCode: 429,
        reason: "rate limit exceeded",
      })

      mockResolveNextFallbackModel.mockReturnValue({
        kind: "next",
        model: { providerID: "google", modelID: "gemini-3-flash" },
        attempts: [],
      })

      const event = createSessionErrorEvent("ses_123", { status: 429 })

      // First call - attempt=0, should skip retry and fallback immediately
      const result = await hook.handler({ event })

      expect(result).toBe(true)
      expect(mockResolveNextFallbackModel).toHaveBeenCalled()
      expect(ctx.client.session.prompt).toHaveBeenCalled()
    })

    // #given rate_limit error without max_retries_before_fallback config
    // #when attempts arrive
    // #then should use default value 2
    test("max_retries_before_fallback defaults to 2", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValue({
        category: "rate_limit",
        retryable: true,
        shouldFallback: false,
        statusCode: 429,
        reason: "rate limit exceeded",
      })

      mockCalculateRetryDelay.mockReturnValue({
        retryable: true,
        delay_ms: 0,
        attempt: 0,
        reason: "backoff",
      })

      mockResolveNextFallbackModel.mockReturnValue({
        kind: "next",
        model: { providerID: "google", modelID: "gemini-3-flash" },
        attempts: [],
      })

      const event = createSessionErrorEvent("ses_123", { status: 429 })

      // First two calls - retries (attempt 0 and 1 < default 2)
      await hook.handler({ event })
      await hook.handler({ event })

      // Third call - attempt=2, should fallback
      const result = await hook.handler({ event })

      expect(result).toBe(true)
      expect(mockResolveNextFallbackModel).toHaveBeenCalled()
    })
  })

  describe("Context overflow 不处理", () => {
    // #given context_overflow error
    // #when handler processes the event
    // #then should return false (not handled)
    test("context_overflow error returns false", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValueOnce({
        category: "context_overflow",
        retryable: false,
        shouldFallback: false,
        reason: "Context length exceeded",
      })

      const event = createSessionErrorEvent("ses_123", {
        message: "context_length_exceeded",
      })

      const result = await hook.handler({ event })

      expect(result).toBe(false)
      expect(mockResolveNextFallbackModel).not.toHaveBeenCalled()
      expect(ctx.client.session.prompt).not.toHaveBeenCalled()
    })
  })

  describe("SessionRecovery 协调", () => {
    // #given sessionRecovery that can handle the error
    // #when handler processes the event
    // #then should return false (defer to sessionRecovery)
    test("defers to sessionRecovery when isRecoverableError returns true", async () => {
      const ctx = createMockCtx()
      const sessionRecovery = {
        isRecoverableError: mock(() => true),
      }
      const hook = createRuntimeFallbackHook(ctx, { sessionRecovery })

      const event = createSessionErrorEvent("ses_123", {
        message: "tool_use and tool_result mismatch",
      })

      const result = await hook.handler({ event })

      expect(result).toBe(false)
      expect(sessionRecovery.isRecoverableError).toHaveBeenCalledWith(event.properties.error)
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
      expect(ctx.client.session.prompt).not.toHaveBeenCalled()
    })

    // #given sessionRecovery that cannot handle the error
    // #when handler processes the event with quota error
    // #then should handle the error (fallback)
    test("handles error when sessionRecovery cannot recover", async () => {
      const ctx = createMockCtx()
      const sessionRecovery = {
        isRecoverableError: mock(() => false),
      }
      const hook = createRuntimeFallbackHook(ctx, { sessionRecovery })

      mockClassifyProviderError.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        statusCode: 402,
        reason: "billing error",
      })

      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })

      const event = createSessionErrorEvent("ses_123", { status: 402 })
      const result = await hook.handler({ event })

      expect(result).toBe(true)
      expect(mockClassifyProviderError).toHaveBeenCalled()
    })
  })

  describe("Error 输入格式", () => {
    // #given various error input types
    // #when handler processes each
    // #then should not throw for any format
    test("handles string error without throwing", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValueOnce({
        category: "unknown",
        retryable: false,
        shouldFallback: false,
        reason: "Unknown error",
      })

      const event = createSessionErrorEvent("ses_123", "simple string error")

      await expect(hook.handler({ event })).resolves.toBe(false)
    })

    test("handles Error instance without throwing", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValueOnce({
        category: "unknown",
        retryable: false,
        shouldFallback: false,
        reason: "Unknown error",
      })

      const event = createSessionErrorEvent("ses_123", new Error("test error"))

      await expect(hook.handler({ event })).resolves.toBe(false)
    })

    test("handles object error without throwing", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValueOnce({
        category: "unknown",
        retryable: false,
        shouldFallback: false,
        reason: "Unknown error",
      })

      const event = createSessionErrorEvent("ses_123", {
        status: 500,
        message: "internal server error",
      })

      await expect(hook.handler({ event })).resolves.toBe(false)
    })

    test("handles null/undefined error without throwing", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      const eventWithNull = createSessionErrorEvent("ses_123", null)
      const eventWithUndefined = createSessionErrorEvent("ses_123", undefined)

      await expect(hook.handler({ event: eventWithNull })).resolves.toBe(false)
      await expect(hook.handler({ event: eventWithUndefined })).resolves.toBe(false)
    })

    test("handles unknown type error without throwing", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValueOnce({
        category: "unknown",
        retryable: false,
        shouldFallback: false,
        reason: "Unknown error",
      })

      const event = createSessionErrorEvent("ses_123", 42)

      await expect(hook.handler({ event })).resolves.toBe(false)
    })
  })

  describe("不处理的错误类别", () => {
    // #given auth error
    // #when handler processes the event
    // #then should return false
    test("auth error returns false", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValueOnce({
        category: "auth",
        retryable: false,
        shouldFallback: false,
        statusCode: 401,
        reason: "Invalid API key",
      })

      const event = createSessionErrorEvent("ses_123", { status: 401 })
      const result = await hook.handler({ event })

      expect(result).toBe(false)
      expect(mockResolveNextFallbackModel).not.toHaveBeenCalled()
    })

    // #given bad_request error
    // #when handler processes the event
    // #then should return false
    test("bad_request error returns false", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      mockClassifyProviderError.mockReturnValueOnce({
        category: "bad_request",
        retryable: false,
        shouldFallback: false,
        statusCode: 400,
        reason: "Invalid request",
      })

      const event = createSessionErrorEvent("ses_123", { status: 400 })
      const result = await hook.handler({ event })

      expect(result).toBe(false)
      expect(mockResolveNextFallbackModel).not.toHaveBeenCalled()
    })
  })

  describe("非 session.error 事件", () => {
    // #given message.updated event without info.error
    // #when handler processes the event
    // #then should return false (guard clause catches missing sessionID/error)
    test("message.updated with missing info.error returns false", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      const event = { type: "message.updated", properties: {} }
      const result = await hook.handler({ event })

      expect(result).toBe(false)
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
    })

    // #given completely unknown event type (e.g. "custom.event")
    // #when handler processes the event
    // #then should return false without calling classifier
    test("unknown event type returns false without calling classifier", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      const event = { type: "custom.event", properties: {} }
      const result = await hook.handler({ event })

      expect(result).toBe(false)
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
    })
  })

  describe("RetryPart 事件处理", () => {
    // #given RetryPart with quota error and attempt >= max_retries_before_fallback
    // #when handler processes the event
    // #then should abort session and call session.prompt with fallback model
    test("RetryPart quota error triggers abort and fallback when threshold met", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx, {
        config: {
          enabled: true,
          max_attempts: 3,
          max_retries_before_fallback: 2,
          initial_delay_ms: 0,
          backoff_factor: 2,
          max_delay_ms: 0,
          respect_retry_after: true,
          jitter: false,
        },
      })

      mockClassifyProviderError.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "You have exceeded the 5-hour usage quota",
      })

      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })

      const event = createRetryPartEvent("ses_123", { message: "quota exceeded" }, 2)
      const result = await hook.handler({ event })

      expect(result).toBe(true)
      expect(ctx.client.session.abort).toHaveBeenCalledWith({ path: { id: "ses_123" } })
      expect(ctx.client.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: "ses_123" },
          body: expect.objectContaining({
            model: { providerID: "openai", modelID: "gpt-4o" },
          }),
        }),
      )
    })

    // #given RetryPart with quota error
    // #when handler processes the event
    // #then should abort and fallback immediately (quota = immediate fallback, no threshold check)
    test("RetryPart quota error triggers abort and fallback immediately", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx, {
        config: {
          enabled: true,
          max_attempts: 3,
          max_retries_before_fallback: 2,
          initial_delay_ms: 0,
          backoff_factor: 2,
          max_delay_ms: 0,
          respect_retry_after: true,
          jitter: false,
        },
      })

      mockClassifyProviderError.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "You have exceeded the 5-hour usage quota",
      })

      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })

      const event = createRetryPartEvent("ses_123", { message: "quota exceeded" }, 0)
      const result = await hook.handler({ event })

      expect(result).toBe(true)
      expect(ctx.client.session.abort).toHaveBeenCalledWith({ path: { id: "ses_123" } })
      expect(ctx.client.session.prompt).toHaveBeenCalled()
    })

    // #given RetryPart with rate_limit error and attempt >= max_retries_before_fallback
    // #when handler processes the event
    // #then should abort and fallback
    test("RetryPart rate_limit triggers fallback after threshold exceeded", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx, {
        config: {
          enabled: true,
          max_attempts: 5,
          max_retries_before_fallback: 2,
          initial_delay_ms: 0,
          backoff_factor: 2,
          max_delay_ms: 0,
          respect_retry_after: true,
          jitter: false,
        },
      })

      mockClassifyProviderError.mockReturnValueOnce({
        category: "rate_limit",
        retryable: true,
        shouldFallback: false,
        statusCode: 429,
        reason: "rate limit exceeded",
      })

      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "google", modelID: "gemini-3-flash" },
        attempts: [],
      })

      const event = createRetryPartEvent("ses_123", { status: 429 }, 2)
      const result = await hook.handler({ event })

      expect(result).toBe(true)
      expect(ctx.client.session.abort).toHaveBeenCalledWith({ path: { id: "ses_123" } })
      expect(ctx.client.session.prompt).toHaveBeenCalled()
    })

    // #given message.part.updated with non-retry part type
    // #when handler processes the event
    // #then should return false (not a RetryPart)
    test("message.part.updated with non-retry part type is ignored", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      const event = {
        type: "message.part.updated",
        properties: {
          part: { type: "text", text: "hello" },
        },
      }
      const result = await hook.handler({ event })

      expect(result).toBe(false)
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
      expect(ctx.client.session.abort).not.toHaveBeenCalled()
    })

    // #given RetryPart triggers fallback but abort fails
    // #when handler processes the event
    // #then should fall through to direct prompt anyway
    test("RetryPart falls through to direct prompt when abort fails", async () => {
      const ctx = createMockCtx()
      ctx.client.session.abort = mock(() => Promise.reject(new Error("abort failed")))
      const hook = createRuntimeFallbackHook(ctx, {
        config: {
          enabled: true,
          max_attempts: 3,
          max_retries_before_fallback: 2,
          initial_delay_ms: 0,
          backoff_factor: 2,
          max_delay_ms: 0,
          respect_retry_after: true,
          jitter: false,
        },
      })

      mockClassifyProviderError.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "You have exceeded the 5-hour usage quota",
      })

      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })

      const event = createRetryPartEvent("ses_123", { message: "quota exceeded" }, 2)
      const result = await hook.handler({ event })

      // Abort failed, but prompt should still be attempted
      expect(ctx.client.session.abort).toHaveBeenCalled()
      expect(ctx.client.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: "ses_123" },
          body: expect.objectContaining({
            model: { providerID: "openai", modelID: "gpt-4o" },
          }),
        }),
      )
    })

    // #given RetryPart with re-entrant call for same session
    // #when handler processes two concurrent RetryParts for same session
    // #then second call should return false (re-entry guard)
    test("RetryPart re-entrant call for same session returns false", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx, {
        config: {
          enabled: true,
          max_attempts: 3,
          max_retries_before_fallback: 2,
          initial_delay_ms: 0,
          backoff_factor: 2,
          max_delay_ms: 0,
          respect_retry_after: true,
          jitter: false,
        },
      })

      mockClassifyProviderError.mockReturnValue({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "You have exceeded the 5-hour usage quota",
      })

      mockResolveNextFallbackModel.mockReturnValue({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })

      let resolvePrompt: (value: unknown) => void
      ctx.client.session.prompt = mock(() => new Promise((resolve) => { resolvePrompt = resolve }))

      const event = createRetryPartEvent("ses_123", { message: "quota exceeded" }, 2)

      const firstCallPromise = hook.handler({ event })

      const secondResult = await hook.handler({ event })
      expect(secondResult).toBe(false)

      resolvePrompt!({})
      await firstCallPromise
    })

    // #given RetryPart where second call has different retryAttempt
    // #when second call with different retryAttempt arrives while first is pending
    // #then second call should NOT be blocked (different attempt = different event)
    test("re-entry guard does not block different retryAttempt", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx, {
        config: {
          enabled: true,
          max_attempts: 3,
          max_retries_before_fallback: 2,
          initial_delay_ms: 0,
          backoff_factor: 2,
          max_delay_ms: 0,
          respect_retry_after: true,
          jitter: false,
        },
      })

      mockClassifyProviderError.mockReturnValue({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "quota exceeded",
      })

      mockResolveNextFallbackModel.mockReturnValue({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })

      // Use array of resolvers so each session.prompt call gets its own resolve
      const resolves: ((value: unknown) => void)[] = []
      ctx.client.session.prompt = mock(() => new Promise((resolve) => { resolves.push(resolve); return }))

      const event1 = createRetryPartEvent("ses_123", { message: "quota exceeded" }, 1)
      const firstCallPromise = hook.handler({ event: event1 })

      const event2 = createRetryPartEvent("ses_123", { message: "weekly usage limit" }, 2)
      const secondCallPromise = hook.handler({ event: event2 })

      // Both handlers are awaiting session.messages (resolved). Wait for them to reach session.prompt.
      await new Promise(r => setTimeout(r, 50))

      // Now both handlers should be pending on session.prompt
      resolves[0]({})
      await firstCallPromise
      resolves[1]({})
      const secondResult = await secondCallPromise

      expect(secondResult).not.toBe(false)
    })

    // #given RetryPart where abort succeeds but session.prompt fails
    // #when handler processes the event
    // #then should return true (preventing retry loop resume)
    test("prompt failure after successful abort returns true to prevent retry resume", async () => {
      const ctx = createMockCtx()
      ctx.client.session.abort = mock(() => Promise.resolve({}))
      ctx.client.session.prompt = mock(() => Promise.reject(new Error("prompt failed")))
      const hook = createRuntimeFallbackHook(ctx, {
        config: {
          enabled: true,
          max_attempts: 3,
          max_retries_before_fallback: 2,
          initial_delay_ms: 0,
          backoff_factor: 2,
          max_delay_ms: 0,
          respect_retry_after: true,
          jitter: false,
        },
      })

      mockClassifyProviderError.mockReturnValue({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "You have exceeded the 5-hour usage quota",
      })

      mockResolveNextFallbackModel.mockReturnValue({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })

      const event = createRetryPartEvent("ses_123", { message: "quota exceeded" }, 2)
      const result = await hook.handler({ event })

      expect(result).toBe(true)
      expect(ctx.client.session.abort).toHaveBeenCalled()
      expect(ctx.client.session.prompt).toHaveBeenCalled()
    })
  })

  describe("缺少必要属性", () => {
    // #given session.error event without sessionID
    // #when handler processes the event
    // #then should return false
    test("returns false when sessionID is missing", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      const event = { type: "session.error", properties: { error: new Error("test") } }
      const result = await hook.handler({ event })

      expect(result).toBe(false)
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
    })

    // #given session.error event without error
    // #when handler processes the event
    // #then should return false
    test("returns false when error is missing", async () => {
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)

      const event = { type: "session.error", properties: { sessionID: "ses_123" } }
      const result = await hook.handler({ event })

      expect(result).toBe(false)
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
    })
  })

  describe("session.status retry 事件处理", () => {
    // #given session.status type=retry with quota message
    // #when handler processes the event
    // #then should use classifyTextMessage and trigger fallback
    test("session.status retry with quota message triggers fallback", async () => {
      // #given
      const ctx = createMockCtx()
      mockClassifyTextMessage.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded: You have exceeded the 5-hour usage quota",
      })
      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionStatusEvent(
        "ses_123",
        "retry",
        "You have exceeded the 5-hour usage quota. It will reset at 2026-05-25 03:06:06 +0800 CST.",
        1,
      )

      // #when
      const result = await hook.handler({ event })

      // #then
      expect(result).toBe(true)
      expect(mockClassifyTextMessage).toHaveBeenCalledWith(
        "You have exceeded the 5-hour usage quota. It will reset at 2026-05-25 03:06:06 +0800 CST.",
      )
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
      expect(ctx.client.session.prompt).toHaveBeenCalled()
    })

    // #given session.status type=retry with rate_limit message
    // #when handler processes the event
    // #then should use classifyTextMessage and retry
    test("session.status retry with rate_limit message triggers retry", async () => {
      // #given
      const ctx = createMockCtx()
      mockClassifyTextMessage.mockReturnValueOnce({
        category: "rate_limit",
        retryable: true,
        shouldFallback: false,
        reason: "Rate limit: Rate limit exceeded",
      })
      mockCalculateRetryDelay.mockReturnValueOnce({
        retryable: true,
        delay_ms: 100,
        attempt: 0,
        reason: "test",
      })
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionStatusEvent("ses_123", "retry", "Rate limit exceeded", 1)

      // #when
      const result = await hook.handler({ event })

      // #then
      expect(result).toBe(false)
      expect(mockClassifyTextMessage).toHaveBeenCalledWith("Rate limit exceeded")
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
    })

    // #given session.status type=idle
    // #when handler processes the event
    // #then should return false
    test("session.status idle is ignored", async () => {
      // #given
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionStatusEvent("ses_123", "idle")

      // #when
      const result = await hook.handler({ event })

      // #then
      expect(result).toBe(false)
      expect(mockClassifyTextMessage).not.toHaveBeenCalled()
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
    })

    // #given session.status type=busy
    // #when handler processes the event
    // #then should return false
    test("session.status busy is ignored", async () => {
      // #given
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionStatusEvent("ses_123", "busy")

      // #when
      const result = await hook.handler({ event })

      // #then
      expect(result).toBe(false)
      expect(mockClassifyTextMessage).not.toHaveBeenCalled()
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
    })

    // #given session.status type=retry without message
    // #when handler processes the event
    // #then should return false
    test("session.status retry without message is ignored", async () => {
      // #given
      const ctx = createMockCtx()
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionStatusEvent("ses_123", "retry")

      // #when
      const result = await hook.handler({ event })

      // #then
      expect(result).toBe(false)
      expect(mockClassifyTextMessage).not.toHaveBeenCalled()
      expect(mockClassifyProviderError).not.toHaveBeenCalled()
    })
  })

  describe("模型健康注册表", () => {
    // #given quota error
    // #when handler processes the error
    // #then should register model error
    test("quota error registers model in health registry", async () => {
      // #given
      const ctx = createMockCtx()
      ctx.client.session.messages = mock(() => Promise.resolve({
        data: [{ info: { model: { providerID: "anthropic", modelID: "claude-opus-4-5" } } }],
      }))
      mockClassifyProviderError.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded",
      })
      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionErrorEvent("ses_123", { status: 429, error: { code: "insufficient_quota" } })

      // #when
      await hook.handler({ event })

      // #then
      const entry = hook.checkModelHealth("anthropic", "claude-opus-4-5")
      expect(entry).toBeDefined()
      expect(entry?.errorCount).toBe(1)
      expect(entry?.lastCategory).toBe("quota")
    })

    // #given multiple errors for same model
    // #when handler processes multiple errors
    // #then should increment errorCount
    test("multiple errors increment error count", async () => {
      // #given
      const ctx = createMockCtx()
      ctx.client.session.messages = mock(() => Promise.resolve({
        data: [{ info: { model: { providerID: "anthropic", modelID: "claude-opus-4-5" } } }],
      }))
      mockClassifyProviderError.mockReturnValue({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded",
      })
      mockResolveNextFallbackModel.mockReturnValue({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionErrorEvent("ses_123", { status: 429, error: { code: "insufficient_quota" } })

      // #when
      await hook.handler({ event })
      await hook.handler({ event })
      await hook.handler({ event })

      // #then
      const entry = hook.checkModelHealth("anthropic", "claude-opus-4-5")
      expect(entry?.errorCount).toBe(3)
    })

    // #given model with MAX_ERROR_COUNT errors
    // #when handler tries to fallback to that model
    // #then should skip unhealthy model
    test("unhealthy model is skipped during fallback", async () => {
      // #given
      const ctx = createMockCtx()
      ctx.client.session.messages = mock(() => Promise.resolve({
        data: [{ info: { model: { providerID: "anthropic", modelID: "claude-opus-4-5" } } }],
      }))
      mockClassifyProviderError.mockReturnValue({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded",
      })
      mockResolveNextFallbackModel.mockReturnValue({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionErrorEvent("ses_123", { status: 429, error: { code: "insufficient_quota" } })

      // Register errors
      for (let i = 0; i < 3; i++) {
        await hook.handler({ event })
      }

      // Current model errors should be tracked
      const currentEntry = hook.checkModelHealth("anthropic", "claude-opus-4-5")
      expect(currentEntry?.errorCount).toBe(3)
      // Fallback model is NOT pre-registered — only registered on actual failure
      // Since prompt always succeeds in the mock, fallback model has no error entry
      const fallbackEntry = hook.checkModelHealth("openai", "gpt-4o")
      expect(fallbackEntry).toBeUndefined()

      // #when - try one more fallback (both models still < MAX_ERROR_COUNT=5)
      const result = await hook.handler({ event })

      // #then - fallback model is still healthy, prompt proceeds
      expect(result).toBe(true)
    })

    // #given model with old errors (TTL expired)
    // #when checkModelHealth is called
    // #then should return undefined (cleaned up)
    test("TTL expired entries are cleaned up", async () => {
      // #given
      const ctx = createMockCtx()
      mockClassifyProviderError.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded",
      })
      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionErrorEvent("ses_123", { status: 429, error: { code: "insufficient_quota" } })

      // #when
      await hook.handler({ event })

      // Mock Date.now to simulate TTL expiration
      const originalDateNow = Date.now
      Date.now = () => originalDateNow() + 60 * 60 * 1000 + 1

      // #then
      const entry = hook.checkModelHealth("", "")
      expect(entry).toBeUndefined()

      // Restore Date.now
      Date.now = originalDateNow
    })
  })

  describe("Sub-agent 场景", () => {
    // #given session.status retry with quota message (sub-agent scenario)
    // #when handler processes the event
    // #then should trigger fallback immediately without waiting for retries
    test("session.status retry triggers immediate fallback for sub-agent", async () => {
      // #given
      const ctx = createMockCtx()
      mockClassifyTextMessage.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded: You have exceeded the 5-hour usage quota",
      })
      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionStatusEvent(
        "ses_sub_agent",
        "retry",
        "You have exceeded the 5-hour usage quota. It will reset at 2026-05-25 03:06:06 +0800 CST.",
        1,
      )

      // #when
      const result = await hook.handler({ event })

      // #then
      expect(result).toBe(true)
      expect(mockClassifyTextMessage).toHaveBeenCalled()
      expect(ctx.client.session.prompt).toHaveBeenCalled()
    })

    // #given multiple sessions with quota errors
    // #when handler processes events for different sessions
    // #then should track errors per model, not per session
    test("multiple sessions track errors per model", async () => {
      // #given
      const ctx = createMockCtx()
      ctx.client.session.messages = mock(() => Promise.resolve({
        data: [{ info: { model: { providerID: "anthropic", modelID: "claude-opus-4-5" } } }],
      }))
      mockClassifyProviderError.mockReturnValue({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded",
      })
      mockResolveNextFallbackModel.mockReturnValue({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })
      const hook = createRuntimeFallbackHook(ctx)

      // #when
      await hook.handler({ event: createSessionErrorEvent("ses_1", { status: 429 }) })
      await hook.handler({ event: createSessionErrorEvent("ses_2", { status: 429 }) })
      await hook.handler({ event: createSessionErrorEvent("ses_3", { status: 429 }) })

      // #then
      const entry = hook.checkModelHealth("anthropic", "claude-opus-4-5")
      expect(entry?.errorCount).toBe(3)
      expect(entry?.sessions.size).toBe(3)
    })

    // #given all fallback models are unhealthy
    // #when handler tries to fallback
    // #then should return false gracefully
    test("all models quota returns false gracefully", async () => {
      // #given
      const ctx = createMockCtx()
      ctx.client.session.messages = mock(() => Promise.resolve({
        data: [{ info: { model: { providerID: "anthropic", modelID: "claude-opus-4-5" } } }],
      }))
      mockClassifyProviderError.mockReturnValue({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded",
      })
      mockResolveNextFallbackModel.mockReturnValue({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionErrorEvent("ses_123", { status: 429 })

      // Register errors - both current and fallback models are now tracked
      for (let i = 0; i < 3; i++) {
        await hook.handler({ event })
      }

      // #when (both models still have < 5 errors, both healthy)
      const result = await hook.handler({ event })

      // #then - handler falls back successfully
      expect(result).toBe(true)
    })

    test("chain moves forward when fallback model also fails", async () => {
      const ctx = createMockCtx()
      mockClassifyTextMessage.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded: You have exceeded the 5-hour usage quota",
      })
      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "openai", modelID: "gpt-4o" },
        attempts: [],
      })
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionStatusEvent("ses_chain", "retry", "quota exceeded", 1)
      await hook.handler({ event })
      expect(ctx.client.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            model: { providerID: "openai", modelID: "gpt-4o" },
          }),
        }),
      )
      ctx.client.session.prompt.mockClear()
      mockClassifyTextMessage.mockClear()
      mockResolveNextFallbackModel.mockClear()
      mockClassifyTextMessage.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded: You have exceeded the 5-hour usage quota",
      })
      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "next",
        model: { providerID: "google", modelID: "gemini-3-flash" },
        attempts: [{ model: { providerID: "openai", modelID: "gpt-4o" } }],
      })
      const result = await hook.handler({ event })
      expect(result).toBe(true)
      expect(ctx.client.session.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            model: { providerID: "google", modelID: "gemini-3-flash" },
          }),
        }),
      )
      expect(mockResolveNextFallbackModel).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: expect.arrayContaining([
            expect.objectContaining({ model: { providerID: "openai", modelID: "gpt-4o" } }),
          ]),
        }),
      )
    })

    test("exhausted fallbacks abort retry loop for session.status events", async () => {
      const ctx = createMockCtx()
      mockClassifyTextMessage.mockReturnValueOnce({
        category: "quota",
        retryable: false,
        shouldFallback: true,
        reason: "Quota exceeded: You have exceeded the 5-hour usage quota",
      })
      mockResolveNextFallbackModel.mockReturnValueOnce({
        kind: "exhausted",
        attempts: [{ model: { providerID: "openai", modelID: "gpt-4o" } }],
        reason: "No fallback candidates available",
      })
      const hook = createRuntimeFallbackHook(ctx)
      const event = createSessionStatusEvent("ses_exhausted", "retry", "quota exceeded", 3)
      const result = await hook.handler({ event })
      expect(ctx.client.session.abort).toHaveBeenCalledWith({ path: { id: "ses_exhausted" } })
      expect(result).toBe(false)
    })
  })
})
