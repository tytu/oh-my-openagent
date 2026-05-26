# 项目知识库

**生成时间：** 2026-05-26T18:30:00+08:00
**分支：** master
**提交：** d537c18

## 概述

OpenCode 插件：多模型 Agent 编排（Claude Opus 4.5, GPT-5.2, Gemini 3 Flash, Grok Code, GLM-4.7）。34 个生命周期钩子，20+ 工具（LSP、AST-Grep、委派），10 个专业 Agent，完整的 Claude Code 兼容性，7 个平台专属二进制包。OpenCode 的 "oh-my-zsh"。

## 结构

```
oh-my-opencode/
├── src/
│   ├── agents/        # 10 个 AI Agent - 见 src/agents/AGENTS.md
│   ├── hooks/         # 34 个生命周期钩子 - 见 src/hooks/AGENTS.md
│   ├── tools/         # 20+ 工具 - 见 src/tools/AGENTS.md
│   ├── features/      # 后台 Agent、Claude Code 兼容 - 见 src/features/AGENTS.md
│   ├── shared/        # 40 个横切工具 - 见 src/shared/AGENTS.md
│   ├── cli/           # CLI 安装器、诊断 - 见 src/cli/AGENTS.md
│   ├── mcp/           # 内置 MCP - 见 src/mcp/AGENTS.md
│   ├── config/               # Zod 模式、TypeScript 类型 - 见 src/config/AGENTS.md
│   ├── plugin-handlers/      # 配置处理器
│   └── index.ts              # 主插件入口（676 行）
├── script/            # build-schema.ts, build-binaries.ts
├── packages/          # 7 个平台专属二进制包
└── dist/              # 构建输出（ESM + .d.ts）
```

## 查阅指南

| 任务 | 位置 | 说明 |
|------|----------|-------|
| 添加 Agent | `src/agents/` | 创建带工厂函数的 .ts 文件，添加到 `agentSources` |
| 添加钩子 | `src/hooks/` | 创建目录，包含 `createXXXHook()`，在 index.ts 中注册 |
| 添加工具 | `src/tools/` | 目录包含 index/types/constants/tools.ts |
| 添加 MCP | `src/mcp/` | 创建配置，添加到 index.ts |
| 添加技能 | `src/features/builtin-skills/` | 创建目录，包含 SKILL.md |
| 添加命令 | `src/features/builtin-commands/` | 添加模板 + 在 commands.ts 中注册 |
| 配置模式 | `src/config/schema.ts` | Zod 模式，运行 `bun run build:schema` |
| 后台 Agent | `src/features/background-agent/` | manager.ts（1335 行） |
| 编排器 | `src/hooks/atlas/` | 主编排钩子（773 行） |

## TDD（测试驱动开发）

**强制要求。** 红-绿-重构：
1. **红**：编写测试 → `bun test` → 失败
2. **绿**：实现最小代码 → 通过
3. **重构**：清理代码 → 保持通过状态

**规则：**
- 永远不要在测试之前编写实现
- 永远不要删除失败的测试——修复代码
- 测试文件：`*.test.ts` 与源文件放在一起
- BDD 注释：`#given`、`#when`、`#then`
- 114 个测试文件（已知不稳定：ralph-loop CI 超时、session-state 并行污染）

## 约定

- **包管理器**：仅限 Bun（`bun run`、`bun build`、`bunx`）
- **类型**：bun-types（永远不要使用 @types/node）
- **构建**：`bun build`（ESM）+ `tsc --emitDeclarationOnly`
- **导出**：通过 index.ts 的 Barrel 模式
- **命名**：kebab-case 目录名，`createXXXHook`/`createXXXTool` 工厂函数
- **测试**：BDD 注释，114 个测试文件
- **温度**：代码 Agent 用 0.1，最大 0.3
- **格式化**：无独立 Prettier/ESLint 配置，依赖 OpenCode 内置格式化器和 LSP
- **发布**：仅通过 GitHub Actions `workflow_dispatch`，`script/publish.ts` 管理版本同步
- **主入口约束**：禁止从 `src/index.ts` 导出非类型函数（OpenCode 将所有导出视为插件实例）

## 反模式

| 类别 | 禁止项 |
|----------|-----------|
| 包管理器 | npm、yarn — 仅限 Bun |
| 类型 | @types/node — 使用 bun-types |
| 文件操作 | 代码中使用 mkdir/touch/rm/cp/mv — 使用 bash 工具 |
| 发布 | 直接 `bun publish` — 仅通过 GitHub Actions |
| 版本管理 | 本地版本提升 — 由 CI 管理 |
| 类型安全 | `as any`、`@ts-ignore`、`@ts-expect-error` |
| 错误处理 | 空的 catch 块 |
| 测试 | 删除失败的测试 |
| Agent 调用 | 串行 — 使用 `delegate_task` 并行 |
| 钩子逻辑 | 繁重的 PreToolUse — 会拖慢每次调用 |
| 提交 | 巨大（3+ 文件），将测试与实现分开 |
| 温度 | 代码 Agent 超过 0.3 |
| 信任 | Agent 自我报告 — 始终验证 |

## 语言约束（硬性禁止）

