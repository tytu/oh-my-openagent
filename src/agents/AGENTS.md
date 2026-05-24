# Agent 知识库

## 概述

10 个 AI Agent，每个有独特的角色和模型配置。所有 Agent 通过工厂函数创建，使用统一的 `AgentConfig` 接口。

## 结构

```
agents/
├── index.ts                # Barrel 导出
├── types.ts                # AgentConfig、AgentFactory 等类型
├── utils.ts                # agentSources 映射、辅助函数
├── sisyphus.ts             # 主编排器（Claude Opus 4.5）
├── atlas.ts                # 主控编排器（Claude Opus 4.5）
├── prometheus.ts           # 战略规划（Claude Opus 4.5）
├── prometheus-prompt.ts    # 规划提示词模板（1206 行）
├── oracle.ts               # 咨询、调试（GPT-5.2）
├── librarian.ts            # 文档、GitHub 搜索（Claude Sonnet 4.5）
├── explore.ts              # 快速代码搜索（Grok Code）
├── multimodal-looker.ts    # PDF/图片分析（Gemini 3 Flash）
├── momus.ts                # 计划审查员（Claude Opus 4.5）
├── metis.ts                # 预规划顾问（Claude Opus 4.5）
├── sisyphus-junior.ts      # Sisyphus-Junior：专注任务执行者（无委派权限）
├── dynamic-agent-prompt-builder.ts # 动态 Agent 提示词构建
└── *.test.ts               # 测试文件
```

## Agent 列表

| Agent | 模型 | 用途 | 温度 |
|-------|-------|---------|------|
| Sisyphus | anthropic/claude-opus-4-5 | 主编排器 | 0.1 |
| Atlas | anthropic/claude-opus-4-5 | 主控编排器 | 0.1 |
| Prometheus | anthropic/claude-opus-4-5 | 战略规划 | 0.1 |
| Oracle | openai/gpt-5.2 | 咨询、调试 | 0.1 |
| Librarian | opencode/big-pickle | 文档、GitHub 搜索 | 0.1 |
| Explore | opencode/gpt-5-nano | 快速代码搜索 | 0.1 |
| Multimodal Looker | google/gemini-3-flash | PDF/图片分析 | 0.1 |
| Momus | anthropic/claude-opus-4-5 | 计划审查员 | 0.1 |
| Metis | anthropic/claude-opus-4-5 | 预规划顾问 | 0.3 |
| Sisyphus-Junior | anthropic/claude-sonnet-4-5 | 专注任务执行 | 0.1 |

## 如何添加

1. 创建 `src/agents/my-agent.ts`
2. 导出工厂函数：
   ```typescript
   export function createMyAgent(model?: string): AgentConfig {
     return {
       name: "my-agent",
       model: model ?? "default-model",
       temperature: 0.1,
       prompt: MY_PROMPT,
       // ...
     }
   }
   ```
3. 在 `src/agents/utils.ts` 的 `agentSources` 中注册
4. 在 `src/config/schema.ts` 的 `AgentNameSchema` 中添加名称

## 模式

- **工厂函数**：`createXXXAgent(model?: string): AgentConfig`
- **元数据**：`XXX_PROMPT_METADATA`（分类、成本、触发器）
- **思考预算**：Sisyphus/Oracle/Prometheus/Atlas 使用 32k token

## 反模式

- **信任自我报告**：始终验证 Agent 输出
- **高温度**：代码 Agent 不超过 0.3
- **串行调用**：使用 `delegate_task` 并行

## 语言约束

**所有思考过程和输出必须使用中文。** 英文仅允许：
- 技术术语（API、库名、框架名、协议名）
- 代码标识符（变量、函数、类、类型、路径）
- Shell 命令和 Git 操作
- 代码块内容

详细规则见根 `AGENTS.md`。
