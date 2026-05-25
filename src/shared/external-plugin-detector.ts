/**
 * Detects external plugins that may conflict with oh-my-opencode features.
 * Used to prevent crashes from concurrent notification plugins.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { log } from "./logger"
import { parseJsoncSafe } from "./jsonc-parser"

interface OpencodeConfig {
  plugin?: string[]
}

/**
 * Known notification plugins that conflict with oh-my-opencode's session-notification.
 * Both plugins listen to session.idle and send notifications simultaneously,
 * which can cause crashes on Windows due to resource contention.
 */
const KNOWN_NOTIFICATION_PLUGINS = [
  "opencode-notifier",
  "@mohak34/opencode-notifier",
  "mohak34/opencode-notifier",
]

function getWindowsAppdataDir(): string | null {
  return process.env.APPDATA || null
}

function getConfigPaths(directory: string): string[] {
  const crossPlatformDir = path.join(os.homedir(), ".config")
  const paths = [
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
    path.join(crossPlatformDir, "opencode", "opencode.json"),
    path.join(crossPlatformDir, "opencode", "opencode.jsonc"),
  ]

  if (process.platform === "win32") {
    const appdataDir = getWindowsAppdataDir()
    if (appdataDir) {
      paths.push(path.join(appdataDir, "opencode", "opencode.json"))
      paths.push(path.join(appdataDir, "opencode", "opencode.jsonc"))
    }
  }

  return paths
}

function loadOpencodePlugins(directory: string): string[] {
  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const result = parseJsoncSafe<OpencodeConfig>(content)
      if (result.data) {
        return result.data.plugin ?? []
      }
    } catch {
      continue
    }
  }
  return []
}

/**
 * Check if a plugin entry matches a known notification plugin.
 * Handles various formats: "name", "name@version", "npm:name", "file://path/name"
 */
function matchesNotificationPlugin(entry: string): string | null {
  const normalized = entry.toLowerCase()
  for (const known of KNOWN_NOTIFICATION_PLUGINS) {
    if (
      normalized === known ||
      normalized.startsWith(`${known}@`) ||
      normalized.includes(`/${known}`) ||
      normalized.endsWith(`/${known}`)
    ) {
      return known
    }
  }
  return null
}

export interface ExternalNotifierResult {
  detected: boolean
  pluginName: string | null
  allPlugins: string[]
}

/**
 * Detect if any external notification plugin is configured.
 * Returns information about detected plugins for logging/warning.
 */
export function detectExternalNotificationPlugin(directory: string): ExternalNotifierResult {
  const plugins = loadOpencodePlugins(directory)
  
  for (const plugin of plugins) {
    const match = matchesNotificationPlugin(plugin)
    if (match) {
      log(`Detected external notification plugin: ${plugin}`)
      return {
        detected: true,
        pluginName: match,
        allPlugins: plugins,
      }
    }
  }

  return {
    detected: false,
    pluginName: null,
    allPlugins: plugins,
  }
}

/**
 * Generate a warning message for users with conflicting notification plugins.
 */
export function getNotificationConflictWarning(pluginName: string): string {
  return `[oh-my-opencode] 检测到外部通知插件：${pluginName}

oh-my-opencode 和 ${pluginName} 同时监听 session.idle 事件。
   在 Windows 上同时运行两者可能导致崩溃。

   oh-my-opencode 的 session-notification 已自动禁用。

   如需使用 oh-my-opencode 的通知，请选择：
   1. 从 opencode.json 插件中移除 ${pluginName}
   2. 或在 oh-my-opencode.json 中设置 "notification": { "force_enable": true }`
}
