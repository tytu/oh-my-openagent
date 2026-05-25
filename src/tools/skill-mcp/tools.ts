import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { SKILL_MCP_DESCRIPTION } from "./constants"
import type { SkillMcpArgs } from "./types"
import type { SkillMcpManager, SkillMcpClientInfo, SkillMcpServerContext } from "../../features/skill-mcp-manager"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

interface SkillMcpToolOptions {
  manager: SkillMcpManager
  getLoadedSkills: () => LoadedSkill[]
  getSessionID: () => string
}

type OperationType = { type: "tool" | "resource" | "prompt"; name: string }

function validateOperationParams(args: SkillMcpArgs): OperationType {
  const operations: OperationType[] = []
  if (args.tool_name) operations.push({ type: "tool", name: args.tool_name })
  if (args.resource_name) operations.push({ type: "resource", name: args.resource_name })
  if (args.prompt_name) operations.push({ type: "prompt", name: args.prompt_name })

if (operations.length === 0) {
     throw new Error(
       `缺少操作参数。必须且只能指定tool_name、resource_name或prompt_name中的一个。\n\n` +
         `示例：\n` +
         `  skill_mcp(mcp_name="sqlite", tool_name="query", arguments='{"sql": "SELECT * FROM users"}')\n` +
         `  skill_mcp(mcp_name="memory", resource_name="memory://notes")\n` +
         `  skill_mcp(mcp_name="helper", prompt_name="summarize", arguments='{"text": "..."}')`,
     )
   }

if (operations.length > 1) {
     const provided = [
       args.tool_name && `tool_name="${args.tool_name}"`,
       args.resource_name && `resource_name="${args.resource_name}"`,
       args.prompt_name && `prompt_name="${args.prompt_name}"`,
     ]
       .filter(Boolean)
       .join(", ")

     throw new Error(
       `指定了多个操作参数。必须且只能指定tool_name、resource_name或prompt_name中的一个。\n\n` +
         `已传入：${provided}\n\n` +
         `每个操作请使用单独的调用。`,
     )
   }

  return operations[0]
}

function findMcpServer(
  mcpName: string,
  skills: LoadedSkill[],
): { skill: LoadedSkill; config: NonNullable<LoadedSkill["mcpConfig"]>[string] } | null {
  for (const skill of skills) {
    if (skill.mcpConfig && mcpName in skill.mcpConfig) {
      return { skill, config: skill.mcpConfig[mcpName] }
    }
  }
  return null
}

function formatAvailableMcps(skills: LoadedSkill[]): string {
  const mcps: string[] = []
  for (const skill of skills) {
    if (skill.mcpConfig) {
      for (const serverName of Object.keys(skill.mcpConfig)) {
        mcps.push(`  - "${serverName}" from skill "${skill.name}"`)
      }
    }
  }
  return mcps.length > 0 ? mcps.join("\n") : "  (none found)"
}

function parseArguments(argsJson: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!argsJson) return {}
  if (typeof argsJson === "object" && argsJson !== null) {
    return argsJson
  }
  try {
    // Strip outer single quotes if present (common in LLM output)
    const jsonStr = argsJson.startsWith("'") && argsJson.endsWith("'") ? argsJson.slice(1, -1) : argsJson

    const parsed = JSON.parse(jsonStr)
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Arguments must be a JSON object")
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
throw new Error(
       `无效的参数JSON：${errorMessage}\n\n` +
         `需要有效的JSON对象，例如：'{"key": "value"}'\n` +
         `传入的内容：${argsJson}`,
     )
  }
}

export function applyGrepFilter(output: string, pattern: string | undefined): string {
  if (!pattern) return output
  try {
    const regex = new RegExp(pattern, "i")
    const lines = output.split("\n")
    const filtered = lines.filter((line) => regex.test(line))
    return filtered.length > 0 ? filtered.join("\n") : `[grep] 没有匹配到模式：${pattern}`
  } catch {
    return output
  }
}

export function createSkillMcpTool(options: SkillMcpToolOptions): ToolDefinition {
  const { manager, getLoadedSkills, getSessionID } = options

  return tool({
    description: SKILL_MCP_DESCRIPTION,
args: {
       mcp_name: tool.schema.string().describe("来自技能配置的MCP服务器名称"),
       tool_name: tool.schema.string().optional().describe("要调用的MCP工具"),
       resource_name: tool.schema.string().optional().describe("要读取的MCP资源URI"),
       prompt_name: tool.schema.string().optional().describe("要获取的MCP提示"),
       arguments: tool.schema
         .union([tool.schema.string(), tool.schema.record(tool.schema.string(), tool.schema.unknown())])
         .optional()
         .describe("参数的JSON字符串或对象"),
       grep: tool.schema
         .string()
         .optional()
         .describe("用于过滤输出行的正则表达式（仅返回匹配的行）"),
     },
    async execute(args: SkillMcpArgs) {
      const operation = validateOperationParams(args)
      const skills = getLoadedSkills()
      const found = findMcpServer(args.mcp_name, skills)

if (!found) {
         throw new Error(
           `未找到MCP服务器"${args.mcp_name}"。\n\n` +
             `已加载技能中的可用MCP服务器：\n` +
             formatAvailableMcps(skills) +
             `\n\n` +
             `提示：先使用'skill'工具加载技能，然后再调用skill_mcp。`,
         )
       }

      const info: SkillMcpClientInfo = {
        serverName: args.mcp_name,
        skillName: found.skill.name,
        sessionID: getSessionID(),
      }

      const context: SkillMcpServerContext = {
        config: found.config,
        skillName: found.skill.name,
      }

      const parsedArgs = parseArguments(args.arguments)

      let output: string
      switch (operation.type) {
        case "tool": {
          const result = await manager.callTool(info, context, operation.name, parsedArgs)
          output = JSON.stringify(result, null, 2)
          break
        }
        case "resource": {
          const result = await manager.readResource(info, context, operation.name)
          output = JSON.stringify(result, null, 2)
          break
        }
        case "prompt": {
          const stringArgs: Record<string, string> = {}
          for (const [key, value] of Object.entries(parsedArgs)) {
            stringArgs[key] = String(value)
          }
          const result = await manager.getPrompt(info, context, operation.name, stringArgs)
          output = JSON.stringify(result, null, 2)
          break
        }
      }
      return applyGrepFilter(output, args.grep)
    },
  })
}
