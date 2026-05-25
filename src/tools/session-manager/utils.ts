import type { SessionInfo, SessionMessage, SearchResult } from "./types"
import { getSessionInfo, readSessionMessages } from "./storage"

export async function formatSessionList(sessionIDs: string[]): Promise<string> {
  if (sessionIDs.length === 0) {
    return "未找到会话。"
  }

  const infos = (await Promise.all(sessionIDs.map((id) => getSessionInfo(id)))).filter(
    (info): info is SessionInfo => info !== null
  )

  if (infos.length === 0) {
    return "未找到有效会话。"
  }

  const headers = ["会话ID", "消息数", "首条", "末条", "代理"]
  const rows = infos.map((info) => [
    info.id,
    info.message_count.toString(),
    info.first_message?.toISOString().split("T")[0] ?? "无",
    info.last_message?.toISOString().split("T")[0] ?? "无",
    info.agents_used.join(", ") || "无",
  ])

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))

  const formatRow = (cells: string[]): string => {
    return (
      "| " +
      cells
        .map((cell, i) => cell.padEnd(colWidths[i]))
        .join(" | ")
        .trim() +
      " |"
    )
  }

  const separator = "|" + colWidths.map((w) => "-".repeat(w + 2)).join("|") + "|"

  return [formatRow(headers), separator, ...rows.map(formatRow)].join("\n")
}

export function formatSessionMessages(
  messages: SessionMessage[],
  includeTodos?: boolean,
  todos?: Array<{ id: string; content: string; status: string }>
): string {
  if (messages.length === 0) {
    return "此会话中未找到消息。"
  }

  const lines: string[] = []

  for (const msg of messages) {
    const timestamp = msg.time?.created ? new Date(msg.time.created).toISOString() : "未知时间"
    const agent = msg.agent ? ` (${msg.agent})` : ""
    lines.push(`\n[${msg.role}${agent}] ${timestamp}`)

    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        lines.push(part.text.trim())
      } else if (part.type === "thinking" && part.thinking) {
        lines.push(`[思考中] ${part.thinking.substring(0, 200)}...`)
      } else if ((part.type === "tool_use" || part.type === "tool") && part.tool) {
        const input = part.input ? JSON.stringify(part.input).substring(0, 100) : ""
        lines.push(`[工具调用: ${part.tool}] ${input}`)
      } else if (part.type === "tool_result") {
        const output = part.output ? part.output.substring(0, 200) : ""
        lines.push(`[工具结果] ${output}...`)
      }
    }
  }

  if (includeTodos && todos && todos.length > 0) {
    lines.push("\n\n=== 待办事项 ===")
    for (const todo of todos) {
      const status = todo.status === "completed" ? "[已完成]" : todo.status === "in_progress" ? "[进行中]" : "[待办]"
      lines.push(`${status} [${todo.status}] ${todo.content}`)
    }
  }

  return lines.join("\n")
}

export function formatSessionInfo(info: SessionInfo): string {
  const lines = [
    `会话ID：${info.id}`,
    `消息数：${info.message_count}`,
    `日期范围：${info.first_message?.toISOString() ?? "无"} 至 ${info.last_message?.toISOString() ?? "无"}`,
    `使用的代理：${info.agents_used.join(", ") || "无"}`,
    `含 TODO：${info.has_todos ? `是（${info.todos?.length ?? 0} 项）` : "否"}`,
    `含 Transcript：${info.has_transcript ? `是（${info.transcript_entries} 条）` : "否"}`,
  ]

  if (info.first_message && info.last_message) {
    const duration = info.last_message.getTime() - info.first_message.getTime()
    const days = Math.floor(duration / (1000 * 60 * 60 * 24))
    const hours = Math.floor((duration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    if (days > 0 || hours > 0) {
      lines.push(`时长：${days} 天，${hours} 小时`)
    }
  }

  return lines.join("\n")
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "未找到匹配项。"
  }

  const lines: string[] = [`找到 ${results.length} 个匹配项：\n`]

  for (const result of results) {
    const timestamp = result.timestamp ? new Date(result.timestamp).toISOString() : ""
    lines.push(`[${result.session_id}] ${result.message_id} (${result.role}) ${timestamp}`)
    lines.push(`  ${result.excerpt}`)
    lines.push(`  匹配数：${result.match_count}\n`)
  }

  return lines.join("\n")
}

export async function filterSessionsByDate(
  sessionIDs: string[],
  fromDate?: string,
  toDate?: string
): Promise<string[]> {
  if (!fromDate && !toDate) return sessionIDs

  const from = fromDate ? new Date(fromDate) : null
  const to = toDate ? new Date(toDate) : null

  const results: string[] = []
  for (const id of sessionIDs) {
    const info = await getSessionInfo(id)
    if (!info || !info.last_message) continue

    if (from && info.last_message < from) continue
    if (to && info.last_message > to) continue

    results.push(id)
  }

  return results
}

export async function searchInSession(
  sessionID: string,
  query: string,
  caseSensitive = false,
  maxResults?: number
): Promise<SearchResult[]> {
  const messages = await readSessionMessages(sessionID)
  const results: SearchResult[] = []

  const searchQuery = caseSensitive ? query : query.toLowerCase()

  for (const msg of messages) {
    if (maxResults && results.length >= maxResults) break

    let matchCount = 0
    const excerpts: string[] = []

    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        const text = caseSensitive ? part.text : part.text.toLowerCase()
        const matches = text.split(searchQuery).length - 1
        if (matches > 0) {
          matchCount += matches

          const index = text.indexOf(searchQuery)
          if (index !== -1) {
            const start = Math.max(0, index - 50)
            const end = Math.min(text.length, index + searchQuery.length + 50)
            let excerpt = part.text.substring(start, end)
            if (start > 0) excerpt = "..." + excerpt
            if (end < text.length) excerpt = excerpt + "..."
            excerpts.push(excerpt)
          }
        }
      }
    }

    if (matchCount > 0) {
      results.push({
        session_id: sessionID,
        message_id: msg.id,
        role: msg.role,
        excerpt: excerpts[0] || "",
        match_count: matchCount,
        timestamp: msg.time?.created,
      })
    }
  }

  return results
}
