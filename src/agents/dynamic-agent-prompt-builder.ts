import type { AgentPromptMetadata, BuiltinAgentName } from "./types"
import { agentNameMatches, resolveToEnglishKey } from "../shared/agent-display-names"

export interface AvailableAgent {
  name: BuiltinAgentName
  description: string
  metadata: AgentPromptMetadata
}

export interface AvailableTool {
  name: string
  category: "lsp" | "ast" | "search" | "session" | "command" | "other"
}

export interface AvailableSkill {
  name: string
  description: string
  location: "user" | "project" | "plugin"
}

export interface AvailableCategory {
  name: string
  description: string
}

export function categorizeTools(toolNames: string[]): AvailableTool[] {
  return toolNames.map((name) => {
    let category: AvailableTool["category"] = "other"
    if (name.startsWith("lsp_")) {
      category = "lsp"
    } else if (name.startsWith("ast_grep")) {
      category = "ast"
    } else if (name === "grep" || name === "glob") {
      category = "search"
    } else if (name.startsWith("session_")) {
      category = "session"
    } else if (name === "slashcommand") {
      category = "command"
    }
    return { name, category }
  })
}

function formatToolsForPrompt(tools: AvailableTool[]): string {
  const lspTools = tools.filter((t) => t.category === "lsp")
  const astTools = tools.filter((t) => t.category === "ast")
  const searchTools = tools.filter((t) => t.category === "search")

  const parts: string[] = []

  if (searchTools.length > 0) {
    parts.push(...searchTools.map((t) => `\`${t.name}\``))
  }

  if (lspTools.length > 0) {
    parts.push("`lsp_*`")
  }

  if (astTools.length > 0) {
    parts.push("`ast_grep`")
  }

  return parts.join(", ")
}

export function buildKeyTriggersSection(agents: AvailableAgent[], _skills: AvailableSkill[] = []): string {
  const keyTriggers = agents
    .filter((a) => a.metadata.keyTrigger)
    .map((a) => `- ${a.metadata.keyTrigger}`)

  if (keyTriggers.length === 0) return ""

  return `### 关键触发条件（分类前请检查）：

${keyTriggers.join("\n")}
- **"查看" + "创建 PR"** → 不仅仅是研究。预期需要完整的实现周期。`
}

export function buildToolSelectionTable(
  agents: AvailableAgent[],
  tools: AvailableTool[] = [],
  _skills: AvailableSkill[] = []
): string {
  const rows: string[] = [
    "### 工具和 Agent 选择：",
    "",
  ]

  rows.push("| 资源 | 成本 | 何时使用 |")
  rows.push("|----------|------|-------------|")

  if (tools.length > 0) {
    const toolsDisplay = formatToolsForPrompt(tools)
    rows.push(`| ${toolsDisplay} | 免费 | 不复杂、范围清晰、无隐含假设 |`)
  }

  const costOrder: Record<string, number> = { FREE: 0, CHEAP: 1, EXPENSIVE: 2 }
  const costLabels: Record<string, string> = { FREE: "免费", CHEAP: "低成本", EXPENSIVE: "高成本" }
  const sortedAgents = [...agents]
    .filter((a) => a.metadata.category !== "utility")
    .sort((a, b) => costOrder[a.metadata.cost] - costOrder[b.metadata.cost])

  for (const agent of sortedAgents) {
    const shortDesc = agent.description.split(".")[0] || agent.description
    rows.push(`| \`${agent.name}\` agent | ${costLabels[agent.metadata.cost] ?? agent.metadata.cost} | ${shortDesc} |`)
  }

  rows.push("")
  rows.push("**默认流程**：explore/librarian（后台）+ 工具 → oracle（如果需要）")

  return rows.join("\n")
}

