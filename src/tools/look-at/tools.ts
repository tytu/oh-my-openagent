import { extname, basename } from "node:path"
import { pathToFileURL } from "node:url"
import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { LOOK_AT_DESCRIPTION, MULTIMODAL_LOOKER_AGENT } from "./constants"
import type { LookAtArgs } from "./types"
import { log } from "../../shared/logger"

interface LookAtArgsWithAlias extends LookAtArgs {
  path?: string
}

export function normalizeArgs(args: LookAtArgsWithAlias): LookAtArgs {
  return {
    file_path: args.file_path ?? args.path ?? "",
    goal: args.goal ?? "",
  }
}

export function validateArgs(args: LookAtArgs): string | null {
  if (!args.file_path) {
    return `错误：缺少必填参数 'file_path'。用法：look_at(file_path="/path/to/file", goal="要提取的内容")`
  }
  if (!args.goal) {
    return `错误：缺少必填参数 'goal'。用法：look_at(file_path="/path/to/file", goal="要提取的内容")`
  }
  if (!args.goal) {
    return `错误：缺少必填参数 'goal'。用法：look_at(file_path="/path/to/file", goal="要提取的内容")`
  }
  return null
}

function inferMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".mov": "video/mov",
    ".avi": "video/avi",
    ".flv": "video/x-flv",
    ".webm": "video/webm",
    ".wmv": "video/wmv",
    ".3gpp": "video/3gpp",
    ".3gp": "video/3gpp",
    ".wav": "audio/wav",
    ".mp3": "audio/mp3",
    ".aiff": "audio/aiff",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".md": "text/md",
    ".html": "text/html",
    ".json": "application/json",
    ".xml": "application/xml",
    ".js": "text/javascript",
    ".py": "text/x-python",
  }
  return mimeTypes[ext] || "application/octet-stream"
}

export function createLookAt(ctx: PluginInput): ToolDefinition {
  return tool({
    description: LOOK_AT_DESCRIPTION,
    args: {
      file_path: tool.schema.string().describe("要分析的文件的绝对路径"),
      goal: tool.schema.string().describe("要从文件中提取的特定信息"),
    },
    async execute(rawArgs: LookAtArgs, toolContext) {
      const args = normalizeArgs(rawArgs as LookAtArgsWithAlias)
      const validationError = validateArgs(args)
      if (validationError) {
        log(`[look_at] Validation failed: ${validationError}`)
        return validationError
      }

      log(`[look_at] Analyzing file: ${args.file_path}, goal: ${args.goal}`)

      const mimeType = inferMimeType(args.file_path)
      const filename = basename(args.file_path)

      const prompt = `分析此文件并提取所需信息。

目标：${args.goal}

仅提供与目标匹配的提取信息。
对所请求的内容要详尽，其他内容要简洁。
若未找到所需信息，请明确说明缺少什么。`

      log(`[look_at] Creating session with parent: ${toolContext.sessionID}`)
      const parentSession = await ctx.client.session.get({
        path: { id: toolContext.sessionID },
      }).catch(() => null)
      const parentDirectory = parentSession?.data?.directory ?? ctx.directory

      const createResult = await ctx.client.session.create({
        body: {
          parentID: toolContext.sessionID,
          title: `look_at: ${args.goal.substring(0, 50)}`,
        },
        query: {
          directory: parentDirectory,
        },
      })

      if (createResult.error) {
        log(`[look_at] Session create error:`, createResult.error)
        return `错误：创建会话失败：${createResult.error}`
      }

      const sessionID = createResult.data.id
      log(`[look_at] Created session: ${sessionID}`)

      log(`[look_at] Sending prompt with file passthrough to session ${sessionID}`)
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: MULTIMODAL_LOOKER_AGENT,
          tools: {
            task: false,
            call_omo_agent: false,
            look_at: false,
            read: false,
          },
          parts: [
            { type: "text", text: prompt },
            { type: "file", mime: mimeType, url: pathToFileURL(args.file_path).href, filename },
          ],
        },
      })

      log(`[look_at] Prompt sent, fetching messages...`)

      const messagesResult = await ctx.client.session.messages({
        path: { id: sessionID },
      })

      if (messagesResult.error) {
        log(`[look_at] Messages error:`, messagesResult.error)
        return `错误：获取消息失败：${messagesResult.error}`
      }

      const messages = messagesResult.data
      log(`[look_at] Got ${messages.length} messages`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastAssistantMessage = messages
        .filter((m: any) => m.info.role === "assistant")
        .sort((a: any, b: any) => (b.info.time?.created || 0) - (a.info.time?.created || 0))[0]

      if (!lastAssistantMessage) {
        log(`[look_at] No assistant message found`)
        return `错误：multimodal-looker 代理无响应`
      }

      log(`[look_at] Found assistant message with ${lastAssistantMessage.parts.length} parts`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textParts = lastAssistantMessage.parts.filter((p: any) => p.type === "text")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseText = textParts.map((p: any) => p.text).join("\n")

      log(`[look_at] Got response, length: ${responseText.length}`)

      return responseText
    },
  })
}
