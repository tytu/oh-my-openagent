import { describe, test, expect } from "bun:test"
import { formatGrepResult, formatCountResult } from "./utils"
import type { GrepResult, CountResult } from "./types"

describe("formatGrepResult", () => {
  test("#given error 字段存在 #when 格式化 #then 返回 Error: 前缀的字符串", () => {
    // #given
    const result: GrepResult = {
      matches: [],
      totalMatches: 0,
      filesSearched: 0,
      truncated: false,
      error: "something went wrong",
    }

    // #when
    const output = formatGrepResult(result)

    // #then
    expect(output).toBe("Error: something went wrong")
  })

  test("#given matches 为空 #when 格式化 #then 返回 No matches found", () => {
    // #given
    const result: GrepResult = {
      matches: [],
      totalMatches: 0,
      filesSearched: 0,
      truncated: false,
    }

    // #when
    const output = formatGrepResult(result)

    // #then
    expect(output).toBe("No matches found")
  })

  test("#given 有匹配结果 #when 格式化 #then 包含汇总行和按文件分组的内容", () => {
    // #given
    const result: GrepResult = {
      matches: [
        { file: "src/a.ts", line: 1, text: "hello" },
        { file: "src/a.ts", line: 2, text: "world" },
        { file: "src/b.ts", line: 5, text: "foo" },
      ],
      totalMatches: 3,
      filesSearched: 2,
      truncated: false,
    }

    // #when
    const output = formatGrepResult(result)

    // #then
    expect(output).toContain("Found 3 match(es) in 2 file(s)")
    expect(output).toContain("src/a.ts")
    expect(output).toContain("  1: hello")
    expect(output).toContain("  2: world")
    expect(output).toContain("src/b.ts")
    expect(output).toContain("  5: foo")
  })

  test("#given truncated=true #when 格式化 #then 包含截断提示", () => {
    // #given
    const result: GrepResult = {
      matches: [{ file: "src/a.ts", line: 1, text: "hello" }],
      totalMatches: 1,
      filesSearched: 1,
      truncated: true,
    }

    // #when
    const output = formatGrepResult(result)

    // #then
    expect(output).toContain("[Output truncated due to size limit]")
  })
})

describe("formatCountResult", () => {
  test("#given 有计数结果 #when 格式化 #then 按降序排列并包含汇总", () => {
    // #given
    const results: CountResult[] = [
      { file: "src/a.ts", count: 3 },
      { file: "src/b.ts", count: 15 },
      { file: "src/c.ts", count: 7 },
    ]

    // #when
    const output = formatCountResult(results)

    // #then
    expect(output).toContain("Found 25 match(es) in 3 file(s)")
    // 降序：b.ts(15) 应在 a.ts(3) 之前
    const bIndex = output.indexOf("src/b.ts")
    const cIndex = output.indexOf("src/c.ts")
    const aIndex = output.indexOf("src/a.ts")
    expect(bIndex).toBeLessThan(cIndex)
    expect(cIndex).toBeLessThan(aIndex)
  })

  test("#given 空结果 #when 格式化 #then 返回 No matches found", () => {
    // #given
    const results: CountResult[] = []

    // #when
    const output = formatCountResult(results)

    // #then
    expect(output).toBe("No matches found")
  })
})
