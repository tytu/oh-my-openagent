/**
 * Runtime Fallback Decision Service
 *
 * 纯函数：根据 agent/category 的 fallback chain，结合当前失败状态和可用模型，
 * 决定下一个要尝试的模型。
 */

import { fuzzyMatchModel } from "./model-availability"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type FallbackEntry,
} from "./model-requirements"
import type { ProviderErrorClassification } from "./provider-error-classifier"

export interface FallbackModel {
  providerID: string
  modelID: string
  variant?: string
}

export interface FallbackAttempt {
  model: FallbackModel
  error?: ProviderErrorClassification
}

export interface FallbackSkip {
  model?: FallbackModel
  reason: string
}

export interface FallbackNextResult {
  kind: "next"
  model: FallbackModel
  attempts: FallbackAttempt[]
  skipped?: FallbackSkip[]
}

export interface FallbackExhaustedResult {
  kind: "exhausted"
  attempts: FallbackAttempt[]
  reason: string
  skipped?: FallbackSkip[]
  lastErrorClassification?: ProviderErrorClassification
}

export interface FallbackUnconfiguredResult {
  kind: "unconfigured"
  reason: string
  skipped?: FallbackSkip[]
}

export type FallbackResult = FallbackNextResult | FallbackExhaustedResult | FallbackUnconfiguredResult

export interface RuntimeFallbackInput {
  agent?: string
  category?: string
  currentModel: FallbackModel
  attempts: FallbackAttempt[]
  availableModels?: Set<string>
  lastErrorClassification?: ProviderErrorClassification
  configuredFallbackModels?: FallbackModel[]
  maxAttempts?: number
}

/**
 * 将 FallbackEntry[] 展开为 FallbackModel[]（每个 provider × model 组合）
 */
function expandChain(chain: FallbackEntry[]): FallbackModel[] {
  const candidates: FallbackModel[] = []
  for (const entry of chain) {
    for (const provider of entry.providers) {
      candidates.push({
        providerID: provider,
        modelID: entry.model,
        variant: entry.variant,
      })
    }
  }
  return candidates
}

/**
 * 生成 model 的唯一键用于去重比较
 */
function modelKey(m: FallbackModel): string {
  return `${m.providerID}/${m.modelID}`
}

/**
 * 从 AGENT_MODEL_REQUIREMENTS 或 CATEGORY_MODEL_REQUIREMENTS 获取 fallback chain
 */
function getChain(agent?: string, category?: string): FallbackEntry[] | undefined {
  if (agent && AGENT_MODEL_REQUIREMENTS[agent]) {
    return AGENT_MODEL_REQUIREMENTS[agent].fallbackChain
  }
  if (category && CATEGORY_MODEL_REQUIREMENTS[category]) {
    return CATEGORY_MODEL_REQUIREMENTS[category].fallbackChain
  }
  return undefined
}

/**
 * 解析下一个 fallback 模型
 *
 * 逻辑：
 * 1. 从 AGENT_MODEL_REQUIREMENTS 或 CATEGORY_MODEL_REQUIREMENTS 获取 fallbackChain
 * 2. 将 chain 展开为候选列表（每个 provider × model 组合，保持顺序）
 * 3. 跳过 currentModel 和 attempts 中的 model
 * 4. 如果 availableModels 非空，使用 fuzzyMatchModel 检查可用性
 * 5. 返回第一个有效候选，或 exhausted
 */
export function resolveNextFallbackModel(input: RuntimeFallbackInput): FallbackResult {
  const {
    agent,
    category,
    currentModel,
    attempts,
    availableModels,
    lastErrorClassification,
    configuredFallbackModels,
    maxAttempts,
  } = input

  if (maxAttempts !== undefined && attempts.length >= maxAttempts) {
    return {
      kind: "exhausted",
      attempts,
      reason: "max fallback attempts reached",
      lastErrorClassification,
    }
  }

  const chain = getChain(agent, category)
  const candidates = configuredFallbackModels && configuredFallbackModels.length > 0
    ? configuredFallbackModels
    : chain ? expandChain(chain) : undefined

  if (!candidates) {
    return {
      kind: "unconfigured",
      reason: `No fallback chain found for agent="${agent ?? ""}" category="${category ?? ""}"`,
    }
  }

  const skipKeys = new Set<string>()
  skipKeys.add(modelKey(currentModel))
  for (const a of attempts) {
    skipKeys.add(modelKey(a.model))
  }

  const skipped: FallbackSkip[] = []
  const hasAvailabilityFilter = availableModels != null && availableModels.size > 0

  for (const candidate of candidates) {
    const key = modelKey(candidate)

    if (skipKeys.has(key)) {
      skipped.push({ model: candidate, reason: "already attempted or current model" })
      continue
    }

    if (hasAvailabilityFilter) {
      const match = fuzzyMatchModel(key, availableModels!, [candidate.providerID])
      if (!match) {
        skipped.push({ model: candidate, reason: "model unavailable" })
        continue
      }
    }

    return {
      kind: "next",
      model: candidate,
      attempts,
      skipped,
    }
  }

  return {
    kind: "exhausted",
    attempts,
    reason: "No fallback candidates available",
    skipped,
    lastErrorClassification,
  }
}
