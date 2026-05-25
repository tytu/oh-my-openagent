import {tool, type ToolDefinition} from "@opencode-ai/plugin/tool"
import {runRgFiles} from "./cli"
import {resolveGrepCliWithAutoInstall} from "./constants"
import {formatGlobResult} from "./utils"

export const glob: ToolDefinition = tool({
    description:
        "具有安全限制的快速文件模式匹配工具（60秒超时，最多100个文件限制）。" +
        "支持如\"**/*.js\"或\"src/**/*.ts\"的glob模式。" +
        "返回按修改时间排序的匹配文件路径。" +
        "当你需要按文件名模式查找文件时使用此工具。",
    args: {
        pattern: tool.schema.string().describe("要匹配文件的glob模式"),
        path: tool.schema
            .string()
            .optional()
            .describe(
                "要搜索的目录。如果未指定，将使用当前工作目录。" +
                "重要提示：省略此字段以使用默认目录。不要输入\"undefined\"或\"null\"——" +
                "只需省略此字段即可使用默认行为。如果提供，必须是有效的目录路径。"
            ),
    },
    execute: async (args) => {
        try {
            const cli = await resolveGrepCliWithAutoInstall()
            const paths = args.path ? [args.path] : undefined

            const result = await runRgFiles(
                {
                    pattern: args.pattern,
                    paths,
                },
                cli
            )

            return formatGlobResult(result)
        } catch (e) {
            return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
    },
})
