import { describe, test, expect } from "bun:test"
import { createBuiltinAgents } from "./utils"
import type { AgentConfig } from "@opencode-ai/sdk"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-5"

describe("createBuiltinAgents with model overrides", () => {
  test("Sisyphus with default model has thinking config", async () => {
    // #given - no overrides, using systemDefaultModel

    // #when
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    // #then
    expect(agents.sisyphus.model).toBe("anthropic/claude-opus-4-5")
    expect(agents.sisyphus.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.sisyphus.reasoningEffort).toBeUndefined()
  })

  test("Sisyphus with GPT model override has reasoningEffort, no thinking", async () => {
    // #given
    const overrides = {
      sisyphus: { model: "github-copilot/gpt-5.2" },
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then
    expect(agents.sisyphus.model).toBe("github-copilot/gpt-5.2")
    expect(agents.sisyphus.reasoningEffort).toBe("medium")
    expect(agents.sisyphus.thinking).toBeUndefined()
  })

  test("Sisyphus uses system default when no availableModels provided", async () => {
    // #given
    const systemDefaultModel = "anthropic/claude-opus-4-5"

    // #when
    const agents = await createBuiltinAgents([], {}, undefined, systemDefaultModel)

    // #then - falls back to system default when no availability match
    expect(agents.sisyphus.model).toBe("anthropic/claude-opus-4-5")
    expect(agents.sisyphus.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.sisyphus.reasoningEffort).toBeUndefined()
  })

  test("Oracle uses first fallback entry when no availableModels provided (no cache scenario)", async () => {
    // #given - no available models simulates CI without model cache

    // #when
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    // #then - uses first fallback entry (openai/gpt-5.2) instead of system default
    expect(agents.oracle.model).toBe("openai/gpt-5.2")
    expect(agents.oracle.reasoningEffort).toBe("medium")
    expect(agents.oracle.textVerbosity).toBe("high")
    expect(agents.oracle.thinking).toBeUndefined()
  })

  test("Oracle with GPT model override has reasoningEffort, no thinking", async () => {
    // #given
    const overrides = {
      oracle: { model: "openai/gpt-5.2" },
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then
    expect(agents.oracle.model).toBe("openai/gpt-5.2")
    expect(agents.oracle.reasoningEffort).toBe("medium")
    expect(agents.oracle.textVerbosity).toBe("high")
    expect(agents.oracle.thinking).toBeUndefined()
  })

  test("Oracle with Claude model override has thinking, no reasoningEffort", async () => {
    // #given
    const overrides = {
      oracle: { model: "anthropic/claude-sonnet-4" },
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then
    expect(agents.oracle.model).toBe("anthropic/claude-sonnet-4")
    expect(agents.oracle.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.oracle.reasoningEffort).toBeUndefined()
    expect(agents.oracle.textVerbosity).toBeUndefined()
  })

   test("non-model overrides are still applied after factory rebuild", async () => {
     // #given
     const overrides = {
       sisyphus: { model: "github-copilot/gpt-5.2", temperature: 0.5 },
     }

     // #when
     const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

     // #then
     expect(agents.sisyphus.model).toBe("github-copilot/gpt-5.2")
     expect(agents.sisyphus.temperature).toBe(0.5)
   })
})

describe("buildAgent with category and skills", () => {
  const { buildAgent } = require("./utils")
  const TEST_MODEL = "anthropic/claude-opus-4-5"

  test("agent with category inherits category settings", () => {
    // #given - agent factory that sets category but no model
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "visual-engineering",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then - category's built-in model is applied
    expect(agent.model).toBe("google/gemini-3-pro")
  })

  test("agent with category and existing model keeps existing model", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "visual-engineering",
          model: "custom/model",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then - explicit model takes precedence over category
    expect(agent.model).toBe("custom/model")
  })

  test("agent with category inherits variant", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "custom-category",
        }) as AgentConfig,
    }

    const categories = {
      "custom-category": {
        model: "openai/gpt-5.2",
        variant: "xhigh",
      },
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL, categories)

    // #then
    expect(agent.model).toBe("openai/gpt-5.2")
    expect(agent.variant).toBe("xhigh")
  })

  test("agent with skills has content prepended to prompt", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux"],
          prompt: "Original prompt content",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toContain("角色：设计师出身的开发者")
    expect(agent.prompt).toContain("Original prompt content")
    expect(agent.prompt).toMatch(/角色：设计师出身的开发者[\s\S]*Original prompt content/s)
  })

  test("agent with multiple skills has all content prepended", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux"],
          prompt: "Agent prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toContain("角色：设计师出身的开发者")
    expect(agent.prompt).toContain("Agent prompt")
  })

  test("agent without category or skills works as before", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          model: "custom/model",
          temperature: 0.5,
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.model).toBe("custom/model")
    expect(agent.temperature).toBe(0.5)
    expect(agent.prompt).toBe("Base prompt")
  })

  test("agent with category and skills applies both", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "ultrabrain",
          skills: ["frontend-ui-ux"],
          prompt: "Task description",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then - category's built-in model and skills are applied
    expect(agent.model).toBe("openai/gpt-5.2-codex")
    expect(agent.variant).toBe("xhigh")
    expect(agent.prompt).toContain("角色：设计师出身的开发者")
    expect(agent.prompt).toContain("Task description")
  })

  test("agent with non-existent category has no effect", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "non-existent",
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    // Note: The factory receives model, but if category doesn't exist, it's not applied
    // The agent's model comes from the factory output (which doesn't set model)
    expect(agent.model).toBeUndefined()
    expect(agent.prompt).toBe("Base prompt")
  })

  test("agent with non-existent skills only prepends found ones", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux", "non-existent-skill"],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toContain("角色：设计师出身的开发者")
    expect(agent.prompt).toContain("Base prompt")
  })

  test("agent with empty skills array keeps original prompt", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: [],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toBe("Base prompt")
  })
})

