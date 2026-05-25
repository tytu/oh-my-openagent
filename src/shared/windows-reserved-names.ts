import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const WIN_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
])

/**
 * Check a directory for files/folders named after Windows reserved device names.
 * These cause "error: short read while indexing" in git on Windows.
 *
 * Returns list of found paths, or empty array if clean.
 */
export function scanForReservedNames(directory: string, maxDepth = 2): string[] {
  if (!existsSync(directory)) return []

  const found: string[] = []
  _scan(directory, 0, maxDepth, found)
  return found
}

function _scan(dir: string, depth: number, maxDepth: number, found: string[]): void {
  if (depth > maxDepth) return

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return // permission error, skip
  }

  for (const name of entries) {
    const upper = name.toUpperCase()
    // Check both exact match and base name (e.g., "nul" or "nul.txt" or "something.nul")
    const baseName = upper.split(".")[0] ?? ""
    if (WIN_RESERVED_NAMES.has(upper) || WIN_RESERVED_NAMES.has(baseName)) {
      found.push(join(dir, name))
    }

    // Recurse into subdirectories
    const fullPath = join(dir, name)
    try {
      const stat = existsSync(fullPath)
      if (stat && depth < maxDepth) {
        _scan(fullPath, depth + 1, maxDepth, found)
      }
    } catch {
      // skip inaccessible paths
    }
  }
}

export function formatReservedNamesWarning(found: string[]): string {
  const lines = [
    "",
    "⚠️  检测到 Windows 保留设备名",
    "   以下路径匹配 Windows 保留设备名（NUL、CON、AUX 等）：",
    "",
    ...found.map(p => `   - ${p}`),
    "",
    "   这些将在 Windows 上导致 git 'error: short read while indexing' 错误。",
    "   这会使 OpenCode 的快照系统极慢（30 分钟以上）。",
    "",
    "   修复：重命名这些文件/目录以避免保留名称。",
    "   例如：将 'nul' 改为 'null-device'，'con' 改为 'console-util'",
    "",
  ]
  return lines.join("\n")
}
