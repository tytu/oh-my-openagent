/**
 * Agent config keys to display names mapping.
 * Config keys are lowercase (e.g., "sisyphus", "atlas").
 * Display names include suffixes for UI/logs (e.g., "Sisyphus (Ultraworker)").
 */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  sisyphus: "主执行官",
  atlas: "任务编排",
  prometheus: "战略参谋",
  "sisyphus-junior": "执行助理",
  metis: "预审顾问",
  momus: "计划审查",
  oracle: "技术参谋",
  librarian: "知识典藏",
  explore: "深度探索",
  "multimodal-looker": "媒体解析",
}

/** Reverse mapping: Chinese display name → English config key */
export const AGENT_DISPLAY_TO_KEY: Record<string, string> = {
  "主执行官": "sisyphus",
  "任务编排": "atlas",
  "战略参谋": "prometheus",
  "执行助理": "sisyphus-junior",
  "预审顾问": "metis",
  "计划审查": "momus",
  "技术参谋": "oracle",
  "知识典藏": "librarian",
  "深度探索": "explore",
  "媒体解析": "multimodal-looker",
}

/**
 * Get display name for an agent config key.
 * Uses case-insensitive lookup for backward compatibility.
 * Returns original key if not found.
 */
export function getAgentDisplayName(configKey: string): string {
  // Try exact match first
  const exactMatch = AGENT_DISPLAY_NAMES[configKey]
  if (exactMatch !== undefined) return exactMatch

  // Fall back to case-insensitive search
  const lowerKey = configKey.toLowerCase()
  for (const [k, v] of Object.entries(AGENT_DISPLAY_NAMES)) {
    if (k.toLowerCase() === lowerKey) return v
  }

  // Unknown agent: return original key
  return configKey
}

/**
 * Resolve an agent identifier to its Chinese runtime name.
 * Accepts English config key ("sisyphus") or Chinese name ("主执行官").
 * Returns the Chinese name for use with OpenCode API (session.prompt, etc.).
 */
export function resolveAgentName(input: string): string {
  // Already a Chinese display name → return as-is
  if (AGENT_DISPLAY_TO_KEY[input] !== undefined) return input
  // English key → translate to Chinese
  return getAgentDisplayName(input)
}

/**
 * Resolve an agent name to its English config key.
 * Accepts Chinese name ("主执行官") or English key ("sisyphus").
 * Returns the English key for use with AGENT_MODEL_REQUIREMENTS, etc.
 */
export function resolveToEnglishKey(name: string): string {
  // Already an English config key
  if (AGENT_DISPLAY_NAMES[name] !== undefined) return name
  // Chinese name → English key
  const englishKey = AGENT_DISPLAY_TO_KEY[name]
  if (englishKey !== undefined) return englishKey
  // Case-insensitive fallback
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(AGENT_DISPLAY_TO_KEY)) {
    if (k.toLowerCase() === lower) return v
  }
  return name
}

/**
 * Bidirectional agent name comparison.
 * Checks if a runtime name matches an expected identifier (English or Chinese).
 */
export function agentNameMatches(runtimeName: string | undefined | null, expected: string): boolean {
  if (!runtimeName || !expected) return false
  const a = runtimeName.toLowerCase()
  const b = expected.toLowerCase()
  if (a === b) return true
  // runtimeName might be Chinese → translate to English and compare
  const aKey = AGENT_DISPLAY_TO_KEY[runtimeName]
  if (aKey && aKey.toLowerCase() === b) return true
  // expected might be English → translate to Chinese and compare
  const bDisplay = getAgentDisplayName(expected)
  if (bDisplay !== expected && bDisplay.toLowerCase() === a) return true
  return false
}

/**
 * Get the reverse display mapping (Chinese → English key).
 * Uses case-insensitive lookup. Returns undefined if not found.
 */
export function reverseAgentDisplayName(displayName: string): string | undefined {
  const exact = AGENT_DISPLAY_TO_KEY[displayName]
  if (exact !== undefined) return exact
  const lower = displayName.toLowerCase()
  for (const [k, v] of Object.entries(AGENT_DISPLAY_TO_KEY)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}