import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { runRg } from "./cli"
import { formatGrepResult } from "./utils"

export const grep: ToolDefinition = tool({
  description:
    "快速内容搜索工具（60 秒超时，10MB 输出上限）。" +
    "使用正则表达式搜索文件内容。" +
    "支持完整正则语法（如 \"log.*Error\"、\"function\\s+\\w+\" 等）。" +
    "通过 include 参数按文件模式过滤（如 \"*.js\"、\"*.{ts,tsx}\"）。" +
    "返回按修改时间排序的匹配文件路径。",
  args: {
    pattern: tool.schema.string().describe("在文件内容中搜索的正则表达式模式"),
    include: tool.schema
      .string()
      .optional()
      .describe("搜索中包含的文件模式（如 \"*.js\"、\"*.{ts,tsx}\"）"),
    path: tool.schema
      .string()
      .optional()
      .describe("搜索目录（默认为当前工作目录）"),
  },
  execute: async (args) => {
    try {
      const globs = args.include ? [args.include] : undefined
      const paths = args.path ? [args.path] : undefined

      const result = await runRg({
        pattern: args.pattern,
        paths,
        globs,
        context: 0,
      })

      return formatGrepResult(result)
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