export function buildExploreSection(agents: AvailableAgent[]): string {
  const exploreAgent = agents.find((a) => agentNameMatches(a.name, "explore"))
  if (!exploreAgent) return ""

  const useWhen = exploreAgent.metadata.useWhen || []
  const avoidWhen = exploreAgent.metadata.avoidWhen || []

  return `### Explore Agent = 上下文 Grep

将其用作 **对等工具**，而非后备方案。大胆使用。

| 使用直接工具 | 使用 Explore Agent |
|------------------|-------------------|
${avoidWhen.map((w) => `| ${w} |  |`).join("\n")}
${useWhen.map((w) => `|  | ${w} |`).join("\n")}`
}

export function buildLibrarianSection(agents: AvailableAgent[]): string {
  const librarianAgent = agents.find((a) => agentNameMatches(a.name, "librarian"))
  if (!librarianAgent) return ""

  const useWhen = librarianAgent.metadata.useWhen || []

  return `### Librarian Agent = 参考 Grep

搜索 **外部参考资料**（文档、开源、网络）。当涉及不熟悉的库时主动触发。

| 上下文 Grep（内部） | 参考 Grep（外部） |
|----------------------------|---------------------------|
| 搜索我们的代码库 | 搜索外部资源 |
| 在此仓库中查找模式 | 在其他仓库中查找示例 |
| 我们的代码如何工作？ | 这个库如何工作？ |
| 项目特定逻辑 | 官方 API 文档 |
| | 库的最佳实践与特性 |
| | 开源实现示例 |

**触发短语**（立即触发 librarian）：
${useWhen.map((w) => `- "${w}"`).join("\n")}`
}

export function buildDelegationTable(agents: AvailableAgent[]): string {
  const rows: string[] = [
    "### 委托表：",
    "",
    "| 领域 | 委托给 | 触发条件 |",
    "|--------|-------------|---------|",
  ]

  for (const agent of agents) {
    for (const trigger of agent.metadata.triggers) {
      rows.push(`| ${trigger.domain} | \`${agent.name}\` | ${trigger.trigger} |`)
    }
  }

  return rows.join("\n")
}

export function buildCategorySkillsDelegationGuide(categories: AvailableCategory[], skills: AvailableSkill[]): string {
  if (categories.length === 0 && skills.length === 0) return ""

  const categoryRows = categories.map((c) => {
    const desc = c.description || c.name
    return `| \`${c.name}\` | ${desc} |`
  })

  const skillRows = skills.map((s) => {
    const desc = s.description.split(".")[0] || s.description
    return `| \`${s.name}\` | ${desc} |`
  })

  return `### 类别 + 技能委托系统

**delegate_task() 结合类别和技能以实现最优任务执行。**

#### 可用类别（领域优化模型）

每个类别都配置了针对该领域优化的模型。阅读描述以了解何时使用。

| 类别 | 领域 / 最佳用途 |
|----------|-------------------|
${categoryRows.join("\n")}

#### 可用技能（领域专业知识注入）

技能将专业指令注入子 agent。阅读描述以了解每个技能的适用场景。

| 技能 | 专业领域 |
|-------|------------------|
${skillRows.join("\n")}

---

### 强制要求：类别 + 技能选择协议

**第 1 步：选择类别**
- 阅读每个类别的描述
- 将任务需求与类别领域匹配
- 选择领域最符合任务的类别

**第 2 步：评估所有技能**
对于上面列出的每个技能，问自己：
> "这个技能的专业领域与我的任务有重叠吗？"

- 如果是 → 包含在 \`load_skills=[...]\` 中
- 如果否 → 你必须说明原因（见下文）

**第 3 步：说明排除理由**

如果你选择不包含某个可能相关的技能，你必须提供：

\`\`\`
技能评估 "[技能名称]"：
- 技能领域：[技能描述的内容]
- 任务领域：[你的任务内容]
- 决定：排除
- 原因：[为什么领域不重叠的具体解释]
\`\`\`

**为什么必须说明理由：**
- 迫使你实际阅读技能描述
- 防止懒惰地排除可能有用的技能
- 子 agent 是无状态的——它们只知道你告诉它们的内容
- 遗漏相关技能 = 次优输出

---

### 委托模式

\`\`\`typescript
delegate_task(
  category="[selected-category]",
  load_skills=["skill-1", "skill-2"],  // 包含所有相关技能
  prompt="..."
)
\`\`\`

**反模式（会产生不良结果）：**
\`\`\`typescript
delegate_task(category="...", load_skills=[], prompt="...")  // 无理由的空 load_skills
\`\`\``
}

