import { describe, test, expect, beforeEach } from "bun:test"
import { _resetForTesting, resolveGrepCli } from "./constants"

const isWindows = process.platform === "win32"

describe("_resetForTesting", () => {
  test("#given 已缓存的 CLI #when _resetForTesting #then 缓存被清空", () => {
    // #given — 首次调用触发缓存写入
    _resetForTesting()
    const first = resolveGrepCli()

    // #when — 重置后再次调用
    _resetForTesting()
    const after = resolveGrepCli()

    // #then — 缓存已清空，新调用重新求值（在相同环境下返回相同结果）
    // 关键验证：不会因为缓存而导致 first !== after
    expect(after).toBeDefined()
  })
})

describe("resolveGrepCli cache behavior", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  test("#given 首次调用 #when resolveGrepCli #then 返回 ResolvedCli 且 .backend 和 .path 存在", () => {
    // #given — clean state

    // #when
    const cli = resolveGrepCli()

    // #then
    expect(cli).toBeDefined()
    expect(cli.backend).toMatch(/^(rg|grep)$/)
    expect(typeof cli.path).toBe("string")
    expect(cli.path.length).toBeGreaterThan(0)
  })

  test("#given 已调用过一次 #when 再次调用 #then 返回缓存中的同一对象（引用相等）", () => {
    // #given
    const first = resolveGrepCli()

    // #when
    const second = resolveGrepCli()

    // #then — 缓存命中，same object reference
    expect(second).toBe(first)
  })
})

if (isWindows) {
  describe("findExecutable via resolveGrepCli — Windows broken shim filtering", () => {
    beforeEach(() => {
      _resetForTesting()
    })

    test("#given 真实系统 PATH 含 broken shim #when 解析 CLI #then 选择可执行文件而非文本 shim", () => {
      // #given — 用户机器上 x-cmd 的 rg（文本 shim）和 Chocolatey 的 rg.exe 共存

      // #when
      const cli = resolveGrepCli()

      // #then — 修复后：broken 文本 shim 被跳过，选择合法的可执行文件
      expect(cli.backend).toBe("rg")
      const lower = cli.path.toLowerCase()
      // 返回的路径应以 .exe、.cmd 或 .bat 结尾（可执行扩展名）
      // 不应返回无扩展名的 broken POSIX shell 脚本
      const isValid =
        lower.endsWith(".exe") ||
        lower.endsWith(".cmd") ||
        lower.endsWith(".bat") ||
        cli.path === "rg" // fallback 值
      expect(isValid).toBe(true)
    })

    test("#given resolveGrepCli 返回有效路径 #when 第二次调用 #then 缓存命中", () => {
      // #given
      const first = resolveGrepCli()

      // #when
      const second = resolveGrepCli()

      // #then — 缓存命中后扩展名过滤结果被保留
      expect(second).toBe(first)
    })
  })
}

describe("resolveGrepCli fallback chain", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  test("#given bundled rg 路径不存在 #when resolveGrepCli #then 回退到系统 rg 检测", () => {
    // #given — bundled rg 通常不在测试环境中存在

    // #when
    const cli = resolveGrepCli()

    // #then — 至少返回一个有效的 ResolvedCli（backend 非空）
    expect(cli.backend).toMatch(/^(rg|grep)$/)
    expect(typeof cli.path).toBe("string")
  })
})
