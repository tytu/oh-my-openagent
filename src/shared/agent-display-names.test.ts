import { describe, it, expect } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentDisplayName } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for lowercase config key (new format)", () => {
    // #given config key "sisyphus"
    const configKey = "sisyphus"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "总编排"
    expect(result).toBe("总编排")
  })

  it("returns display name for uppercase config key (old format - case-insensitive)", () => {
    // #given config key "Sisyphus" (old format)
    const configKey = "Sisyphus"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "总编排" (case-insensitive lookup)
    expect(result).toBe("总编排")
  })

  it("returns original key for unknown agents (fallback)", () => {
    // #given config key "custom-agent"
    const configKey = "custom-agent"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "custom-agent" (original key unchanged)
    expect(result).toBe("custom-agent")
  })

  it("returns display name for atlas", () => {
    // #given config key "atlas"
    const configKey = "atlas"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "任务执行"
    expect(result).toBe("任务执行")
  })

  it("returns display name for prometheus", () => {
    // #given config key "prometheus"
    const configKey = "prometheus"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "战略规划"
    expect(result).toBe("战略规划")
  })

  it("returns display name for sisyphus-junior", () => {
    // #given config key "sisyphus-junior"
    const configKey = "sisyphus-junior"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "执行助理"
    expect(result).toBe("执行助理")
  })

  it("returns display name for metis", () => {
    // #given config key "metis"
    const configKey = "metis"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "预规划"
    expect(result).toBe("预规划")
  })

  it("returns display name for momus", () => {
    // #given config key "momus"
    const configKey = "momus"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "质量评审"
    expect(result).toBe("质量评审")
  })

  it("returns display name for oracle", () => {
    // #given config key "oracle"
    const configKey = "oracle"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "技术诊断"
    expect(result).toBe("技术诊断")
  })

  it("returns display name for librarian", () => {
    // #given config key "librarian"
    const configKey = "librarian"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "知识检索"
    expect(result).toBe("知识检索")
  })

  it("returns display name for explore", () => {
    // #given config key "explore"
    const configKey = "explore"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "代码搜索"
    expect(result).toBe("代码搜索")
  })

  it("returns display name for multimodal-looker", () => {
    // #given config key "multimodal-looker"
    const configKey = "multimodal-looker"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "多元分析"
    expect(result).toBe("多元分析")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("contains all expected agent mappings", () => {
    // #given expected mappings
    const expectedMappings = {
      sisyphus: "总编排",
      atlas: "任务执行",
      prometheus: "战略规划",
      "sisyphus-junior": "执行助理",
      metis: "预规划",
      momus: "质量评审",
      oracle: "技术诊断",
      librarian: "知识检索",
      explore: "代码搜索",
      "multimodal-looker": "多元分析",
    }

    // #when checking the constant
    // #then contains all expected mappings
    expect(AGENT_DISPLAY_NAMES).toEqual(expectedMappings)
  })
})