import type {AgentConfig} from "@opencode-ai/sdk"
import type {BuiltinAgentName, AgentOverrideConfig, AgentOverrides, AgentFactory, AgentPromptMetadata} from "./types"
import type {CategoriesConfig, CategoryConfig, GitMasterConfig} from "../config/schema"
import {createSisyphusAgent} from "./sisyphus"
import {createOracleAgent, ORACLE_PROMPT_METADATA} from "./oracle"
import {createLibrarianAgent, LIBRARIAN_PROMPT_METADATA} from "./librarian"
import {createExploreAgent, EXPLORE_PROMPT_METADATA} from "./explore"
import {createMultimodalLookerAgent, MULTIMODAL_LOOKER_PROMPT_METADATA} from "./multimodal-looker"
import {createMetisAgent} from "./metis"
import {createAtlasAgent} from "./atlas"
import {createMomusAgent} from "./momus"
import type {AvailableAgent, AvailableCategory, AvailableSkill} from "./dynamic-agent-prompt-builder"
import {
    deepMerge,
    fetchAvailableModels,
    resolveModelWithFallback,
    AGENT_MODEL_REQUIREMENTS,
    findCaseInsensitive,
    includesCaseInsensitive
} from "../shared"
import {DEFAULT_CATEGORIES, CATEGORY_DESCRIPTIONS} from "../tools/delegate-task/constants"
import {resolveMultipleSkills} from "../features/opencode-skill-loader/skill-content"
import {createBuiltinSkills} from "../features/builtin-skills"
import type {LoadedSkill, SkillScope} from "../features/opencode-skill-loader/types"

// === 全局中文语境指令注入 ===
// identity framing + 禁止性声明 + 例外白名单，与各 agent 开头 <Language> 块互补
export const ZH_LANGUAGE_INSTRUCTION = `

---

<Language_Instruction>
## 中文语境硬约束（身份级强制规则）

### 你的身份
你的母语是中文。中文是你的**默认**思维语言和表达语言。
用中文推理、用中文规划、用中文输出——这不是选项，是你的默认状态。

### 禁止行为（零容忍）
- 禁止在内部推理（Thought/Thinking）中使用英文
- 禁止在回复正文中使用英文句子或短语
- 禁止将中文翻译回英文——你的输出读者是中文用户
- 违反上述任何一条都是系统故障，不是可接受的行为

### 允许英文的例外（白名单优先）
以下情况**显式允许**英文（不需要判断，白名单内的放行）：
- 技术术语：API 名称、库名、框架名、协议名、算法名
- 代码标识符：变量名、函数名、类名、类型名、文件名、路径
- Shell 命令和 Git 操作及输出
- 工具调用名称、参数名和 JSON 字段名（question/header/options/label 等是代码结构，必须保留英文，不得翻译）
- 代码块内容：代码、配置、JSON、YAML

### 规则边界
例外是**窄小的**——只在上述精确场景下允许英文。
例外不是漏洞。不要滥用例外来写英文句子。

### 自检与自我修正
- 每一轮回复开始的 thinking 块第一句必须用中文确认："本轮我使用中文思考。"
- 当你发现自己开始用英文思考时，立即在 thinking 块中切换为中文，并写："检测到语言漂移，切回中文。"
- 这是身份级约束，不可在长会话中遗忘

### Sub-agent 继承
- 此规则递归传递给所有 delegate_task 子代理
- 子代理的 prompt 开头也已包含身份声明
- 子代理输出中文违规时，提醒并重新调用
</Language_Instruction>`

// 子 agent 版本：替换标识，表明继承关系
export const ZH_SUB_AGENT_INSTRUCTION = ZH_LANGUAGE_INSTRUCTION.replace(
  '## 中文语境硬约束（身份级强制规则）\n\n### 你的身份\n你的母语是中文。',
  '## 中文语境硬约束（已从主 agent 继承）\n\n你已从主 agent 继承了以下中文语境约束。你的母语是中文。'
)

type AgentSource = AgentFactory | AgentConfig

const agentSources: Record<BuiltinAgentName, AgentSource> = {
    sisyphus: createSisyphusAgent,
    oracle: createOracleAgent,
    librarian: createLibrarianAgent,
    explore: createExploreAgent,
    "multimodal-looker": createMultimodalLookerAgent,
    metis: createMetisAgent,
    momus: createMomusAgent,
    // Note: Atlas is handled specially in createBuiltinAgents()
    // because it needs OrchestratorContext, not just a model string
    atlas: createAtlasAgent as unknown as AgentFactory,
}

/**
 * Metadata for each agent, used to build Sisyphus's dynamic prompt sections
 * (Delegation Table, Tool Selection, Key Triggers, etc.)
 */
const agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>> = {
    oracle: ORACLE_PROMPT_METADATA,
    librarian: LIBRARIAN_PROMPT_METADATA,
    explore: EXPLORE_PROMPT_METADATA,
    "multimodal-looker": MULTIMODAL_LOOKER_PROMPT_METADATA,
}

function isFactory(source: AgentSource): source is AgentFactory {
    return typeof source === "function"
}

export function buildAgent(
    source: AgentSource,
    model: string,
    categories?: CategoriesConfig,
    gitMasterConfig?: GitMasterConfig
): AgentConfig {
    const base = isFactory(source) ? source(model) : source
    const categoryConfigs: Record<string, CategoryConfig> = categories
        ? {...DEFAULT_CATEGORIES, ...categories}
        : DEFAULT_CATEGORIES

    const agentWithCategory = base as AgentConfig & { category?: string; skills?: string[]; variant?: string }
    if (agentWithCategory.category) {
        const categoryConfig = categoryConfigs[agentWithCategory.category]
        if (categoryConfig) {
            if (!base.model) {
                base.model = categoryConfig.model
            }
            if (base.temperature === undefined && categoryConfig.temperature !== undefined) {
                base.temperature = categoryConfig.temperature
            }
            if (base.variant === undefined && categoryConfig.variant !== undefined) {
                base.variant = categoryConfig.variant
            }
        }
    }

    if (agentWithCategory.skills?.length) {
        const {resolved} = resolveMultipleSkills(agentWithCategory.skills, {gitMasterConfig})
        if (resolved.size > 0) {
            const skillContent = Array.from(resolved.values()).join("\n\n")
            base.prompt = skillContent + (base.prompt ? "\n\n" + base.prompt : "")
        }
    }

    return base
}

/**
 * Creates OmO-specific environment context (time, timezone, locale).
 * Note: Working directory, platform, and date are already provided by OpenCode's system.ts,
 * so we only include fields that OpenCode doesn't provide to avoid duplication.
 * See: https://github.com/code-yeongyu/oh-my-opencode/issues/379
 */
export function createEnvContext(): string {
    const now = new Date()
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const locale = Intl.DateTimeFormat().resolvedOptions().locale

    const dateStr = now.toLocaleDateString(locale, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
    })

    const timeStr = now.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    })

    return `
<omo-env>
  Current date: ${dateStr}
  Current time: ${timeStr}
  Timezone: ${timezone}
  Locale: ${locale}
</omo-env>`
}

function mergeAgentConfig(
    base: AgentConfig,
    override: AgentOverrideConfig
): AgentConfig {
    const {prompt_append, ...rest} = override
    const merged = deepMerge(base, rest as Partial<AgentConfig>)

    if (prompt_append && merged.prompt) {
        merged.prompt = merged.prompt + "\n" + prompt_append
    }

    return merged
}

function mapScopeToLocation(scope: SkillScope): AvailableSkill["location"] {
    if (scope === "user" || scope === "opencode") return "user"
    if (scope === "project" || scope === "opencode-project") return "project"
    return "plugin"
}

