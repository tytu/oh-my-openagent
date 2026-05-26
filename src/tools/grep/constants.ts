import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { spawnSync } from "node:child_process"
import { getInstalledRipgrepPath, downloadAndInstallRipgrep } from "./downloader"
import { getDataDir } from "../../shared/data-path"

export type GrepBackend = "rg" | "grep"

interface ResolvedCli {
  path: string
  backend: GrepBackend
}

let cachedCli: ResolvedCli | null = null
let autoInstallAttempted = false

/**
 * 重置模块级缓存状态，仅供测试使用。
 * 每次测试前必须调用，避免 cachedCli 和 autoInstallAttempted 在测试间污染。
 */
export function _resetForTesting(): void {
  cachedCli = null
  autoInstallAttempted = false
}

function findExecutable(name: string): string | null {
  const isWindows = process.platform === "win32"
  const cmd = isWindows ? "where" : "which"

  try {
    const result = spawnSync(cmd, [name], { encoding: "utf-8", timeout: 5000 })
    if (result.status === 0 && result.stdout.trim()) {
      const candidates = result.stdout.trim().split(/\r?\n/)
      // Windows：遍历 where 的所有结果，跳过非可执行 shim
      for (const candidate of candidates) {
        const trimmed = candidate.trim()
        if (!trimmed) continue
        // 在 Windows 上跳过不以 .exe/.cmd/.bat 结尾的非可执行 shim（如 x-cmd 的 POSIX shell 脚本）
        if (isWindows) {
          const lower = trimmed.toLowerCase()
          if (!lower.endsWith(".exe") && !lower.endsWith(".cmd") && !lower.endsWith(".bat")) {
            continue
          }
        }
        // 验证文件确实存在
        if (existsSync(trimmed)) {
          return trimmed
        }
      }
      // 如果所有候选都被跳过，回退到不验证的模式（兼容非标准安装）
      return candidates[0].trim() || null
    }
  } catch {
    // Command execution failed
  }
  return null
}

function getOpenCodeBundledRg(): string | null {
  const execPath = process.execPath
  const execDir = dirname(execPath)

  const isWindows = process.platform === "win32"
  const rgName = isWindows ? "rg.exe" : "rg"

  const candidates = [
    // OpenCode XDG data path (highest priority - where OpenCode installs rg)
    join(getDataDir(), "opencode", "bin", rgName),
    // Legacy paths relative to execPath
    join(execDir, rgName),
    join(execDir, "bin", rgName),
    join(execDir, "..", "bin", rgName),
    join(execDir, "..", "libexec", rgName),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function resolveGrepCli(): ResolvedCli {
  if (cachedCli) return cachedCli

  const bundledRg = getOpenCodeBundledRg()
  if (bundledRg) {
    cachedCli = { path: bundledRg, backend: "rg" }
    return cachedCli
  }

  const systemRg = findExecutable("rg")
  if (systemRg) {
    cachedCli = { path: systemRg, backend: "rg" }
    return cachedCli
  }

  const installedRg = getInstalledRipgrepPath()
  if (installedRg) {
    cachedCli = { path: installedRg, backend: "rg" }
    return cachedCli
  }

  const grep = findExecutable("grep")
  if (grep) {
    cachedCli = { path: grep, backend: "grep" }
    return cachedCli
  }

  cachedCli = { path: "rg", backend: "rg" }
  return cachedCli
}

export async function resolveGrepCliWithAutoInstall(): Promise<ResolvedCli> {
  const current = resolveGrepCli()

  if (current.backend === "rg") {
    return current
  }

  if (autoInstallAttempted) {
    return current
  }

  autoInstallAttempted = true

  try {
    const rgPath = await downloadAndInstallRipgrep()
    cachedCli = { path: rgPath, backend: "rg" }
    return cachedCli
  } catch {
    return current
  }
}

export const DEFAULT_MAX_DEPTH = 20
export const DEFAULT_MAX_FILESIZE = "10M"
export const DEFAULT_MAX_COUNT = 500
export const DEFAULT_MAX_COLUMNS = 1000
export const DEFAULT_CONTEXT = 2
export const DEFAULT_TIMEOUT_MS = 300_000
export const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024

export const RG_SAFETY_FLAGS = [
  "--no-follow",
  "--color=never",
  "--no-heading",
  "--line-number",
  "--with-filename",
] as const

export const GREP_SAFETY_FLAGS = ["-n", "-H", "--color=never"] as const
