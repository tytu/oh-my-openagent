import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { CLI_LANGUAGES } from "./constants"
import { runSg } from "./cli"
import { formatSearchResult, formatReplaceResult } from "./utils"
import type { CliLanguage } from "./types"

function showOutputToUser(context: unknown, output: string): void {
  const ctx = context as { metadata?: (input: { metadata: { output: string } }) => void }
  ctx.metadata?.({ metadata: { output } })
}

function getEmptyResultHint(pattern: string, lang: CliLanguage): string | null {
  const src = pattern.trim()

  if (lang === "python") {
    if (src.startsWith("class ") && src.endsWith(":")) {
      const withoutColon = src.slice(0, -1)
      return `提示：移除末尾的冒号。尝试："${withoutColon}"`
    }
    if ((src.startsWith("def ") || src.startsWith("async def ")) && src.endsWith(":")) {
      const withoutColon = src.slice(0, -1)
      return `提示：移除末尾的冒号。尝试："${withoutColon}"`
    }
  }

  if (["javascript", "typescript", "tsx"].includes(lang)) {
    if (/^(export\s+)?(async\s+)?function\s+\$[A-Z_]+\s*$/i.test(src)) {
      return `提示：函数模式需要参数和函数体。尝试 "function $NAME($$$) { $$$ }"`
    }
  }

  return null
}

export const ast_grep_search: ToolDefinition = tool({
  description:
    "使用 AST 感知匹配跨文件系统搜索代码模式。支持 25 种语言。" +
    "使用元变量：$VAR（单节点）、$$$（多节点）。" +
    "重要：模式必须是完整 AST 节点（有效代码）。" +
    "对于函数，包含参数和函数体：'export async function $NAME($$$) { $$$ }' 而非 'export async function $NAME'。" +
    "示例：'console.log($MSG)'、'def $FUNC($$$):'、'async function $NAME($$$)'",
  args: {
    pattern: tool.schema.string().describe("含元变量（$VAR, $$$）的 AST 模式，必须是完整 AST 节点"),
    lang: tool.schema.enum(CLI_LANGUAGES).describe("目标语言"),
    paths: tool.schema.array(tool.schema.string()).optional().describe("搜索路径（默认：['.']）"),
    globs: tool.schema.array(tool.schema.string()).optional().describe("包含/排除的 glob 模式（前缀 ! 表示排除）"),
    context: tool.schema.number().optional().describe("匹配周围的上下文行数"),
  },
  execute: async (args, context) => {
    try {
      const result = await runSg({
        pattern: args.pattern,
        lang: args.lang as CliLanguage,
        paths: args.paths,
        globs: args.globs,
        context: args.context,
      })

      let output = formatSearchResult(result)

      if (result.matches.length === 0 && !result.error) {
        const hint = getEmptyResultHint(args.pattern, args.lang as CliLanguage)
        if (hint) {
          output += `\n\n${hint}`
        }
      }

      showOutputToUser(context, output)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      showOutputToUser(context, output)
      return output
    }
  },
})

export const ast_grep_replace: ToolDefinition = tool({
  description:
    "使用 AST 感知重写跨文件系统替换代码模式。" +
    "默认仅预览。使用元变量在 rewrite 中保留匹配内容。" +
    "示例：pattern='console.log($MSG)' rewrite='logger.info($MSG)'",
  args: {
    pattern: tool.schema.string().describe("AST 匹配模式"),
    rewrite: tool.schema.string().describe("替换模式（可使用模式中的 $VAR）"),
    lang: tool.schema.enum(CLI_LANGUAGES).describe("目标语言"),
    paths: tool.schema.array(tool.schema.string()).optional().describe("搜索路径"),
    globs: tool.schema.array(tool.schema.string()).optional().describe("包含/排除的 glob"),
    dryRun: tool.schema.boolean().optional().describe("预览改动而不应用（默认：true）"),
  },
  execute: async (args, context) => {
    try {
      const result = await runSg({
        pattern: args.pattern,
        rewrite: args.rewrite,
        lang: args.lang as CliLanguage,
        paths: args.paths,
        globs: args.globs,
        updateAll: args.dryRun === false,
      })
      const output = formatReplaceResult(result, args.dryRun !== false)
      showOutputToUser(context, output)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      showOutputToUser(context, output)
      return output
    }
  },
})


