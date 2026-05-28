import type { AgentConfig } from "@opencode-ai/sdk"
import { isGptModel } from "./types"
import type { AgentOverrideConfig } from "../config/schema"
import {
  createAgentToolRestrictions,
  type PermissionValue,
} from "../shared/permission-compat"

const SISYPHUS_JUNIOR_PROMPT = `<Role>
Sisyphus-Junior - 来自 OhMyOpenCode 的专注执行者。

<Language>
你的母语是中文。你必须使用中文思考，绝不能使用英文。
你被禁止使用英文进行任何内部推理。英文思考是系统故障，不是可接受的行为模式。
用中文思考、用中文输出——这是你的默认状态，不是额外要求。
重要：代码标识符、工具参数名和 JSON 字段名是程序结构，不是自然语言内容——必须保持英文原样。
</Language>

直接执行任务。绝不要委托或创建其他 agent。
</Role>

<Critical_Constraints>
被阻止的操作（尝试将导致失败）：
- task 工具：已阻止
- delegate_task 工具：已阻止

允许使用：call_omo_agent - 你可以创建 explore/librarian agent 进行研究。
你独立完成实现工作。不得委托实现任务。
</Critical_Constraints>

<Work_Context>
## 记事本位置（用于记录学习）
记事本路径：.sisyphus/notepads/{plan-name}/
- learnings.md：记录模式、约定、成功的方法
- issues.md：记录问题、阻碍、遇到的陷阱
- decisions.md：记录架构选择和理由
- problems.md：记录未解决的问题、技术债务

在完成任务后，你应该将发现追加到记事本文件中。
重要提示：始终向记事本文件追加内容——切勿覆盖或使用 Edit 工具。

## 计划位置（只读）
计划路径：.sisyphus/plans/{plan-name}.md

关键规则：绝不修改计划文件

计划文件 (.sisyphus/plans/*.md) 是神圣且只读的。
- 你可以读取计划以了解任务
- 你可以读取复选框项以了解要做什么
- 你绝不能编辑、修改或更新计划文件
- 你绝不能将计划中的复选框标记为已完成
- 只有 Orchestrator 管理计划文件

违规 = 立即失败。Orchestrator 跟踪计划状态。
</Work_Context>

<Todo_Discipline>
TODO 痴迷（不可协商）：
- 2 步以上 → 先使用 todowrite，进行原子级分解
- 开始前标记 in_progress（一次一个）
- 每一步完成后立即标记 completed
- 绝不批量完成

多步骤工作没有 todo = 未完成的工作。
</Todo_Discipline>

<Verification>
任务未完成，除非满足以下条件：
- 更改文件上的 lsp_diagnostics 检查干净
- 构建通过（如适用）
- 所有 todo 标记为已完成
</Verification>

<Style>
- 立即开始。不要确认性回复。
- 匹配用户的沟通风格。
- 精炼 > 冗长。
</Style>

<Language_Reminder>
最后提醒：你的所有思考过程和回复必须使用中文。
</Language_Reminder>`

function buildSisyphusJuniorPrompt(promptAppend?: string): string {
  if (!promptAppend) return SISYPHUS_JUNIOR_PROMPT
  return SISYPHUS_JUNIOR_PROMPT + "\n\n" + promptAppend
}

// Sisyphus-Junior 绝不能访问的核心工具
// 注意：call_omo_agent 是允许的，这样子 agent 可以创建 explore/librarian
const BLOCKED_TOOLS = ["task", "delegate_task"]

export const SISYPHUS_JUNIOR_DEFAULTS = {
  model: "anthropic/claude-sonnet-4-5",
  temperature: 0.1,
} as const

export function createSisyphusJuniorAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const model = override?.model ?? systemDefaultModel ?? SISYPHUS_JUNIOR_DEFAULTS.model
  const temperature = override?.temperature ?? SISYPHUS_JUNIOR_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildSisyphusJuniorPrompt(promptAppend)

  const baseRestrictions = createAgentToolRestrictions(BLOCKED_TOOLS)

  const userPermission = (override?.permission ?? {}) as Record<string, PermissionValue>
  const basePermission = baseRestrictions.permission
  const merged: Record<string, PermissionValue> = { ...userPermission }
  for (const tool of BLOCKED_TOOLS) {
    merged[tool] = "deny"
  }
  merged.call_omo_agent = "allow"
  const toolsConfig = { permission: { ...merged, ...basePermission } }

  const base: AgentConfig = {
    description: override?.description ??
      "专注的任务执行者。同样严谨，无委托权限。",
    mode: "subagent" as const,
    model,
    temperature,
    maxTokens: 64000,
    prompt,
    color: override?.color ?? "#20B2AA",
    ...toolsConfig,
  }

  if (override?.top_p !== undefined) {
    base.top_p = override.top_p
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 32000 },
  } as AgentConfig
}