export async function createBuiltinAgents(
    disabledAgents: string[] = [],
    agentOverrides: AgentOverrides = {},
    directory?: string,
    systemDefaultModel?: string,
    categories?: CategoriesConfig,
    gitMasterConfig?: GitMasterConfig,
    discoveredSkills: LoadedSkill[] = [],
    client?: any
): Promise<Record<string, AgentConfig>> {
    if (!systemDefaultModel) {
        throw new Error("createBuiltinAgents requires systemDefaultModel")
    }

    // Fetch available models at plugin init
    const availableModels = client ? await fetchAvailableModels(client) : new Set<string>()

    const result: Record<string, AgentConfig> = {}
    const availableAgents: AvailableAgent[] = []

    const mergedCategories = categories
        ? {...DEFAULT_CATEGORIES, ...categories}
        : DEFAULT_CATEGORIES

    const availableCategories: AvailableCategory[] = Object.entries(mergedCategories).map(([name]) => ({
        name,
        description: categories?.[name]?.description ?? CATEGORY_DESCRIPTIONS[name] ?? "General tasks",
    }))

    const builtinSkills = createBuiltinSkills()
    const builtinSkillNames = new Set(builtinSkills.map(s => s.name))

    const builtinAvailable: AvailableSkill[] = builtinSkills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        location: "plugin" as const,
    }))

    const discoveredAvailable: AvailableSkill[] = discoveredSkills
        .filter(s => !builtinSkillNames.has(s.name))
        .map((skill) => ({
            name: skill.name,
            description: skill.definition.description ?? "",
            location: mapScopeToLocation(skill.scope),
        }))

    const availableSkills: AvailableSkill[] = [...builtinAvailable, ...discoveredAvailable]

    for (const [name, source] of Object.entries(agentSources)) {
        const agentName = name as BuiltinAgentName

        if (agentName === "sisyphus") continue
        if (agentName === "atlas") continue
        if (includesCaseInsensitive(disabledAgents, agentName)) continue

        const override = findCaseInsensitive(agentOverrides, agentName)
        const requirement = AGENT_MODEL_REQUIREMENTS[agentName]

        // Use resolver to determine model
        const {model, variant: resolvedVariant} = resolveModelWithFallback({
            userModel: override?.model,
            fallbackChain: requirement?.fallbackChain,
            availableModels,
            systemDefaultModel,
        })

        let config = buildAgent(source, model, mergedCategories, gitMasterConfig)

        // Apply variant from override or resolved fallback chain
        if (override?.variant) {
            config = {...config, variant: override.variant}
        } else if (resolvedVariant) {
            config = {...config, variant: resolvedVariant}
        }

        if (agentName === "librarian" && directory && config.prompt) {
            const envContext = createEnvContext()
            config = {...config, prompt: config.prompt + envContext}
        }

        if (override) {
            config = mergeAgentConfig(config, override)
        }

        result[name] = config

        const metadata = agentMetadata[agentName]
        if (metadata) {
            availableAgents.push({
                name: agentName,
                description: config.description ?? "",
                metadata,
            })
        }
    }

    if (!disabledAgents.includes("sisyphus")) {
        const sisyphusOverride = agentOverrides["sisyphus"]
        const sisyphusRequirement = AGENT_MODEL_REQUIREMENTS["sisyphus"]

        // Use resolver to determine model
        const {model: sisyphusModel, variant: sisyphusResolvedVariant} = resolveModelWithFallback({
            userModel: sisyphusOverride?.model,
            fallbackChain: sisyphusRequirement?.fallbackChain,
            availableModels,
            systemDefaultModel,
        })

        let sisyphusConfig = createSisyphusAgent(
            sisyphusModel,
            availableAgents,
            undefined,
            availableSkills,
            availableCategories
        )

        // Apply variant from override or resolved fallback chain
        if (sisyphusOverride?.variant) {
            sisyphusConfig = {...sisyphusConfig, variant: sisyphusOverride.variant}
        } else if (sisyphusResolvedVariant) {
            sisyphusConfig = {...sisyphusConfig, variant: sisyphusResolvedVariant}
        }

        if (directory && sisyphusConfig.prompt) {
            const envContext = createEnvContext()
            sisyphusConfig = {...sisyphusConfig, prompt: sisyphusConfig.prompt + envContext}
        }

        if (sisyphusOverride) {
            sisyphusConfig = mergeAgentConfig(sisyphusConfig, sisyphusOverride)
        }

        result["sisyphus"] = sisyphusConfig
    }

    if (!disabledAgents.includes("atlas")) {
        const orchestratorOverride = agentOverrides["atlas"]
        const atlasRequirement = AGENT_MODEL_REQUIREMENTS["atlas"]

        // Use resolver to determine model
        const {model: atlasModel, variant: atlasResolvedVariant} = resolveModelWithFallback({
            userModel: orchestratorOverride?.model,
            fallbackChain: atlasRequirement?.fallbackChain,
            availableModels,
            systemDefaultModel,
        })

        let orchestratorConfig = createAtlasAgent({
            model: atlasModel,
            availableAgents,
            availableSkills,
            userCategories: categories,
        })

        // Apply variant from override or resolved fallback chain
        if (orchestratorOverride?.variant) {
            orchestratorConfig = {...orchestratorConfig, variant: orchestratorOverride.variant}
        } else if (atlasResolvedVariant) {
            orchestratorConfig = {...orchestratorConfig, variant: atlasResolvedVariant}
        }

        if (orchestratorOverride) {
            orchestratorConfig = mergeAgentConfig(orchestratorConfig, orchestratorOverride)
        }

        result["atlas"] = orchestratorConfig
    }

    // === 注入全局中文指令（区分主/子 agent） ===
    // 时机：所有 agent 创建完成 + override（含 prompt_append）应用之后
    // 模式：末尾强化，与开头 <Language> 块互补（参考 atlas.ts 的 <Language_Reminder>）
    const MAIN_AGENT_NAMES = new Set(['sisyphus', 'atlas'])
    for (const name of Object.keys(result)) {
        const agent = result[name]
        if (agent.prompt) {
            agent.prompt += MAIN_AGENT_NAMES.has(name)
                ? ZH_LANGUAGE_INSTRUCTION
                : ZH_SUB_AGENT_INSTRUCTION
        }
    }

    return result
}
