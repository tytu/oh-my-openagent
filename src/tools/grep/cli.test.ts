import { describe, test, expect } from "bun:test"
import { buildRgArgs, parseOutput, parseCountOutput } from "./cli"
import type { GrepOptions } from "./types"

function makeOptions(overrides: Partial<GrepOptions> = {}): GrepOptions {
  return { pattern: "test", ...overrides }
}

describe("buildRgArgs", () => {
  test("#given 默认选项 #when 构建参数 #then 包含安全标志", () => {
    // #given
    const options = makeOptions()

    // #when
    const args = buildRgArgs(options)

    // #then
    expect(args).toContain("--no-follow")
    expect(args).toContain("--color=never")
    expect(args).toContain("--no-heading")
    expect(args).toContain("--line-number")
    expect(args).toContain("--with-filename")
  })

  test("#given context > 0 #when 构建参数 #then 包含 -C{context}", () => {
    // #given
    const options = makeOptions({ context: 3 })

    // #when
    const args = buildRgArgs(options)

    // #then
    expect(args).toContain("-C3")
  })

  test("#given context > 10 #when 构建参数 #then 封顶为 -C10", () => {
    // #given
    const options = makeOptions({ context: 15 })

    // #when
    const args = buildRgArgs(options)

    // #then
    expect(args).toContain("-C10")
  })

  test("#given caseSensitive=true #when 构建参数 #then 包含 --case-sensitive", () => {
    // #given
    const options = makeOptions({ caseSensitive: true })

    // #when
    const args = buildRgArgs(options)

    // #then
    expect(args).toContain("--case-sensitive")
  })

  test("#given caseSensitive=false #when 构建参数 #then 不包含 --case-sensitive", () => {
    // #given
    const options = makeOptions({ caseSensitive: false })

    // #when
    const args = buildRgArgs(options)

    // #then
    expect(args).not.toContain("--case-sensitive")
  })

  test("#given globs 数组 #when 构建参数 #then 每个 glob 展开为 --glob=", () => {
    // #given
    const options = makeOptions({
      globs: ["*.ts", "*.tsx", "!*.test.ts"],
    })

    // #when
    const args = buildRgArgs(options)

    // #then
    expect(args).toContain("--glob=*.ts")
    expect(args).toContain("--glob=*.tsx")
    expect(args).toContain("--glob=!*.test.ts")
  })

  test("#given excludeGlobs 数组 #when 构建参数 #then 展开为 --glob=!{glob}", () => {
    // #given
    const options = makeOptions({
      excludeGlobs: ["node_modules", "dist"],
    })

    // #when
    const args = buildRgArgs(options)

    // #then
    expect(args).toContain("--glob=!node_modules")
    expect(args).toContain("--glob=!dist")
  })
})

describe("parseOutput", () => {
  test("#given 标准 rg 输出行 #when 解析 #then 返回 GrepMatch 数组", () => {
    // #given
    const output = "src/file.ts:42:function hello() {\nsrc/file.ts:50:  console.log('test')\n"

    // #when
    const matches = parseOutput(output)

    // #then
    expect(matches).toHaveLength(2)
    expect(matches[0]).toEqual({
      file: "src/file.ts",
      line: 42,
      text: "function hello() {",
    })
    expect(matches[1]).toEqual({
      file: "src/file.ts",
      line: 50,
      text: "  console.log('test')",
    })
  })

  test("#given 空字符串 #when 解析 #then 返回空数组", () => {
    // #given
    const output = ""

    // #when
    const matches = parseOutput(output)

    // #then
    expect(matches).toEqual([])
  })

  test("#given 只有空白字符 #when 解析 #then 返回空数组", () => {
    // #given
    const output = "\n  \n\t\n"

    // #when
    const matches = parseOutput(output)

    // #then
    expect(matches).toEqual([])
  })
})

describe("parseCountOutput", () => {
  test("#given 计数输出行 #when 解析 #then 返回 CountResult 数组", () => {
    // #given
    const output = "src/a.ts:15\nsrc/b.ts:3\n"

    // #when
    const results = parseCountOutput(output)

    // #then
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ file: "src/a.ts", count: 15 })
    expect(results[1]).toEqual({ file: "src/b.ts", count: 3 })
  })

  test("#given 空字符串 #when 解析 #then 返回空数组", () => {
    // #given
    const output = ""

    // #when
    const results = parseCountOutput(output)

    // #then
    expect(results).toEqual([])
  })
})
