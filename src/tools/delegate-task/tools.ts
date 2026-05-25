import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { BackgroundManager } from "../../features/background-agent"
import type { DelegateTaskArgs } from "./types"
import type { CategoryConfig, CategoriesConfig, FallbackModelEntry, GitMasterConfig, RuntimeFallbackConfig } from "../../config/schema"
import { DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS, CATEGORY_DESCRIPTIONS } from "./constants"
import { findNearestMessageWithFields, findFirstMessageWithAgent, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { resolveMultipleSkillsAsync } from "../../features/opencode-skill-loader/skill-content"
import { discoverSkills } from "../../features/opencode-skill-loader"
import { getTaskToastManager } from "../../features/task-toast-manager"
import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import { subagentSessions, getSessionAgent } from "../../features/claude-code-session-state"
import { log, getAgentToolRestrictions, resolveModel, getOpenCodeConfigPaths, findByNameCaseInsensitive, equalsIgnoreCase, PerfTimer } from "../../shared"
import { fetchAvailableModels } from "../../shared/model-availability"
import { resolveModelWithFallback } from "../../shared/model-resolver"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { classifyProviderError } from "../../shared/provider-error-classifier"
import { resolveNextFallbackModel, type FallbackAttempt, type FallbackModel } from "../../shared/runtime-fallback"

type OpencodeClient = PluginInput["client"]

const SISYPHUS_JUNIOR_AGENT = "sisyphus-junior"

function parseModelString(model: string): { providerID: string; modelID: string } | undefined {
  const parts = model.split("/")
  if (parts.length >= 2) {
    return { providerID: parts[0], modelID: parts.slice(1).join("/") }
  }
  return undefined
}

function parseFallbackModelEntries(entries?: FallbackModelEntry[]): FallbackModel[] | undefined {
  return entries?.map((entry) => {
    if ("model" in entry) {
      const parsed = parseModelString(entry.model)
      return {
        providerID: parsed?.providerID ?? "",
        modelID: parsed?.modelID ?? entry.model,
        variant: entry.variant,
      }
    }
    return entry
  })
}

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

interface ErrorContext {
  operation: string
  args?: DelegateTaskArgs
  sessionID?: string
  agent?: string
  category?: string
}

function formatDetailedError(error: unknown, ctx: ErrorContext): string {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  const lines: string[] = [
    `${ctx.operation} 失败`,
    "",
    `**错误**: ${message}`,
  ]

  if (ctx.sessionID) {
    lines.push(`**Session ID**: ${ctx.sessionID}`)
  }

  if (ctx.agent) {
    lines.push(`**Agent**: ${ctx.agent}${ctx.category ? ` (category: ${ctx.category})` : ""}`)
  }

  if (ctx.args) {
    lines.push("", "**参数**:")
    lines.push(`- description: "${ctx.args.description}"`)
    lines.push(`- category: ${ctx.args.category ?? "(无)"}`)
    lines.push(`- subagent_type: ${ctx.args.subagent_type ?? "(无)"}`)
    lines.push(`- run_in_background: ${ctx.args.run_in_background}`)
    lines.push(`- load_skills: [${ctx.args.load_skills?.join(", ") ?? ""}]`)
    if (ctx.args.session_id) {
      lines.push(`- session_id: ${ctx.args.session_id}`)
    }
  }

  if (stack) {
    lines.push("", "**堆栈跟踪**:")
    lines.push("```")
    lines.push(stack.split("\n").slice(0, 10).join("\n"))
    lines.push("```")
  }

  return lines.join("\n")
}

type ToolContextWithMetadata = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
}

export function resolveCategoryConfig(
  categoryName: string,
  options: {
    userCategories?: CategoriesConfig
    inheritedModel?: string
    systemDefaultModel: string
  }
): { config: CategoryConfig; promptAppend: string; model: string } | null {
  const { userCategories, inheritedModel, systemDefaultModel } = options
  const defaultConfig = DEFAULT_CATEGORIES[categoryName]
  const userConfig = userCategories?.[categoryName]
  const defaultPromptAppend = CATEGORY_PROMPT_APPENDS[categoryName] ?? ""

  if (!defaultConfig && !userConfig) {
    return null
  }

  // Model priority for categories: user override > category default > system default
  // Categories have explicit models - no inheritance from parent session
  const model = resolveModel({
    userModel: userConfig?.model,
    inheritedModel: defaultConfig?.model, // Category's built-in model takes precedence over system default
    systemDefault: systemDefaultModel,
  })
  const config: CategoryConfig = {
    ...defaultConfig,
    ...userConfig,
    model,
    variant: userConfig?.variant ?? defaultConfig?.variant,
  }

  let promptAppend = defaultPromptAppend
  if (userConfig?.prompt_append) {
    promptAppend = defaultPromptAppend
      ? defaultPromptAppend + "\n\n" + userConfig.prompt_append
      : userConfig.prompt_append
  }

  return { config, promptAppend, model }
}

