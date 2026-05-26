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
    expect(result).toBe(true)
  })

  it("should not flag Chinese with tech terms", () => {
    // #given
    const text = "使用 React 和 TypeScript 来实现用户界面组件渲染逻辑"
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
    expect(result).toBe(true)
  })

  it("should respect custom threshold", () => {
    // #given
    const text = "使用 React 和 TypeScript 来实现用户界面渲染逻辑"
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
    expect(result).toBe(true)
  })
})