**所有思考过程和输出必须使用中文。** 此约束适用于所有 Agent、Sub-Agent、`delegate_task` 子任务。详细规则由 `language-reminder` + `thinking-language-validator` 钩子在运行时强制注入。

- **允许英文**：代码标识符、文件路径、Shell/Git 命令、技术名词、API 名、代码块内容
- **禁止**：英文思考、英文回复、翻译标识符/命令/路径、Sub-Agent 输出英文
- **继承**：`delegate_task` prompt 必须传递语言约束；如 Sub-Agent 违规，主 Agent 须纠正

## Agent 模型

| Agent | 模型 | 用途 |
|-------|-------|---------|
| Sisyphus | anthropic/claude-opus-4-5 | 主编排器 |
| Atlas | anthropic/claude-opus-4-5 | 主控编排器 |
| oracle | openai/gpt-5.2 | 咨询、调试 |
| librarian | opencode/big-pickle | 文档、GitHub 搜索 |
| explore | opencode/gpt-5-nano | 快速代码搜索 |
| multimodal-looker | google/gemini-3-flash | PDF/图片分析 |
| Prometheus | anthropic/claude-opus-4-5 | 战略规划 |
| Momus | anthropic/claude-opus-4-5 | 计划审查员 |
| Metis | anthropic/claude-opus-4-5 | 预规划顾问 |
| Sisyphus-Junior | anthropic/claude-sonnet-4-5 | 专注任务执行（无委派权限） |

## 命令

```bash
bun run typecheck      # 类型检查
bun run build          # ESM + 声明 + 模式
bun run rebuild        # 清理 + 构建
bun test               # 114 个测试文件
```

## 部署

**仅限 GitHub Actions workflow_dispatch**
1. 提交并推送更改
2. 触发：`gh workflow run publish -f bump=patch`
3. 永远不要直接 `bun publish`，永远不要本地版本提升

## 复杂度热点

| 文件 | 行数 | 描述 |
|------|-------|-------------|
| `src/features/background-agent/manager.ts` | 1326 | 任务生命周期、并发、runtime fallback |
| `src/agents/prometheus-prompt.ts` | 900 | 规划 Agent 提示词 |
| `src/features/builtin-skills/skills.ts` | 886 | 技能定义 |
| `src/tools/delegate-task/tools.ts` | 789 | 基于分类的委派 |
| `src/index.ts` | 676 | 主插件入口 |
| `src/hooks/atlas/index.ts` | 604 | 编排器钩子 |
| `src/cli/config-manager.ts` | 551 | JSONC 配置解析 |
| `src/tools/lsp/client.ts` | 523 | LSP JSON-RPC 客户端 |
| `src/shared/provider-error-classifier.ts` | 494 | Provider 错误分类（429/402/quota）|
| `src/agents/atlas.ts` | 463 | Atlas 编排器 Agent |
| `src/features/builtin-commands/templates/refactor.ts` | 458 | 重构命令模板 |
| `src/hooks/todo-continuation-enforcer.ts` | 410 | TODO 强制完成 |
| `src/agents/momus.ts` | 341 | 计划审查员 |
| `src/hooks/runtime-fallback/index.ts` | 358 | Runtime fallback hook（session.status 处理）|
| `src/shared/runtime-fallback.ts` | 163 | Runtime fallback 决策服务 |

## MCP 架构

三层系统：
1. **内置**：websearch（Exa）、context7（文档）、grep_app（GitHub）
2. **Claude Code 兼容**：支持 `${VAR}` 变量展开的 .mcp.json
3. **技能嵌入**：技能中的 YAML 前置元数据

## 配置系统

- **Zod 验证**：`src/config/schema.ts`
- **JSONC 支持**：注释、尾随逗号
- **多层**：项目（`.opencode/`）→ 用户（`~/.config/opencode/`）
- **语言约束**：`language_enforcement` 配置块，控制周期性提醒（`reminder_interval`）、违规检测阈值（`violation_threshold`）、豁免 Agent（`excluded_agents`）

## Runtime Fallback 系统

自动处理 provider 错误（quota、rate_limit、402）：

**事件拦截点**：
1. `session.status(type="retry")` — sub-agent quota 错误的主要拦截点
2. `session.error` — 传统错误事件
3. `message.updated` — 消息级错误
4. `message.part.updated(RetryPart)` — 重试循环事件

**关键组件**：
- `classifyTextMessage()` — 从纯文本消息分类错误（用于 session.status）
- `classifyProviderError()` — 从结构化错误对象分类
- `modelHealthRegistry` — 模型健康状态跟踪（TTL 1 小时，最多 100 条目）
- `checkModelHealth()` — 查询模型健康状态（chat.params 中使用）

**注意事项**：
- `session.prompt` 成功只表示消息被队列，不代表模型调用成功
- 不要在 prompt 成功后清空 `fallbackAttempts`，否则会导致无限循环
- 所有 retryAttempt 非 undefined 的事件都需要先 abort 再 fallback

## 说明

- **OpenCode**：需要 >= 1.0.150
- **不稳定测试**：ralph-loop（CI 超时）、session-state（并行污染）
- **受信任依赖**：@ast-grep/cli、@ast-grep/napi、@code-yeongyu/comment-checker
