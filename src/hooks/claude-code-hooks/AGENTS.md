# Claude Code 钩子兼容性

## 概述

完整的 Claude Code settings.json 钩子兼容性。5 个生命周期事件：PreToolUse、PostToolUse、UserPromptSubmit、Stop、PreCompact。

## 结构

```
claude-code-hooks/
├── index.ts              # 主工厂函数（401 行）
├── config.ts             # 加载 ~/.claude/settings.json
├── config-loader.ts      # 扩展配置
├── pre-tool-use.ts       # PreToolUse 执行器
├── post-tool-use.ts      # PostToolUse 执行器
├── user-prompt-submit.ts # UserPromptSubmit 执行器
├── stop.ts               # Stop 钩子执行器
├── pre-compact.ts        # PreCompact 执行器
├── transcript.ts         # 工具使用记录
├── tool-input-cache.ts   # Pre→Post 缓存
├── types.ts              # 钩子类型
└── todo.ts               # TODO JSON 修复
```

## 钩子生命周期

| 事件 | 时机 | 可阻塞 | 上下文 |
|-------|------|-----------|---------|
| PreToolUse | 工具之前 | 是 | sessionId, toolName, toolInput |
| PostToolUse | 工具之后 | 警告 | + toolOutput, transcriptPath |
| UserPromptSubmit | 消息提交时 | 是 | sessionId, prompt, parts |
| Stop | 会话空闲 | 注入 | sessionId, parentSessionId |
| PreCompact | 摘要之前 | 否 | sessionId |

## 配置来源

优先级（最高优先）：
1. `.claude/settings.json`（项目）
2. `~/.claude/settings.json`（用户）

## 钩子执行

1. 从 settings.json 加载钩子
2. 匹配器按工具名称过滤
3. 通过子进程执行命令，传递 `$SESSION_ID`、`$TOOL_NAME`
4. 退出码：0=通过、1=警告、2=阻塞

## 反模式

- **繁重的 PreToolUse**：在每次工具调用之前都会运行
- **阻塞非关键操作**：使用 PostToolUse 警告

## 语言约束

**所有思考过程和输出必须使用中文。** 英文仅允许：
- 技术术语（API、库名、框架名、协议名）
- 代码标识符（变量、函数、类、类型、路径）
- Shell 命令和 Git 操作
- 代码块内容

详细规则见根 `AGENTS.md`。
