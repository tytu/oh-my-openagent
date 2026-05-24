import { describe, expect, test } from "bun:test"
import { AgentOverrideConfigSchema, BuiltinCategoryNameSchema, CategoryConfigSchema, FallbackModelEntrySchema, OhMyOpenCodeConfigSchema, RuntimeFallbackConfigSchema } from "./schema"

describe("disabled_mcps schema", () => {
  test("should accept built-in MCP names", () => {
    //#given
    const config = {
      disabled_mcps: ["context7", "grep_app"],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "grep_app"])
    }
  })

  test("should accept custom MCP names", () => {
    //#given
    const config = {
      disabled_mcps: ["playwright", "sqlite", "custom-mcp"],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["playwright", "sqlite", "custom-mcp"])
    }
  })

  test("should accept mixed built-in and custom names", () => {
    //#given
    const config = {
      disabled_mcps: ["context7", "playwright", "custom-server"],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "playwright", "custom-server"])
    }
  })

  test("should accept empty array", () => {
    //#given
    const config = {
      disabled_mcps: [],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([])
    }
  })

  test("should reject non-string values", () => {
    //#given
    const config = {
      disabled_mcps: [123, true, null],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("should accept undefined (optional field)", () => {
    //#given
    const config = {}

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toBeUndefined()
    }
  })

  test("should reject empty strings", () => {
    //#given
    const config = {
      disabled_mcps: [""],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("should accept MCP names with various naming patterns", () => {
    //#given
    const config = {
      disabled_mcps: [
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ])
    }
  })
})

describe("AgentOverrideConfigSchema", () => {
  describe("category field", () => {
    test("accepts category as optional string", () => {
      // #given
      const config = { category: "visual-engineering" }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("visual-engineering")
      }
    })

    test("accepts config without category", () => {
      // #given
      const config = { temperature: 0.5 }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
    })

    test("rejects non-string category", () => {
      // #given
      const config = { category: 123 }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(false)
    })
  })

  describe("variant field", () => {
    test("accepts variant as optional string", () => {
      // #given
      const config = { variant: "high" }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.variant).toBe("high")
      }
    })

    test("rejects non-string variant", () => {
      // #given
      const config = { variant: 123 }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(false)
    })
  })

  describe("skills field", () => {
    test("accepts skills as optional string array", () => {
      // #given
      const config = { skills: ["frontend-ui-ux", "code-reviewer"] }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual(["frontend-ui-ux", "code-reviewer"])
      }
    })

    test("accepts empty skills array", () => {
      // #given
      const config = { skills: [] }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual([])
      }
    })

    test("accepts config without skills", () => {
      // #given
      const config = { temperature: 0.5 }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
    })

    test("rejects non-array skills", () => {
      // #given
      const config = { skills: "frontend-ui-ux" }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(false)
    })
  })

  describe("backward compatibility", () => {
    test("still accepts model field (deprecated)", () => {
      // #given
      const config = { model: "openai/gpt-5.2" }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.2")
      }
    })

    test("accepts both model and category (deprecated usage)", () => {
      // #given - category should take precedence at runtime, but both should validate
      const config = { 
        model: "openai/gpt-5.2",
        category: "ultrabrain"
      }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.2")
        expect(result.data.category).toBe("ultrabrain")
      }
    })
  })

  describe("combined fields", () => {
    test("accepts category with skills", () => {
      // #given
      const config = { 
        category: "visual-engineering",
        skills: ["frontend-ui-ux"]
      }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("visual-engineering")
        expect(result.data.skills).toEqual(["frontend-ui-ux"])
      }
    })

    test("accepts category with skills and other fields", () => {
      // #given
      const config = { 
        category: "ultrabrain",
        skills: ["code-reviewer"],
        temperature: 0.3,
        prompt_append: "Extra instructions"
      }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("ultrabrain")
        expect(result.data.skills).toEqual(["code-reviewer"])
        expect(result.data.temperature).toBe(0.3)
        expect(result.data.prompt_append).toBe("Extra instructions")
      }
    })
  })
})

describe("CategoryConfigSchema", () => {
  test("accepts variant as optional string", () => {
    // #given
    const config = { model: "openai/gpt-5.2", variant: "xhigh" }

    // #when
    const result = CategoryConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variant).toBe("xhigh")
    }
  })

  test("accepts reasoningEffort as optional string with xhigh", () => {
    // #given
    const config = { reasoningEffort: "xhigh" }

    // #when
    const result = CategoryConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reasoningEffort).toBe("xhigh")
    }
  })

  test("rejects non-string variant", () => {
    // #given
    const config = { model: "openai/gpt-5.2", variant: 123 }

    // #when
    const result = CategoryConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(false)
  })
})

