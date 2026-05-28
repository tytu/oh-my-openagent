import { describe, expect, it } from "bun:test"
import { detectEnglishViolation } from "./detector"

describe("detectEnglishViolation", () => {
  it("should not flag pure Chinese", () => {
    // #given
    const text = "用户想要分析问题"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe(false)
  })

  it("should flag pure English", () => {
    // #given
    const text = "Let me start more searches and wait for the results"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe("trigger")
  })

  it("should not flag Chinese with tech terms", () => {
    // #given
    const text = "我们使用 React 库和 TypeScript 语言来实现复杂的用户界面组件渲染逻辑"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe(false)
  })

  it("should strip code blocks before checking", () => {
    // #given
    const text = "分析这段代码：\n```ts\nconst x = 1\nconst y = 2\n```"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe(false)
  })

  it("should strip URLs before checking", () => {
    // #given
    const text = "参考 https://api.example.com/docs 文档"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe(false)
  })

  it("should strip file paths before checking", () => {
    // #given
    const text = "读取 J:\\workspace\\oh-my-opencode\\src\\index.ts 文件"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe(false)
  })

  it("should not flag short text", () => {
    // #given
    const text = "OK"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe(false)
  })

  it("should flag English text with one Chinese char", () => {
    // #given
    const text = "This is a very long English sentence with one Chinese word 一 here yeah"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe("ascii")
  })

  it("should respect custom threshold", () => {
    // #given
    const text = "我们使用 React 库和 TypeScript 语言来实现复杂的用户界面组件渲染逻辑"
    // #when
    const resultDefault = detectEnglishViolation(text)
    const resultHigh = detectEnglishViolation(text, 0.8)
    // #then
    expect(resultDefault).toBe(false)
    expect(resultHigh).toBe(false)
  })

  it("should check per-line for multiline content", () => {
    // #given
    const text = "用户想要分析问题\nLet me start more searches and wait for results"
    // #when
    const result = detectEnglishViolation(text)
    // #then - overall text is mixed, but after stripping Chinese chars, English dominates
    expect(result).toBe("ascii")
  })

  it("should flag trigger word 'let me' at start", () => {
    // #given
    const text = "Let me search for the implementation"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe("trigger")
  })

  it("should flag trigger word 'i need' at start", () => {
    // #given
    const text = "I need to check the configuration"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe("trigger")
  })

  it("should flag trigger word 'the user' at start", () => {
    // #given
    const text = "The user wants to implement login"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe("trigger")
  })

  it("should flag trigger word 'first,' at start", () => {
    // #given
    const text = "First, I'll analyze the codebase"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe("trigger")
  })

  it("should not flag Chinese text starting with trigger-like content", () => {
    // #given
    const text = "让我们来搜索一下代码库中的实现"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe(false)
  })

  it("should not flag Chinese text similar to 'i need'", () => {
    // #given
    const text = "我需要检查一下配置文件和数据库连接"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe(false)
  })

  it("should detect 4-char meaningful English as violation", () => {
    // #given
    const text = "TODO"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe("ascii")
  })

  it("should skip 3-char meaningful English", () => {
    // #given
    const text = "API"
    // #when
    const result = detectEnglishViolation(text)
    // #then
    expect(result).toBe(false)
  })

  describe("trigger: now,", () => {
    it("should flag 'Now, let me check...'", () => {
      // #given
      const text = "Now, let me check the code structure and find the relevant implementation"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe("trigger")
    })

    it("should not flag '现在开始分析'", () => {
      // #given
      const text = "现在开始分析代码结构"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe(false)
    })
  })

  describe("trigger: now i", () => {
    it("should flag 'Now I need to...'", () => {
      // #given
      const text = "Now I need to check the configuration and verify the settings"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe("trigger")
    })

    it("should not flag '现在我需要检查'", () => {
      // #given
      const text = "现在我需要检查配置文件和数据库连接"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe(false)
    })
  })

  describe("trigger: now we", () => {
    it("should flag 'Now we should...'", () => {
      // #given
      const text = "Now we should verify the implementation and check for any issues"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe("trigger")
    })

    it("should not flag '现在我们看看'", () => {
      // #given
      const text = "现在我们看看代码库中的实现"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe(false)
    })
  })

  describe("trigger: next,", () => {
    it("should flag 'Next, I'll analyze...'", () => {
      // #given
      const text = "Next, I'll analyze the codebase and find the relevant patterns"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe("trigger")
    })

    it("should not flag '接下来分析一下'", () => {
      // #given
      const text = "接下来分析一下代码结构"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe(false)
    })
  })

  describe("trigger: next i", () => {
    it("should flag 'Next I should...'", () => {
      // #given
      const text = "Next I should check the configuration and verify the settings"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe("trigger")
    })

    it("should not flag '下一步我应该'", () => {
      // #given
      const text = "下一步我应该检查配置文件"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe(false)
    })
  })

  describe("trigger: then,", () => {
    it("should flag 'Then, we can...'", () => {
      // #given
      const text = "Then, we can verify the implementation and check for any issues"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe("trigger")
    })

    it("should not flag '然后我们可以'", () => {
      // #given
      const text = "然后我们可以验证一下实现"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe(false)
    })
  })

  describe("trigger: finally,", () => {
    it("should flag 'Finally, let's...'", () => {
      // #given
      const text = "Finally, let's verify the implementation and check for any issues"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe("trigger")
    })

    it("should not flag '最后我们来验证一下'", () => {
      // #given
      const text = "最后我们来验证一下实现"
      // #when
      const result = detectEnglishViolation(text)
      // #then
      expect(result).toBe(false)
    })
  })
})