describe("zh-language-instruction injection", () => {
  test("所有内置 agent 的 prompt 末尾均包含中文指令", async () => {
    // #given - 默认配置
    // #when
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    // #then - 所有 agent 末尾均包含 Language_Instruction 块
    const expectedAgents = ["sisyphus", "oracle", "librarian", "explore", "multimodal-looker", "metis", "momus"]
    for (const name of expectedAgents) {
      expect(agents[name]).toBeDefined()
      expect(agents[name]!.prompt).toBeDefined()
      expect(agents[name]!.prompt!).toContain("<Language_Instruction>")
      expect(agents[name]!.prompt!).toContain("你的母语是中文")
      expect(agents[name]!.prompt!).toContain("禁止行为（零容忍）")
    }
  })

  test("主 agent（sisyphus、atlas）使用主 agent 措辞", async () => {
    // #given
    // #when
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    // #then
    expect(agents.sisyphus.prompt).toContain("身份级强制规则")
    if (agents.atlas?.prompt) {
      expect(agents.atlas.prompt).toContain("身份级强制规则")
    }
  })

  test("子 agent（oracle、librarian 等）使用子 agent 措辞", async () => {
    // #given
    // #when
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    // #then
    expect(agents.oracle.prompt).toContain("已从主 agent 继承")
    expect(agents.librarian.prompt).toContain("已从主 agent 继承")
    expect(agents.explore.prompt).toContain("已从主 agent 继承")
  })

  test("原有 <Language> 块包含 identity framing", async () => {
    // #given
    // #when
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    // #then - 原有的 Language 块包含 identity framing（互补双重保障）
    expect(agents.sisyphus.prompt).toContain("<Language>")
    expect(agents.sisyphus.prompt).toContain("母语")
    expect(agents.sisyphus.prompt).toContain("禁止")
    expect(agents.oracle.prompt).toContain("<Language>")
    expect(agents.librarian.prompt).toContain("<Language>")
  })

  test("中文指令出现在 prompt_append 之后（最末尾）", async () => {
    // #given - 用户通过 prompt_append 提供自定义内容
    const overrides = {
      sisyphus: { prompt_append: "[CUSTOM_APPEND_MARKER]" },
    }

    // #when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // #then - 自定义追加内容出现在 Language_Instruction 之前
    const prompt = agents.sisyphus.prompt ?? ""
    const customIdx = prompt.lastIndexOf("[CUSTOM_APPEND_MARKER]")
    const instructionIdx = prompt.lastIndexOf("<Language_Instruction>")
    expect(customIdx).toBeGreaterThan(-1)
    expect(instructionIdx).toBeGreaterThan(-1)
    expect(customIdx).toBeLessThan(instructionIdx)
  })

  test("注入后 prompt 以 Language_Instruction 结尾", async () => {
    // #given
    // #when
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    // #then - prompt 末尾是 Language_Instruction
    for (const name of Object.keys(agents)) {
      const prompt = agents[name].prompt ?? ""
      expect(prompt.endsWith("</Language_Instruction>")).toBe(true)
    }
  })
})