export function buildOracleSection(agents: AvailableAgent[]): string {
  const oracleAgent = agents.find((a) => agentNameMatches(a.name, "oracle"))
  if (!oracleAgent) return ""

  const useWhen = oracleAgent.metadata.useWhen || []
  const avoidWhen = oracleAgent.metadata.avoidWhen || []

  return `<Oracle_Usage>
## Oracle — 只读高 IQ 顾问

Oracle 是一个只读、成本较高、高质量推理模型，用于调试和架构设计。仅限咨询。

### 何时咨询：

| 触发条件 | 操作 |
|---------|--------|
${useWhen.map((w) => `| ${w} | 先咨询 Oracle，然后实现 |`).join("\n")}

### 何时不咨询：

${avoidWhen.map((w) => `- ${w}`).join("\n")}

### 使用模式：
在调用前简要声明 "正在咨询 Oracle，原因：[原因]"。

**例外**：这是唯一需要在行动前声明的情况。对于所有其他工作，立即开始，无需状态更新。
</Oracle_Usage>`
}

export function buildHardBlocksSection(): string {
  const blocks = [
    "| 类型错误抑制（`as any`、`@ts-ignore`）| 绝不允许 |",
    "| 未经明确请求就提交 | 绝不允许 |",
    "| 猜测未读代码 | 绝不允许 |",
    "| 失败后让代码保持损坏状态 | 绝不允许 |",
  ]

  return `## 硬性禁止（绝不可违反）

| 约束 | 无例外 |
|------------|---------------|
${blocks.join("\n")}`
}

export function buildAntiPatternsSection(): string {
  const patterns = [
    "| **类型安全** | `as any`, `@ts-ignore`, `@ts-expect-error` |",
    "| **错误处理** | 空的 catch 块 `catch(e) {}` |",
    "| **测试** | 删除失败的测试来通过 |",
    "| **搜索** | 为单行拼写错误或明显语法错误触发 agent |",
    "| **调试** | 散射调试、随机更改 |",
  ]

  return `## 反模式（阻塞性违规）

| 类别 | 禁止行为 |
|----------|-----------|
${patterns.join("\n")}`
}

export function buildUltraworkSection(
  agents: AvailableAgent[],
  categories: AvailableCategory[],
  skills: AvailableSkill[]
): string {
  const lines: string[] = []

  if (categories.length > 0) {
    lines.push("**类别**（用于实现任务）：")
    for (const cat of categories) {
      const shortDesc = cat.description || cat.name
      lines.push(`- \`${cat.name}\`: ${shortDesc}`)
    }
    lines.push("")
  }

  if (skills.length > 0) {
    lines.push("**技能**（与类别结合使用——评估所有技能的相关性）：")
    for (const skill of skills) {
      const shortDesc = skill.description.split(".")[0] || skill.description
      lines.push(`- \`${skill.name}\`: ${shortDesc}`)
    }
    lines.push("")
  }

  if (agents.length > 0) {
    const ultraworkAgentPriority = ["explore", "librarian", "plan", "oracle"]
    const sortedAgents = [...agents].sort((a, b) => {
      const aIdx = ultraworkAgentPriority.indexOf(resolveToEnglishKey(a.name))
      const bIdx = ultraworkAgentPriority.indexOf(resolveToEnglishKey(b.name))
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })

    lines.push("**Agent**（用于专业咨询/探索）：")
    for (const agent of sortedAgents) {
      const shortDesc = agent.description.split(".")[0] || agent.description
      const suffix = agentNameMatches(agent.name, "explore") || agentNameMatches(agent.name, "librarian") ? "（可多个）" : ""
      lines.push(`- \`${agent.name}${suffix}\`: ${shortDesc}`)
    }
  }

  return lines.join("\n")
}
