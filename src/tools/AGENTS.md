# 工具知识库

## 概述

20+ 工具，提供 LSP、AST-Grep、搜索、会话管理、Agent 委派等能力。每个工具通过 `ToolDefinition` 接口定义。

## 结构

```
tools/
├── index.ts               # Barrel 导出 + builtinTools 注册
├── ast-grep/              # AST-aware 代码搜索和替换
├── background-task/       # background_output/cancel 工具
├── call-omo-agent/        # 调用 OMO Agent
├── delegate-task/         # 任务委派（基于分类路由）
├── glob/                  # 文件模式匹配
├── grep/                  # 内容搜索（ripgrep）
├── interactive-bash/      # Tmux 交互式终端
├── look-at/               # 媒体文件分析
├── lsp/                   # LSP 工具套件（6 个工具）
├── perf-profiler/         # 性能分析（工具层：client patch）
├── session-manager/       # 会话管理（list/read/search/info）
├── skill/                 # 技能加载
├── skill-mcp/             # 技能 MCP 调用
└── slashcommand/          # 斜杠命令执行
```

## 工具列表

| 工具 | 用途 | 文件 |
|------|------|------|
| `ast_grep_search` | AST-aware 代码搜索 | `ast-grep/` |
| `ast_grep_replace` | AST-aware 代码替换 | `ast-grep/` |
| `background_output` | 获取后台任务输出 | `background-task/` |
| `background_cancel` | 取消后台任务 | `background-task/` |
| `delegate_task` | 委派任务给子 Agent | `delegate-task/` |
| `glob` | 文件模式匹配 | `glob/` |
| `grep` | 内容搜索 | `grep/` |
| `interactive_bash` | Tmux 交互式终端 | `interactive-bash/` |
| `look_at` | 媒体文件分析 | `look-at/` |
| `lsp_diagnostics` | LSP 诊断 | `lsp/` |
| `lsp_find_references` | 查找引用 | `lsp/` |
| `lsp_goto_definition` | 跳转到定义 | `lsp/` |
| `lsp_symbols` | 文档/工作区符号 | `lsp/` |
| `lsp_rename` | 重命名符号 | `lsp/` |
| `lsp_prepare_rename` | 检查重命名有效性 | `lsp/` |
| `session_list` | 列出会话 | `session-manager/` |
| `session_read` | 读取会话 | `session-manager/` |
| `session_search` | 搜索会话 | `session-manager/` |
| `session_info` | 会话元数据 | `session-manager/` |
| `skill` | 加载技能 | `skill/` |
| `skill_mcp` | 技能 MCP 调用 | `skill-mcp/` |
| `slashcommand` | 执行斜杠命令 | `slashcommand/` |

## 如何添加

1. 创建 `src/tools/my-tool/` 目录
2. 创建标准结构：
   ```
   my-tool/
   ├── index.ts       # Barrel 导出
   ├── tools.ts       # ToolDefinition 实现
   ├── types.ts       # 类型定义
   └── constants.ts   # 常量
   ```
3. 在 `src/tools/index.ts` 的 `builtinTools` 中注册

## 模式

- **ToolDefinition 接口**：统一的工具定义格式
- **分类路由**：`delegate_task` 根据 category 选择最优 Agent
- **后台执行**：`run_in_background=true` 异步执行

## 反模式

- **串行 bash**：使用 `&&` 或委派
- **原始文件操作**：代码中不要 mkdir/touch/rm
- **sleep**：使用轮询循环

## 语言约束

所有思考过程和输出必须使用中文。详细规则见根 `AGENTS.md`。
