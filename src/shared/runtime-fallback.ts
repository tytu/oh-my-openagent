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

export interface FallbackNextResult {
  kind: "next"
  model: FallbackModel
  attempts: FallbackAttempt[]
}

export interface FallbackExhaustedResult {
  kind: "exhausted"
  attempts: FallbackAttempt[]
  lastErrorClassification?: ProviderErrorClassification
}

export type FallbackResult = FallbackNextResult | FallbackExhaustedResult

export interface RuntimeFallbackInput {
  agent?: string
  category?: string
  currentModel: FallbackModel
  attempts: FallbackAttempt[]
  availableModels?: Set<string>
  lastErrorClassification?: ProviderErrorClassification
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
function getChain(agent?: string, category?: string): FallbackEntry[] {
  if (agent && AGENT_MODEL_REQUIREMENTS[agent]) {
    return AGENT_MODEL_REQUIREMENTS[agent].fallbackChain
  }
  if (category && CATEGORY_MODEL_REQUIREMENTS[category]) {
    return CATEGORY_MODEL_REQUIREMENTS[category].fallbackChain
  }
  throw new Error(
    `No fallback chain found for agent="${agent ?? ""}" category="${category ?? ""}"`,
  )
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
  } = input

  // 1. 获取 fallback chain
  const chain = getChain(agent, category)

  // 2. 展开 chain 为候选列表
  const candidates = expandChain(chain)

  // 3. 构建需要跳过的 model 集合
  const skipKeys = new Set<string>()
  skipKeys.add(modelKey(currentModel))
  for (const a of attempts) {
    skipKeys.add(modelKey(a.model))
  }

  // 4. 构建 result attempts（包含 currentModel）
  const resultAttempts = [...attempts]
  const currentKey = modelKey(currentModel)
  const isInAttempts = attempts.some((a) => modelKey(a.model) === currentKey)
  if (!isInAttempts) {
    resultAttempts.push({ model: currentModel })
  }

  // 5. 遍历候选，跳过已尝试的，检查可用性
  const hasAvailabilityFilter = availableModels != null && availableModels.size > 0

  for (const candidate of candidates) {
    const key = modelKey(candidate)

    // 跳过已尝试的 model
    if (skipKeys.has(key)) continue

    // 如果有可用模型过滤，检查候选是否可用
    if (hasAvailabilityFilter) {
      const match = fuzzyMatchModel(key, availableModels!, [candidate.providerID])
      if (!match) continue
    }

    // 找到有效候选
    return {
      kind: "next",
      model: candidate,
      attempts: resultAttempts,
    }
  }

  // 6. 没有有效候选，返回 exhausted
  return {
    kind: "exhausted",
    attempts: resultAttempts,
    lastErrorClassification,
  }
}