describe("BuiltinCategoryNameSchema", () => {
  test("accepts all builtin category names", () => {
    // #given
    const categories = ["visual-engineering", "ultrabrain", "artistry", "quick", "unspecified-low", "unspecified-high", "writing"]

    // #when / #then
    for (const cat of categories) {
      const result = BuiltinCategoryNameSchema.safeParse(cat)
      expect(result.success).toBe(true)
    }
  })
})

describe("Sisyphus-Junior agent override", () => {
  test("schema accepts agents['Sisyphus-Junior'] and retains the key after parsing", () => {
    // #given
    const config = {
      agents: {
        "sisyphus-junior": {
          model: "openai/gpt-5.2",
          temperature: 0.2,
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]).toBeDefined()
      expect(result.data.agents?.["sisyphus-junior"]?.model).toBe("openai/gpt-5.2")
      expect(result.data.agents?.["sisyphus-junior"]?.temperature).toBe(0.2)
    }
  })

  test("schema accepts sisyphus-junior with prompt_append", () => {
    // #given
    const config = {
      agents: {
        "sisyphus-junior": {
          prompt_append: "Additional instructions for sisyphus-junior",
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]?.prompt_append).toBe(
        "Additional instructions for sisyphus-junior"
      )
    }
  })

  test("schema accepts sisyphus-junior with tools override", () => {
    // #given
    const config = {
      agents: {
        "sisyphus-junior": {
          tools: {
            read: true,
            write: false,
          },
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]?.tools).toEqual({
        read: true,
        write: false,
      })
    }
  })

  test("schema accepts lowercase agent names (sisyphus, atlas, prometheus)", () => {
    // #given
    const config = {
      agents: {
        sisyphus: {
          temperature: 0.1,
        },
        atlas: {
          temperature: 0.2,
        },
        prometheus: {
          temperature: 0.3,
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.sisyphus?.temperature).toBe(0.1)
      expect(result.data.agents?.atlas?.temperature).toBe(0.2)
      expect(result.data.agents?.prometheus?.temperature).toBe(0.3)
    }
  })

  test("schema accepts lowercase metis and momus agent names", () => {
    // #given
    const config = {
      agents: {
        metis: {
          category: "ultrabrain",
        },
        momus: {
          category: "quick",
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.metis?.category).toBe("ultrabrain")
      expect(result.data.agents?.momus?.category).toBe("quick")
    }
  })
})

describe("fallback_models schema", () => {
  test("agent and category fallback_models preserve valid string and object entries", () => {
    // #given
    const config = {
      agents: {
        sisyphus: {
          fallback_models: [
            { model: "volcengine/deepseek-v4-flash" },
            { providerID: "openai", modelID: "gpt-5.2", variant: "high" },
          ],
        },
      },
      categories: {
        quick: {
          fallback_models: [
            { model: "anthropic/claude-haiku-4-5", variant: "low" },
            { providerID: "google", modelID: "gemini-3-flash" },
          ],
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.sisyphus?.fallback_models).toEqual(config.agents.sisyphus.fallback_models)
      expect(result.data.categories?.quick?.fallback_models).toEqual(config.categories.quick.fallback_models)
    }
  })

  test("fallback model string entries must use non-empty provider/model format", () => {
    // #given
    const invalidEntries = [
      { model: "claude-opus-4-5" },
      { model: "/claude-opus-4-5" },
      { model: "anthropic/" },
      { model: "" },
    ]

    for (const entry of invalidEntries) {
      // #when
      const result = FallbackModelEntrySchema.safeParse(entry)

      // #then
      expect(result.success).toBe(false)
    }
  })

  test("fallback object entries require non-empty providerID and modelID", () => {
    // #given
    const invalidEntries = [
      { providerID: "", modelID: "claude-opus-4-5" },
      { providerID: "anthropic", modelID: "" },
    ]

    for (const entry of invalidEntries) {
      // #when
      const result = FallbackModelEntrySchema.safeParse(entry)

      // #then
      expect(result.success).toBe(false)
    }
  })

  test("fallback model entries reject mixed string and object formats", () => {
    // #given
    const entry = {
      model: "anthropic/claude-opus-4-5",
      providerID: "anthropic",
      modelID: "claude-opus-4-5",
    }

    // #when
    const result = FallbackModelEntrySchema.safeParse(entry)

    // #then
    expect(result.success).toBe(false)
  })
})

describe("RuntimeFallbackConfigSchema", () => {
  test("old config without runtime_fallback still parses successfully", () => {
    // #given
    const config = {
      disabled_mcps: ["context7"],
      agents: {
        sisyphus: { temperature: 0.1 },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.runtime_fallback).toBeUndefined()
    }
  })

  test("runtime_fallback.enabled defaults to true", () => {
    // #given
    const config = {}

    // #when
    const result = RuntimeFallbackConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(true)
    }
  })

  test("runtime_fallback.max_attempts defaults to 3 with minimum 0", () => {
    // #given - default
    const configDefault = {}

    // #when
    const resultDefault = RuntimeFallbackConfigSchema.safeParse(configDefault)

    // #then
    expect(resultDefault.success).toBe(true)
    if (resultDefault.success) {
      expect(resultDefault.data.max_attempts).toBe(3)
    }

    // #given - valid value
    const configValid = { max_attempts: 5 }

    // #when
    const resultValid = RuntimeFallbackConfigSchema.safeParse(configValid)

    // #then
    expect(resultValid.success).toBe(true)
    if (resultValid.success) {
      expect(resultValid.data.max_attempts).toBe(5)
    }

    // #given - minimum boundary (0)
    const configMin = { max_attempts: 0 }

    // #when
    const resultMin = RuntimeFallbackConfigSchema.safeParse(configMin)

    // #then
    expect(resultMin.success).toBe(true)
    if (resultMin.success) {
      expect(resultMin.data.max_attempts).toBe(0)
    }

    // #given - below minimum
    const configInvalid = { max_attempts: -1 }

    // #when
    const resultInvalid = RuntimeFallbackConfigSchema.safeParse(configInvalid)

    // #then
    expect(resultInvalid.success).toBe(false)
  })

  test("runtime_fallback.initial_delay_ms defaults to 2000 with minimum 0", () => {
    // #given - default
    const configDefault = {}

    // #when
    const resultDefault = RuntimeFallbackConfigSchema.safeParse(configDefault)

    // #then
    expect(resultDefault.success).toBe(true)
    if (resultDefault.success) {
      expect(resultDefault.data.initial_delay_ms).toBe(2000)
    }

    // #given - valid value
    const configValid = { initial_delay_ms: 5000 }

    // #when
    const resultValid = RuntimeFallbackConfigSchema.safeParse(configValid)

    // #then
    expect(resultValid.success).toBe(true)
    if (resultValid.success) {
      expect(resultValid.data.initial_delay_ms).toBe(5000)
    }

    // #given - minimum boundary (0)
    const configMin = { initial_delay_ms: 0 }

    // #when
    const resultMin = RuntimeFallbackConfigSchema.safeParse(configMin)

    // #then
    expect(resultMin.success).toBe(true)
    if (resultMin.success) {
      expect(resultMin.data.initial_delay_ms).toBe(0)
    }

    // #given - below minimum
    const configInvalid = { initial_delay_ms: -1 }

    // #when
    const resultInvalid = RuntimeFallbackConfigSchema.safeParse(configInvalid)

    // #then
    expect(resultInvalid.success).toBe(false)
  })

  test("runtime_fallback.backoff_factor defaults to 2 with minimum 1", () => {
    // #given - default
    const configDefault = {}

    // #when
    const resultDefault = RuntimeFallbackConfigSchema.safeParse(configDefault)

    // #then
    expect(resultDefault.success).toBe(true)
    if (resultDefault.success) {
      expect(resultDefault.data.backoff_factor).toBe(2)
    }

    // #given - valid value
    const configValid = { backoff_factor: 3 }

    // #when
    const resultValid = RuntimeFallbackConfigSchema.safeParse(configValid)

    // #then
    expect(resultValid.success).toBe(true)
    if (resultValid.success) {
      expect(resultValid.data.backoff_factor).toBe(3)
    }

    // #given - minimum boundary (1)
    const configMin = { backoff_factor: 1 }

    // #when
    const resultMin = RuntimeFallbackConfigSchema.safeParse(configMin)

    // #then
    expect(resultMin.success).toBe(true)
    if (resultMin.success) {
      expect(resultMin.data.backoff_factor).toBe(1)
    }

    // #given - below minimum
    const configInvalid = { backoff_factor: 0 }

    // #when
    const resultInvalid = RuntimeFallbackConfigSchema.safeParse(configInvalid)

    // #then
    expect(resultInvalid.success).toBe(false)
  })

  test("runtime_fallback.max_delay_ms defaults to 30000 with minimum 0", () => {
    // #given - default
    const configDefault = {}

    // #when
    const resultDefault = RuntimeFallbackConfigSchema.safeParse(configDefault)

    // #then
    expect(resultDefault.success).toBe(true)
    if (resultDefault.success) {
      expect(resultDefault.data.max_delay_ms).toBe(30000)
    }

    // #given - valid value
    const configValid = { max_delay_ms: 60000 }

    // #when
    const resultValid = RuntimeFallbackConfigSchema.safeParse(configValid)

    // #then
    expect(resultValid.success).toBe(true)
    if (resultValid.success) {
      expect(resultValid.data.max_delay_ms).toBe(60000)
    }

    // #given - minimum boundary (0)
    const configMin = { max_delay_ms: 0 }

    // #when
    const resultMin = RuntimeFallbackConfigSchema.safeParse(configMin)

    // #then
    expect(resultMin.success).toBe(true)
    if (resultMin.success) {
      expect(resultMin.data.max_delay_ms).toBe(0)
    }

    // #given - below minimum
    const configInvalid = { max_delay_ms: -1 }

    // #when
    const resultInvalid = RuntimeFallbackConfigSchema.safeParse(configInvalid)

    // #then
    expect(resultInvalid.success).toBe(false)
  })

  test("runtime_fallback.respect_retry_after defaults to true", () => {
    // #given
    const config = {}

    // #when
    const result = RuntimeFallbackConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.respect_retry_after).toBe(true)
    }
  })

  test("runtime_fallback.jitter defaults to true", () => {
    // #given
    const config = {}

    // #when
    const result = RuntimeFallbackConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.jitter).toBe(true)
    }
  })

  test("runtime_fallback accepts valid full configuration", () => {
    // #given
    const config = {
      enabled: false,
      max_attempts: 5,
      initial_delay_ms: 1000,
      backoff_factor: 3,
      max_delay_ms: 60000,
      respect_retry_after: false,
      jitter: false,
    }

    // #when
    const result = RuntimeFallbackConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(false)
      expect(result.data.max_attempts).toBe(5)
      expect(result.data.initial_delay_ms).toBe(1000)
      expect(result.data.backoff_factor).toBe(3)
      expect(result.data.max_delay_ms).toBe(60000)
      expect(result.data.respect_retry_after).toBe(false)
      expect(result.data.jitter).toBe(false)
    }
  })

  test("OhMyOpenCodeConfigSchema accepts runtime_fallback as optional field", () => {
    // #given
    const config = {
      runtime_fallback: {
        enabled: false,
        max_attempts: 10,
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.runtime_fallback).toBeDefined()
      expect(result.data.runtime_fallback?.enabled).toBe(false)
      expect(result.data.runtime_fallback?.max_attempts).toBe(10)
    }
  })

  test("invalid parameters are rejected", () => {
    // #given - max_attempts < 0
    const config1 = { max_attempts: -1 }

    // #when
    const result1 = RuntimeFallbackConfigSchema.safeParse(config1)

    // #then
    expect(result1.success).toBe(false)

    // #given - initial_delay_ms < 0
    const config2 = { initial_delay_ms: -100 }

    // #when
    const result2 = RuntimeFallbackConfigSchema.safeParse(config2)

    // #then
    expect(result2.success).toBe(false)

    // #given - backoff_factor < 1
    const config3 = { backoff_factor: 0.5 }

    // #when
    const result3 = RuntimeFallbackConfigSchema.safeParse(config3)

    // #then
    expect(result3.success).toBe(false)

    // #given - max_delay_ms < 0
    const config4 = { max_delay_ms: -5000 }

    // #when
    const result4 = RuntimeFallbackConfigSchema.safeParse(config4)

    // #then
    expect(result4.success).toBe(false)

    // #given - wrong type for enabled
    const config5 = { enabled: "yes" }

    // #when
    const result5 = RuntimeFallbackConfigSchema.safeParse(config5)

    // #then
    expect(result5.success).toBe(false)

    // #given - wrong type for jitter
    const config6 = { jitter: 1 }

    // #when
    const result6 = RuntimeFallbackConfigSchema.safeParse(config6)

    // #then
    expect(result6.success).toBe(false)
  })
})
