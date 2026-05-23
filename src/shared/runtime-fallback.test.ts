import { describe, test, expect } from "bun:test"
import { resolveNextFallbackModel } from "./runtime-fallback"
import type { RuntimeFallbackInput, FallbackModel, FallbackAttempt } from "./runtime-fallback"

describe("resolveNextFallbackModel", () => {
  // Helper to create FallbackModel
  const model = (providerID: string, modelID: string, variant?: string): FallbackModel => ({
    providerID,
    modelID,
    variant,
  })

  // Helper to create FallbackAttempt
  const attempt = (m: FallbackModel, error?: any): FallbackAttempt => ({
    model: m,
    error,
  })

  describe("fallback chain 遍历", () => {
    test("#given agent=oracle, currentModel=openai/gpt-5.2, attempts=[] #when resolveNextFallbackModel #then 返回 chain 中 openai/gpt-5.2 之后的下一个候选 github-copilot/gpt-5.2", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        // oracle chain: openai/gpt-5.2 -> github-copilot/gpt-5.2 -> opencode/gpt-5.2 -> anthropic/claude-opus-4-5 -> ...
        expect(result.model.providerID).toBe("github-copilot")
        expect(result.model.modelID).toBe("gpt-5.2")
        expect(result.model.variant).toBe("high")
      }
    })

    test("#given agent=oracle, currentModel=openai/gpt-5.2, attempts=[openai/gpt-5.2] #when resolveNextFallbackModel #then 跳过已失败的 openai/gpt-5.2 返回 github-copilot/gpt-5.2", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [attempt(model("openai", "gpt-5.2", "high"))],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("github-copilot")
        expect(result.model.modelID).toBe("gpt-5.2")
      }
    })

    test("#given agent=oracle, attempts 包含 openai/gpt-5.2 和 github-copilot/gpt-5.2 #when resolveNextFallbackModel #then 跳过已尝试的返回 opencode/gpt-5.2", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [
          attempt(model("openai", "gpt-5.2", "high")),
          attempt(model("github-copilot", "gpt-5.2", "high")),
        ],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("opencode")
        expect(result.model.modelID).toBe("gpt-5.2")
      }
    })

    test("#given agent=oracle, 所有 gpt-5.2 变体都已尝试 #when resolveNextFallbackModel #then 跳过所有 gpt-5.2 返回下一个不同模型 anthropic/claude-opus-4-5", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [
          attempt(model("openai", "gpt-5.2", "high")),
          attempt(model("github-copilot", "gpt-5.2", "high")),
          attempt(model("opencode", "gpt-5.2", "high")),
        ],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("anthropic")
        expect(result.model.modelID).toBe("claude-opus-4-5")
        expect(result.model.variant).toBe("max")
      }
    })
  })

  describe("可用模型过滤", () => {
    test("#given availableModels=undefined #when resolveNextFallbackModel #then 按 chain 顺序选择第一个未失败候选", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [],
        availableModels: undefined,
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("github-copilot")
        expect(result.model.modelID).toBe("gpt-5.2")
      }
    })

    test("#given availableModels 为空 Set #when resolveNextFallbackModel #then 按 chain 顺序选择第一个未失败候选", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [],
        availableModels: new Set(),
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("github-copilot")
        expect(result.model.modelID).toBe("gpt-5.2")
      }
    })

    test("#given availableModels 包含 anthropic/claude-opus-4-5 和 google/gemini-3-pro #when resolveNextFallbackModel #then 返回第一个可用的候选 anthropic/claude-opus-4-5", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [],
        availableModels: new Set(["anthropic/claude-opus-4-5", "google/gemini-3-pro"]),
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("anthropic")
        expect(result.model.modelID).toBe("claude-opus-4-5")
      }
    })

    test("#given availableModels 只包含 google/gemini-3-pro #when resolveNextFallbackModel #then 跳过不可用的返回 google/gemini-3-pro", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [],
        availableModels: new Set(["google/gemini-3-pro"]),
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("google")
        expect(result.model.modelID).toBe("gemini-3-pro")
      }
    })

    test("#given availableModels 不包含任何 chain 中的模型 #when resolveNextFallbackModel #then 返回 exhausted", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [],
        availableModels: new Set(["some-provider/some-model"]),
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("exhausted")
    })
  })

  describe("Agent/Category 映射", () => {
    test("#given agent='oracle' #when resolveNextFallbackModel #then 使用 AGENT_MODEL_REQUIREMENTS 中 oracle 的 chain", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        // oracle chain 第二个是 github-copilot/gpt-5.2
        expect(result.model.modelID).toBe("gpt-5.2")
        expect(result.model.providerID).toBe("github-copilot")
      }
    })

    test("#given category='quick' #when resolveNextFallbackModel #then 使用 CATEGORY_MODEL_REQUIREMENTS 中 quick 的 chain", () => {
      // #given
      // quick chain: anthropic/claude-haiku-4-5, google/gemini-3-flash, opencode/gpt-5-nano
      // 展开: anthropic/claude-haiku-4-5(跳过), github-copilot/claude-haiku-4-5, opencode/claude-haiku-4-5, google/gemini-3-flash, ...
      const input: RuntimeFallbackInput = {
        category: "quick",
        currentModel: model("anthropic", "claude-haiku-4-5"),
        attempts: [],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("github-copilot")
        expect(result.model.modelID).toBe("claude-haiku-4-5")
      }
    })

    test("#given agent 优先于 category #when resolveNextFallbackModel #then 使用 agent chain 而非 category chain", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        category: "quick",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        // oracle chain: github-copilot/gpt-5.2 (不是 quick chain 的 google/gemini-3-flash)
        expect(result.model.providerID).toBe("github-copilot")
        expect(result.model.modelID).toBe("gpt-5.2")
      }
    })

    test("#given agent 和 category 都不存在 #when resolveNextFallbackModel #then 抛出错误", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "nonexistent-agent",
        currentModel: model("openai", "gpt-5.2"),
        attempts: [],
      }

      // #when & #then
      expect(() => resolveNextFallbackModel(input)).toThrow()
    })

    test("#given agent=undefined, category=undefined #when resolveNextFallbackModel #then 抛出错误", () => {
      // #given
      const input: RuntimeFallbackInput = {
        currentModel: model("openai", "gpt-5.2"),
        attempts: [],
      }

      // #when & #then
      expect(() => resolveNextFallbackModel(input)).toThrow()
    })
  })

  describe("Exhausted 结果", () => {
    test("#given 所有 chain 候选都在 attempts 中 #when resolveNextFallbackModel #then 返回 exhausted", () => {
      // #given
      // oracle chain 展开所有 provider 组合:
      // openai/gpt-5.2, github-copilot/gpt-5.2, opencode/gpt-5.2,
      // anthropic/claude-opus-4-5, github-copilot/claude-opus-4-5, opencode/claude-opus-4-5,
      // google/gemini-3-pro, github-copilot/gemini-3-pro, opencode/gemini-3-pro
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [
          attempt(model("openai", "gpt-5.2", "high")),
          attempt(model("github-copilot", "gpt-5.2", "high")),
          attempt(model("opencode", "gpt-5.2", "high")),
          attempt(model("anthropic", "claude-opus-4-5", "max")),
          attempt(model("github-copilot", "claude-opus-4-5", "max")),
          attempt(model("opencode", "claude-opus-4-5", "max")),
          attempt(model("google", "gemini-3-pro")),
          attempt(model("github-copilot", "gemini-3-pro")),
          attempt(model("opencode", "gemini-3-pro")),
        ],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("exhausted")
    })

    test("#given exhausted 结果包含 attempts 和 lastErrorClassification #when resolveNextFallbackModel #then attempts 包含所有尝试过的 model", () => {
      // #given
      const lastError = {
        category: "rate_limit" as const,
        retryable: true,
        shouldFallback: false,
        reason: "Rate limit exceeded",
      }
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [
          attempt(model("openai", "gpt-5.2", "high"), lastError),
          attempt(model("github-copilot", "gpt-5.2", "high")),
          attempt(model("opencode", "gpt-5.2", "high")),
          attempt(model("anthropic", "claude-opus-4-5", "max")),
          attempt(model("github-copilot", "claude-opus-4-5", "max")),
          attempt(model("opencode", "claude-opus-4-5", "max")),
          attempt(model("google", "gemini-3-pro")),
          attempt(model("github-copilot", "gemini-3-pro")),
          attempt(model("opencode", "gemini-3-pro")),
        ],
        lastErrorClassification: lastError,
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("exhausted")
      if (result.kind === "exhausted") {
        expect(result.attempts).toHaveLength(9)
        expect(result.lastErrorClassification).toBe(lastError)
      }
    })
  })

  describe("当前 model 跳过", () => {
    test("#given currentModel 是 chain 中第一个候选 #when resolveNextFallbackModel #then 跳过 currentModel 返回第二个候选（不同 provider）", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("github-copilot")
        expect(result.model.modelID).toBe("gpt-5.2")
      }
    })

    test("#given currentModel 是 chain 中间某个候选 #when resolveNextFallbackModel #then 跳过 currentModel 返回 chain 中第一个未跳过的候选", () => {
      // #given
      // sisyphus chain 展开: anthropic/claude-opus-4-5, github-copilot/claude-opus-4-5, opencode/claude-opus-4-5,
      //   zai-coding-plan/glm-4.7(跳过), openai/gpt-5.2-codex, ...
      // zai-coding-plan 前有 anthropic 等候选不在 skip set 中
      const input: RuntimeFallbackInput = {
        agent: "sisyphus",
        currentModel: model("zai-coding-plan", "glm-4.7"),
        attempts: [],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("anthropic")
        expect(result.model.modelID).toBe("claude-opus-4-5")
      }
    })

    test("#given currentModel 在 attempts 中也存在 #when resolveNextFallbackModel #then 不会重复选择", () => {
      // #given
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [attempt(model("openai", "gpt-5.2", "high"))],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("github-copilot")
        expect(result.model.modelID).toBe("gpt-5.2")
      }
    })
  })

  describe("variant 传递", () => {
    test("#given chain entry 有 variant #when resolveNextFallbackModel #then 返回的 model 包含 variant", () => {
      // #given
      // oracle chain: openai/gpt-5.2(variant:high), anthropic/claude-opus-4-5(variant:max)
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [
          attempt(model("openai", "gpt-5.2", "high")),
          attempt(model("github-copilot", "gpt-5.2", "high")),
          attempt(model("opencode", "gpt-5.2", "high")),
        ],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.variant).toBe("max")
      }
    })

    test("#given chain entry 无 variant #when resolveNextFallbackModel #then variant 为 undefined", () => {
      // #given
      // oracle chain: ... -> google/gemini-3-pro (无 variant)
      const input: RuntimeFallbackInput = {
        agent: "oracle",
        currentModel: model("openai", "gpt-5.2", "high"),
        attempts: [
          attempt(model("openai", "gpt-5.2", "high")),
          attempt(model("github-copilot", "gpt-5.2", "high")),
          attempt(model("opencode", "gpt-5.2", "high")),
          attempt(model("anthropic", "claude-opus-4-5", "max")),
          attempt(model("github-copilot", "claude-opus-4-5", "max")),
          attempt(model("opencode", "claude-opus-4-5", "max")),
        ],
      }

      // #when
      const result = resolveNextFallbackModel(input)

      // #then
      expect(result.kind).toBe("next")
      if (result.kind === "next") {
        expect(result.model.providerID).toBe("google")
        expect(result.model.modelID).toBe("gemini-3-pro")
        expect(result.model.variant).toBeUndefined()
      }
    })
  })
})