export interface DelegateTaskToolOptions {
  manager: BackgroundManager
  client: OpencodeClient
  directory: string
  userCategories?: CategoriesConfig
  gitMasterConfig?: GitMasterConfig
  sisyphusJuniorModel?: string
  runtimeFallbackConfig?: RuntimeFallbackConfig
  agentFallbackModels?: Record<string, FallbackModelEntry[] | undefined>
}

export interface BuildSystemContentInput {
  skillContent?: string
  categoryPromptAppend?: string
}

export function buildSystemContent(input: BuildSystemContentInput): string | undefined {
  const { skillContent, categoryPromptAppend } = input

  if (!skillContent && !categoryPromptAppend) {
    return undefined
  }

  if (skillContent && categoryPromptAppend) {
    return `${skillContent}\n\n${categoryPromptAppend}`
  }

  return skillContent || categoryPromptAppend
}

export function createDelegateTask(options: DelegateTaskToolOptions): ToolDefinition {
  const { manager, client, directory, userCategories, gitMasterConfig, sisyphusJuniorModel, runtimeFallbackConfig, agentFallbackModels } = options

  const allCategories = { ...DEFAULT_CATEGORIES, ...userCategories }
  const getConfiguredFallbackModels = (agent?: string, category?: string) => {
    const agentModels = agent ? agentFallbackModels?.[agent] : undefined
    if (agentModels) return parseFallbackModelEntries(agentModels)
    const categoryModels = category ? userCategories?.[category]?.fallback_models : undefined
    return parseFallbackModelEntries(categoryModels)
  }
  const categoryNames = Object.keys(allCategories)
  const categoryExamples = categoryNames.map(k => `'${k}'`).join(", ")

  const categoryList = categoryNames.map(name => {
    const userDesc = userCategories?.[name]?.description
    const builtinDesc = CATEGORY_DESCRIPTIONS[name]
    const desc = userDesc || builtinDesc
    return desc ? `  - ${name}: ${desc}` : `  - ${name}`
  }).join("\n")

  const description = `启动带有分类或直接指定 agent 的任务。

互斥参数：提供 category 或 subagent_type 之一，两者不可同时提供（继续 session 时除外）。

- load_skills: 始终必填。传入至少一个 skill 名称（例如 ["playwright"]、["git-master", "frontend-ui-ux"]）。
- category: 使用预定义分类 → 使用分类配置启动 Sisyphus-Junior
  可用分类：
${categoryList}
- subagent_type: 直接使用指定的 agent（例如 "oracle"、"explore"）
- run_in_background: true=异步（返回 task_id），false=同步（等待结果）。默认值: false。仅在并行探索 5+ 个独立查询时使用 background=true。
- session_id: 要继续的现有 Task session（来自之前任务的输出）。继续后保留完整上下文 — 节省 token，保持连续性。
- command: 触发此任务的命令（可选，用于斜杠命令追踪）。

**何时使用 session_id：**
- 任务失败/未完成 → 使用 session_id 配合 "fix: [具体问题]"
- 需要在之前结果上继续 → 使用 session_id 追加问题
- 与同一 agent 多轮对话 → 始终使用 session_id 而非新建任务

Prompts 必须为中文。`

  return tool({
    description,
    args: {
      load_skills: tool.schema.array(tool.schema.string()).describe("要注入的 Skill 名称。必填 — 如无需 skills 传入 []，但强烈建议传入正确的 skills 如 [\"playwright\"]、[\"git-master\"] 以获得最佳效果。"),
      description: tool.schema.string().describe("任务简短描述（3-5 个词）"),
      prompt: tool.schema.string().describe("agent 的完整详细 prompt"),
      run_in_background: tool.schema.boolean().describe("true=异步（返回 task_id），false=同步（等待）。默认值: false"),
      category: tool.schema.string().optional().describe(`分类（例如 ${categoryExamples}）。与 subagent_type 互斥。`),
      subagent_type: tool.schema.string().optional().describe("Agent 名称（例如 'oracle'、'explore'）。与 category 互斥。"),
      session_id: tool.schema.string().optional().describe("要继续的现有 Task session"),
      command: tool.schema.string().optional().describe("触发此任务的命令"),
    },
    async execute(args: DelegateTaskArgs, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata
      if (args.run_in_background === undefined) {
        throw new Error(`参数错误：'run_in_background' 参数必填。任务委托使用 run_in_background=false，仅在并行探索时使用 run_in_background=true。`)
      }
      if (args.load_skills === undefined) {
        throw new Error(`参数错误：'load_skills' 参数必填。如无需 skills 传入 []，但强烈建议传入正确的 skills 如 ["playwright"]、["git-master"] 以获得最佳效果。`)
      }
      if (args.load_skills === null) {
        throw new Error(`参数错误：不允许 load_skills=null。如无需 skills 传入 []，但强烈建议传入正确的 skills。`)
      }
      const runInBackground = args.run_in_background === true

      let skillContent: string | undefined
      if (args.load_skills.length > 0) {
        const { resolved, notFound } = await resolveMultipleSkillsAsync(args.load_skills, { gitMasterConfig })
        if (notFound.length > 0) {
          const allSkills = await discoverSkills({ includeClaudeCodePaths: true })
          const available = allSkills.map(s => s.name).join(", ")
          return `未找到技能：${notFound.join(", ")}。可用技能：${available}`
        }
        skillContent = Array.from(resolved.values()).join("\n\n")
      }

      const messageDir = getMessageDir(ctx.sessionID)
      const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
      const firstMessageAgent = messageDir ? findFirstMessageWithAgent(messageDir) : null
      const sessionAgent = getSessionAgent(ctx.sessionID)
      const parentAgent = ctx.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent

      log("[delegate_task] parentAgent resolution", {
        sessionID: ctx.sessionID,
        messageDir,
        ctxAgent: ctx.agent,
        sessionAgent,
        firstMessageAgent,
        prevMessageAgent: prevMessage?.agent,
        resolvedParentAgent: parentAgent,
      })
      const parentModel = prevMessage?.model?.providerID && prevMessage?.model?.modelID
        ? { providerID: prevMessage.model.providerID, modelID: prevMessage.model.modelID }
        : undefined

      if (args.session_id) {
        if (runInBackground) {
          try {
            const task = await manager.resume({
              sessionId: args.session_id,
              prompt: args.prompt,
              parentSessionID: ctx.sessionID,
              parentMessageID: ctx.messageID,
              parentModel,
              parentAgent,
            })

            ctx.metadata?.({
              title: `Continue: ${task.description}`,
              metadata: {
                prompt: args.prompt,
                agent: task.agent,
                load_skills: args.load_skills,
                description: args.description,
                run_in_background: args.run_in_background,
                sessionId: task.sessionID,
                command: args.command,
              },
            })

            return `后台任务已继续。

            任务ID：${task.id}
            会话ID：${task.sessionID}
            描述：${task.description}
            代理：${task.agent}
            状态：${task.status}

Agent 继续执行，保留完整上下文。
使用 \`background_output\` 并传入 task_id="${task.id}" 查看进度。`
          } catch (error) {
            return formatDetailedError(error, {
              operation: "继续后台任务",
              args,
              sessionID: args.session_id,
            })
          }
        }

        const toastManager = getTaskToastManager()
        const taskId = `resume_sync_${args.session_id.slice(0, 8)}`
        const startTime = new Date()

        if (toastManager) {
          toastManager.addTask({
            id: taskId,
            description: args.description,
            agent: "continue",
            isBackground: false,
          })
        }

        ctx.metadata?.({
          title: `Continue: ${args.description}`,
          metadata: {
            prompt: args.prompt,
            load_skills: args.load_skills,
            description: args.description,
            run_in_background: args.run_in_background,
            sessionId: args.session_id,
            sync: true,
            command: args.command,
          },
        })

        try {
          let resumeAgent: string | undefined
          let resumeModel: { providerID: string; modelID: string } | undefined

          try {
            const messagesResp = await client.session.messages({ path: { id: args.session_id } })
            const messages = (messagesResp.data ?? []) as Array<{
              info?: { agent?: string; model?: { providerID: string; modelID: string }; modelID?: string; providerID?: string }
            }>
            for (let i = messages.length - 1; i >= 0; i--) {
              const info = messages[i].info
              if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
                resumeAgent = info.agent
                resumeModel = info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined)
                break
              }
            }
          } catch {
            const resumeMessageDir = getMessageDir(args.session_id)
            const resumeMessage = resumeMessageDir ? findNearestMessageWithFields(resumeMessageDir) : null
            resumeAgent = resumeMessage?.agent
            resumeModel = resumeMessage?.model?.providerID && resumeMessage?.model?.modelID
              ? { providerID: resumeMessage.model.providerID, modelID: resumeMessage.model.modelID }
              : undefined
          }

          await client.session.prompt({
            path: { id: args.session_id },
            body: {
              ...(resumeAgent !== undefined ? { agent: resumeAgent } : {}),
              ...(resumeModel !== undefined ? { model: resumeModel } : {}),
              tools: {
                ...(resumeAgent ? getAgentToolRestrictions(resumeAgent) : {}),
                task: false,
                delegate_task: false,
                call_omo_agent: true,
              },
              parts: [{ type: "text", text: args.prompt }],
            },
          })
        } catch (promptError) {
          if (toastManager) {
            toastManager.removeTask(taskId)
          }
          const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
          return `发送继续 prompt 失败：${errorMessage}\n\n会话ID： ${args.session_id}`
        }

        // Wait for message stability after prompt completes
        const POLL_INTERVAL_MS = 500
        const MIN_STABILITY_TIME_MS = 5000
        const STABILITY_POLLS_REQUIRED = 3
        const pollStart = Date.now()
        let lastMsgCount = 0
        let stablePolls = 0

        while (Date.now() - pollStart < 60000) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

          const elapsed = Date.now() - pollStart
          if (elapsed < MIN_STABILITY_TIME_MS) continue

          const messagesCheck = await client.session.messages({ path: { id: args.session_id } })
          const msgs = ((messagesCheck as { data?: unknown }).data ?? messagesCheck) as Array<unknown>
          const currentMsgCount = msgs.length

          if (currentMsgCount > 0 && currentMsgCount === lastMsgCount) {
            stablePolls++
            if (stablePolls >= STABILITY_POLLS_REQUIRED) break
          } else {
            stablePolls = 0
            lastMsgCount = currentMsgCount
          }
        }

        const messagesResult = await client.session.messages({
          path: { id: args.session_id },
        })

        if (messagesResult.error) {
          if (toastManager) {
            toastManager.removeTask(taskId)
          }
          return `获取结果出错：${messagesResult.error}\n\n会话ID： ${args.session_id}`
        }

        const messages = ((messagesResult as { data?: unknown }).data ?? messagesResult) as Array<{
          info?: { role?: string; time?: { created?: number } }
          parts?: Array<{ type?: string; text?: string }>
        }>

        const assistantMessages = messages
          .filter((m) => m.info?.role === "assistant")
          .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))
        const lastMessage = assistantMessages[0]

        if (toastManager) {
          toastManager.removeTask(taskId)
        }

        if (!lastMessage) {
          return `未找到 assistant 的响应。\n\n会话ID： ${args.session_id}`
        }

        // Extract text from both "text" and "reasoning" parts (thinking models use "reasoning")
        const textParts = lastMessage?.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
        const textContent = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")

        const duration = PerfTimer.formatDuration(startTime)

        return `任务已继续并在 ${duration} 内完成。

会话ID： ${args.session_id}

---

${textContent || "(无文本输出)"}

---
继续此 session：session_id="${args.session_id}"`
      }

      if (args.category && args.subagent_type) {
        return `参数错误：请提供 category 或 subagent_type 之一，两者不可同时提供。`
      }

      if (!args.category && !args.subagent_type) {
        return `参数错误：必须提供 category 或 subagent_type。`
      }

       // Fetch OpenCode config at boundary to get system default model
       let systemDefaultModel: string | undefined
       try {
         const openCodeConfig = await client.config.get()
         systemDefaultModel = (openCodeConfig as { data?: { model?: string } })?.data?.model
       } catch {
         systemDefaultModel = undefined
       }

       let agentToUse: string
       let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
       let categoryPromptAppend: string | undefined

       const inheritedModel = parentModel
         ? `${parentModel.providerID}/${parentModel.modelID}`
         : undefined

       let modelInfo: ModelFallbackInfo | undefined

       if (args.category) {
         // Guard: require system default model for category delegation
         if (!systemDefaultModel) {
           const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
           return (
             'oh-my-opencode 需要配置默认模型。\n\n' +
             `请将此添加到 ${paths.configJsonc}：\n\n` +
             '  "model": "anthropic/claude-sonnet-4-5"\n\n' +
             '（替换为你偏好的 provider/model）'
           )
          }

          const resolved = resolveCategoryConfig(args.category, {
            userCategories,
            inheritedModel,
            systemDefaultModel,
          })

          if (!resolved) {
            return `未知的分类：${args.category}。可用的分类：${categoryExamples}`
          }

          agentToUse = SISYPHUS_JUNIOR_AGENT
          categoryModel = parseModelString(resolved.model)
          categoryPromptAppend = resolved.promptAppend

          modelInfo = {
            type: "category-default",
            model: resolved.model,
          }
        } else {
          if (!args.subagent_type?.trim()) {
            return `Agent 名称不能为空。`
          }
          const agentName = args.subagent_type.trim()

        if (equalsIgnoreCase(agentName, SISYPHUS_JUNIOR_AGENT)) {
          return `不能直接使用 subagent_type="${SISYPHUS_JUNIOR_AGENT}"。请改用 category 参数（例如 ${categoryExamples}）。

当你指定 category 时，Sisyphus-Junior 会自动启动。请为你的任务领域选择合适的分类。`
        }

        agentToUse = agentName

        // Validate agent exists and is callable (not a primary agent)
        // Uses case-insensitive matching to allow "Oracle", "oracle", "ORACLE" etc.
        try {
          const agentsResult = await client.app.agents()
          type AgentInfo = { name: string; mode?: "subagent" | "primary" | "all" }
          const agents = (agentsResult as { data?: AgentInfo[] }).data ?? agentsResult as unknown as AgentInfo[]

          const callableAgents = agents.filter((a) => a.mode !== "primary")

          const matchedAgent = findByNameCaseInsensitive(callableAgents, agentToUse)
          if (!matchedAgent) {
            const isPrimaryAgent = findByNameCaseInsensitive(
              agents.filter((a) => a.mode === "primary"),
              agentToUse
            )
            if (isPrimaryAgent) {
              return `无法通过 delegate_task 调用 primary agent "${isPrimaryAgent.name}"。Primary agents 是顶层协调者。`
            }

            const availableAgents = callableAgents
              .map((a) => a.name)
              .sort()
              .join(", ")
            return `未知的 agent："${agentToUse}"。可用的 agents：${availableAgents}`
          }
          // Use the canonical agent name from registration
          agentToUse = matchedAgent.name
        } catch {
          // If we can't fetch agents, proceed anyway - the session.prompt will fail with a clearer error
        }
      }

      const systemContent = buildSystemContent({ skillContent, categoryPromptAppend })

      if (runInBackground) {
        try {
          const task = await manager.launch({
            description: args.description,
            prompt: args.prompt,
            agent: agentToUse,
            parentSessionID: ctx.sessionID,
            parentMessageID: ctx.messageID,
            parentModel,
            parentAgent,
            category: args.category,
            model: categoryModel,
            skills: args.load_skills.length > 0 ? args.load_skills : undefined,
            skillContent: systemContent,
          })

          ctx.metadata?.({
            title: args.description,
            metadata: {
              prompt: args.prompt,
              agent: task.agent,
              category: args.category,
              load_skills: args.load_skills,
              description: args.description,
              run_in_background: args.run_in_background,
              sessionId: task.sessionID,
              command: args.command,
            },
          })

          return `后台任务已启动。

          任务ID：${task.id}
          会话ID：${task.sessionID}
          描述：${task.description}
          代理：${task.agent}${args.category ? ` (category: ${args.category})` : ""}
          状态：${task.status}

完成时系统会通知。使用 \`background_output\` 并传入 task_id="${task.id}" 查看。
继续此 session：session_id="${task.sessionID}"`
        } catch (error) {
          return formatDetailedError(error, {
            operation: "启动后台任务",
            args,
            agent: agentToUse,
            category: args.category,
          })
        }
      }

      const toastManager = getTaskToastManager()
      let taskId: string | undefined
      let syncSessionID: string | undefined

      try {
        const parentSession = client.session.get
          ? await client.session.get({ path: { id: ctx.sessionID } }).catch(() => null)
          : null
        const parentDirectory = parentSession?.data?.directory ?? directory

        const createResult = await client.session.create({
          body: {
            parentID: ctx.sessionID,
            title: `Task: ${args.description}`,
          },
          query: {
            directory: parentDirectory,
          },
        })

        if (createResult.error) {
          return `创建 session 失败：${createResult.error}`
        }

        const sessionID = createResult.data.id
        syncSessionID = sessionID
        subagentSessions.add(sessionID)
        taskId = `sync_${sessionID.slice(0, 8)}`
        const startTime = new Date()

        if (toastManager) {
          toastManager.addTask({
            id: taskId,
            description: args.description,
            agent: agentToUse,
            isBackground: false,
            category: args.category,
            skills: args.load_skills,
            modelInfo,
          })
        }

        ctx.metadata?.({
          title: args.description,
          metadata: {
            prompt: args.prompt,
            agent: agentToUse,
            category: args.category,
            load_skills: args.load_skills,
            description: args.description,
            run_in_background: args.run_in_background,
            sessionId: sessionID,
            sync: true,
            command: args.command,
          },
        })

        try {
          await client.session.prompt({
            path: { id: sessionID },
            body: {
              agent: agentToUse,
              system: systemContent,
              tools: {
                task: false,
                delegate_task: false,
                call_omo_agent: true,
              },
              parts: [{ type: "text", text: args.prompt }],
              ...(categoryModel ? { model: categoryModel } : {}),
            },
          })
        } catch (promptError) {
          const classification = classifyProviderError(promptError)
          const canFallback = runtimeFallbackConfig?.enabled !== false && (classification.retryable || classification.shouldFallback)
          if (canFallback) {
            const attempts: FallbackAttempt[] = []
            let fallbackSucceeded = false
            let currentModel = categoryModel ?? { providerID: "", modelID: "" }
            let currentClassification = classification
            while (true) {
              const fallbackResult = resolveNextFallbackModel({
                agent: agentToUse,
                category: args.category,
                currentModel,
                attempts,
                configuredFallbackModels: getConfiguredFallbackModels(agentToUse, args.category),
                maxAttempts: runtimeFallbackConfig?.max_attempts,
                lastErrorClassification: currentClassification,
              })
              if (fallbackResult.kind !== "next") break
              try {
                await client.session.prompt({
                  path: { id: sessionID },
                  body: {
                    agent: agentToUse,
                    system: systemContent,
                    tools: {
                      task: false,
                      delegate_task: false,
                      call_omo_agent: true,
                    },
                    parts: [{ type: "text", text: args.prompt }],
                    model: fallbackResult.model,
                  },
                })
                fallbackSucceeded = true
                break
              } catch (fallbackError) {
                currentClassification = classifyProviderError(fallbackError)
                attempts.push({ model: fallbackResult.model, error: currentClassification })
                currentModel = fallbackResult.model
                if (!currentClassification.retryable && !currentClassification.shouldFallback) {
                  throw fallbackError
                }
              }
            }
            if (!fallbackSucceeded) {
              if (toastManager && taskId !== undefined) {
                toastManager.removeTask(taskId)
              }
              return formatDetailedError(promptError, {
                operation: "发送 prompt",
                args,
                sessionID,
                agent: agentToUse,
                category: args.category,
              })
            }
          } else {
            if (toastManager && taskId !== undefined) {
              toastManager.removeTask(taskId)
            }
            const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
            if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
              return formatDetailedError(new Error(`Agent "${agentToUse}" 未找到。请确认该 agent 已在 opencode.json 中注册或由插件提供。`), {
                operation: "发送 prompt 给 agent",
                args,
                sessionID,
                agent: agentToUse,
                category: args.category,
              })
            }
            return formatDetailedError(promptError, {
              operation: "发送 prompt",
              args,
              sessionID,
              agent: agentToUse,
              category: args.category,
            })
          }
        }

        // Poll for session completion with stability detection
        // The session may show as "idle" before messages appear, so we also check message stability
        const POLL_INTERVAL_MS = 500
        const MAX_POLL_TIME_MS = 10 * 60 * 1000
        const MIN_STABILITY_TIME_MS = 10000  // Minimum 10s before accepting completion
        const STABILITY_POLLS_REQUIRED = 3
        const pollStart = Date.now()
        let lastMsgCount = 0
        let stablePolls = 0
        let pollCount = 0

        log("[delegate_task] Starting poll loop", { sessionID, agentToUse })

        while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
          if (ctx.abort?.aborted) {
            log("[delegate_task] Aborted by user", { sessionID })
            if (toastManager && taskId) toastManager.removeTask(taskId)
            return `任务已中止。\n\n会话ID： ${sessionID}`
          }

          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
          pollCount++

          const statusResult = await client.session.status()
          const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>
          const sessionStatus = allStatuses[sessionID]

          if (pollCount % 10 === 0) {
            log("[delegate_task] Poll status", {
              sessionID,
              pollCount,
              elapsed: Math.floor((Date.now() - pollStart) / 1000) + "s",
              sessionStatus: sessionStatus?.type ?? "not_in_status",
              stablePolls,
              lastMsgCount,
            })
          }

          if (sessionStatus && sessionStatus.type !== "idle") {
            stablePolls = 0
            lastMsgCount = 0
            continue
          }

          const elapsed = Date.now() - pollStart
          if (elapsed < MIN_STABILITY_TIME_MS) {
            continue
          }

          const messagesCheck = await client.session.messages({ path: { id: sessionID } })
          const msgs = ((messagesCheck as { data?: unknown }).data ?? messagesCheck) as Array<unknown>
          const currentMsgCount = msgs.length

          if (currentMsgCount === lastMsgCount) {
            stablePolls++
            if (stablePolls >= STABILITY_POLLS_REQUIRED) {
              log("[delegate_task] Poll complete - messages stable", { sessionID, pollCount, currentMsgCount })
              break
            }
          } else {
            stablePolls = 0
            lastMsgCount = currentMsgCount
          }
        }

        if (Date.now() - pollStart >= MAX_POLL_TIME_MS) {
          log("[delegate_task] Poll timeout reached", { sessionID, pollCount, lastMsgCount, stablePolls })
        }

        const messagesResult = await client.session.messages({
          path: { id: sessionID },
        })

        if (messagesResult.error) {
          const classification = classifyProviderError(messagesResult.error)
          const diagnosis = classification.category !== "unknown"
            ? `\n\n🔍 **错误分类**: ${classification.reason}\n${classification.shouldFallback ? "💡 此错误符合 runtime fallback 条件。" : classification.retryable ? "⏳ 此错误可重试。" : ""}`
            : ""
          return `获取结果失败：${messagesResult.error}${diagnosis}\n\n会话ID： ${sessionID}`
        }

        const messages = ((messagesResult as { data?: unknown }).data ?? messagesResult) as Array<{
          info?: { role?: string; time?: { created?: number } }
          parts?: Array<{ type?: string; text?: string }>
        }>

        const assistantMessages = messages
          .filter((m) => m.info?.role === "assistant")
          .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))
        const lastMessage = assistantMessages[0]

        if (!lastMessage) {
          return `未找到 assistant 的响应。\n\n会话ID： ${sessionID}`
        }

        // Extract text from both "text" and "reasoning" parts (thinking models use "reasoning")
        const textParts = lastMessage?.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
        const textContent = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")

        const duration = PerfTimer.formatDuration(startTime)

        if (toastManager) {
          toastManager.removeTask(taskId)
        }

        subagentSessions.delete(sessionID)

        return `任务在 ${duration} 内完成。

代理：${agentToUse}${args.category ? ` (category: ${args.category})` : ""}
会话ID： ${sessionID}

---

${textContent || "(无文本输出)"}

---
继续此 session：session_id="${sessionID}"`
      } catch (error) {
        if (toastManager && taskId !== undefined) {
          toastManager.removeTask(taskId)
        }
        if (syncSessionID) {
          subagentSessions.delete(syncSessionID)
        }

        const classification = classifyProviderError(error)
        const diagnosis = classification.category !== "unknown"
          ? `\n\n🔍 **错误分类**: ${classification.reason}\n${classification.shouldFallback ? "💡 此错误符合 runtime fallback 条件。" : classification.retryable ? "⏳ 此错误可重试。" : ""}`
          : ""

        return `任务执行失败: ${error instanceof Error ? error.message : String(error)}${diagnosis}\n\n会话ID： ${syncSessionID ?? "unknown"}`
      }
    },
  })
}
