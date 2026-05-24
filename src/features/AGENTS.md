# 功能模块知识库

## 概述

核心功能模块：后台 Agent 管理、内置技能/命令、Claude Code 兼容层、上下文注入、技能 MCP 管理。

## 结构

```
features/
├── background-agent/              # 后台任务管理器（1326 行）
│   ├── manager.ts                 # BackgroundManager 类
│   ├── concurrency.ts             # 并发限制
│   ├── perf-aggregator.ts         # 性能聚合
│   ├── storage.ts                 # 任务存储
│   └── types.ts                   # BackgroundTask 等类型
├── builtin-skills/                # 内置技能
│   ├── skills.ts                  # 技能定义（886 行）
│   ├── frontend-ui-ux/            # 前端 UI/UX 技能
│   └── git-master/                # Git 操作技能
├── builtin-commands/              # 内置命令
│   ├── commands.ts                # 命令注册
│   └── templates/                 # 命令模板（refactor 等）
├── claude-code-agent-loader/      # Claude Code Agent 加载
├── claude-code-command-loader/    # Claude Code 命令加载
├── claude-code-mcp-loader/        # Claude Code MCP 加载
├── claude-code-plugin-loader/     # Claude Code 插件加载
├── claude-code-session-state/     # Claude Code 会话状态
├── context-injector/              # 上下文注入
├── hook-message-injector/         # Hook 消息注入
├── opencode-skill-loader/         # OpenCode 技能加载
├── skill-mcp-manager/             # 技能 MCP 管理（459 行）
├── task-toast-manager/            # 任务通知管理
├── boulder-state/                 # Boulder 状态管理（工作进度持久化）
└── index.ts                       # Barrel 导出
```

## 核心组件

### BackgroundManager（1326 行）

后台任务生命周期管理器：
- 任务队列和并发控制
- 按提供商/模型的并发限制
- 性能指标聚合
- 静态清理注册（进程退出时清理）

### SkillMcpManager（459 行）

MCP 客户端生命周期管理：
- 延迟加载（首次使用时连接）
- 5 分钟空闲自动清理
- 多 MCP 服务器支持

### Claude Code 兼容层

5 个加载器实现 Claude Code 兼容：
- Agent 加载（`.claude/agents/`）
- 命令加载（`.claude/commands/`）
- MCP 加载（`.mcp.json`）
- 插件加载（settings.json）
- 会话状态同步

## 如何添加

### 添加内置技能

1. 创建 `src/features/builtin-skills/my-skill/` 目录
2. 创建 `SKILL.md` 文件（YAML 前置元数据 + 内容）
3. 在 `src/features/builtin-skills/skills.ts` 中注册

### 添加内置命令

1. 在 `src/features/builtin-commands/templates/` 创建模板
2. 在 `src/features/builtin-commands/commands.ts` 中注册

## 模式

- **延迟加载**：MCP 连接按需建立
- **并发控制**：按提供商/模型限制并发数
- **静态清理**：进程退出时自动清理资源

## 反模式

- **串行委派**：使用 `delegate_task` 并行
- **信任自我报告**：始终验证 Agent 输出
- **主线程阻塞**：繁重 I/O 放入后台

## 语言约束

**所有思考过程和输出必须使用中文。** 英文仅允许：
- 技术术语（API、库名、框架名、协议名）
- 代码标识符（变量、函数、类、类型、路径）
- Shell 命令和 Git 操作
- 代码块内容

详细规则见根 `AGENTS.md`。
