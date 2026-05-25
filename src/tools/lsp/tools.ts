import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import {
  DEFAULT_MAX_REFERENCES,
  DEFAULT_MAX_SYMBOLS,
  DEFAULT_MAX_DIAGNOSTICS,
} from "./constants"
import {
  withLspClient,
  formatLocation,
  formatDocumentSymbol,
  formatSymbolInfo,
  formatDiagnostic,
  filterDiagnosticsBySeverity,
  formatPrepareRenameResult,
  applyWorkspaceEdit,
  formatApplyResult,
} from "./utils"
import type {
  Location,
  LocationLink,
  DocumentSymbol,
  SymbolInfo,
  Diagnostic,
  PrepareRenameResult,
  PrepareRenameDefaultBehavior,
  WorkspaceEdit,
} from "./types"

export const lsp_goto_definition: ToolDefinition = tool({
  description: "跳转到符号定义。查找某个东西的定义位置。",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("从1开始计数"),
    character: tool.schema.number().min(0).describe("从0开始计数"),
  },
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.definition(args.filePath, args.line, args.character)) as
          | Location
          | Location[]
          | LocationLink[]
          | null
      })

      if (!result) {
        const output = "No definition found"
        return output
      }

      const locations = Array.isArray(result) ? result : [result]
      if (locations.length === 0) {
        const output = "No definition found"
        return output
      }

      const output = locations.map(formatLocation).join("\n")
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})

export const lsp_find_references: ToolDefinition = tool({
  description: "在整个工作区中查找符号的所有使用/引用。",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("从1开始计数"),
    character: tool.schema.number().min(0).describe("从0开始计数"),
    includeDeclaration: tool.schema.boolean().optional().describe("是否包含声明本身"),
  },
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.references(args.filePath, args.line, args.character, args.includeDeclaration ?? true)) as
          | Location[]
          | null
      })

      if (!result || result.length === 0) {
        const output = "No references found"
        return output
      }

      const total = result.length
      const truncated = total > DEFAULT_MAX_REFERENCES
      const limited = truncated ? result.slice(0, DEFAULT_MAX_REFERENCES) : result
      const lines = limited.map(formatLocation)
      if (truncated) {
        lines.unshift(`Found ${total} references (showing first ${DEFAULT_MAX_REFERENCES}):`)
      }
      const output = lines.join("\n")
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})

export const lsp_symbols: ToolDefinition = tool({
  description: "从文件（文档）或工作区中获取符号。使用scope='document'获取文件大纲，scope='workspace'进行项目范围的符号搜索。",
  args: {
    filePath: tool.schema.string().describe("LSP上下文的文件路径"),
    scope: tool.schema.enum(["document", "workspace"]).default("document").describe("'document' 表示文件符号，'workspace' 表示项目范围的搜索"),
    query: tool.schema.string().optional().describe("要搜索的符号名称（workspace范围时必填）"),
    limit: tool.schema.number().optional().describe("最大结果数（默认50）"),
  },
  execute: async (args, context) => {
    try {
      const scope = args.scope ?? "document"
      
      if (scope === "workspace") {
        if (!args.query) {
          return "Error: 'query' is required for workspace scope"
        }
        
        const result = await withLspClient(args.filePath, async (client) => {
          return (await client.workspaceSymbols(args.query!)) as SymbolInfo[] | null
        })

        if (!result || result.length === 0) {
          return "No symbols found"
        }

        const total = result.length
        const limit = Math.min(args.limit ?? DEFAULT_MAX_SYMBOLS, DEFAULT_MAX_SYMBOLS)
        const truncated = total > limit
        const limited = result.slice(0, limit)
        const lines = limited.map(formatSymbolInfo)
        if (truncated) {
          lines.unshift(`Found ${total} symbols (showing first ${limit}):`)
        }
        return lines.join("\n")
      } else {
        const result = await withLspClient(args.filePath, async (client) => {
          return (await client.documentSymbols(args.filePath)) as DocumentSymbol[] | SymbolInfo[] | null
        })

        if (!result || result.length === 0) {
          return "No symbols found"
        }

        const total = result.length
        const limit = Math.min(args.limit ?? DEFAULT_MAX_SYMBOLS, DEFAULT_MAX_SYMBOLS)
        const truncated = total > limit
        const limited = truncated ? result.slice(0, limit) : result

        const lines: string[] = []
        if (truncated) {
          lines.push(`Found ${total} symbols (showing first ${limit}):`)
        }

        if ("range" in limited[0]) {
          lines.push(...(limited as DocumentSymbol[]).map((s) => formatDocumentSymbol(s)))
        } else {
          lines.push(...(limited as SymbolInfo[]).map(formatSymbolInfo))
        }
        return lines.join("\n")
      }
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

export const lsp_diagnostics: ToolDefinition = tool({
  description: "在构建前从语言服务器获取错误、警告和提示。",
  args: {
    filePath: tool.schema.string(),
    severity: tool.schema
      .enum(["error", "warning", "information", "hint", "all"])
      .optional()
      .describe("按严重级别过滤"),
  },
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.diagnostics(args.filePath)) as { items?: Diagnostic[] } | Diagnostic[] | null
      })

      let diagnostics: Diagnostic[] = []
      if (result) {
        if (Array.isArray(result)) {
          diagnostics = result
        } else if (result.items) {
          diagnostics = result.items
        }
      }

      diagnostics = filterDiagnosticsBySeverity(diagnostics, args.severity)

      if (diagnostics.length === 0) {
        const output = "No diagnostics found"
        return output
      }

      const total = diagnostics.length
      const truncated = total > DEFAULT_MAX_DIAGNOSTICS
      const limited = truncated ? diagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS) : diagnostics
      const lines = limited.map(formatDiagnostic)
      if (truncated) {
        lines.unshift(`Found ${total} diagnostics (showing first ${DEFAULT_MAX_DIAGNOSTICS}):`)
      }
      const output = lines.join("\n")
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      throw new Error(output)
    }
  },
})

export const lsp_prepare_rename: ToolDefinition = tool({
  description: "检查重命名是否有效。在使用lsp_rename之前调用。",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("从1开始计数"),
    character: tool.schema.number().min(0).describe("从0开始计数"),
  },
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.prepareRename(args.filePath, args.line, args.character)) as
          | PrepareRenameResult
          | PrepareRenameDefaultBehavior
          | null
      })
      const output = formatPrepareRenameResult(result)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})

export const lsp_rename: ToolDefinition = tool({
  description: "在整个工作区中重命名符号。将更改应用到所有文件。",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("从1开始计数"),
    character: tool.schema.number().min(0).describe("从0开始计数"),
    newName: tool.schema.string().describe("新的符号名称"),
  },
  execute: async (args, context) => {
    try {
      const edit = await withLspClient(args.filePath, async (client) => {
        return (await client.rename(args.filePath, args.line, args.character, args.newName)) as WorkspaceEdit | null
      })
      const result = applyWorkspaceEdit(edit)
      const output = formatApplyResult(result)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})
