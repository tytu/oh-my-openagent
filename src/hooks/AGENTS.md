# 钩子知识库

## 概述

34 个生命周期钩子，拦截/修改 Agent 行为。事件类型：PreToolUse、PostToolUse、UserPromptSubmit、Stop、onSummarize。

## 结构

```
hooks/
├── atlas/                      # 主编排（604 行）
├── anthropic-context-window-limit-recovery/  # 自动摘要
├── todo-continuation-enforcer.ts # 强制 TODO 完成（410 行）
├── ralph-loop/                 # 自引用开发循环
├── claude-code-hooks/          # settings.json 兼容层 - 见 AGENTS.md
├── comment-checker/            # 防止 AI 垃圾内容
├── auto-slash-command/         # 检测 /command 模式
├── rules-injector/             # 条件规则
├── directory-agents-injector/  # 自动注入 AGENTS.md
├── directory-readme-injector/  # 自动注入 README.md
├── edit-error-recovery/        # 从失败中恢复
├── thinking-block-validator/   # 确保有效的 <thinking>
├── context-window-monitor.ts   # 提醒剩余空间
├── session-recovery/           # 从崩溃中自动恢复
├── think-mode/                 # 动态思考预算
├── keyword-detector/           # ultrawork/search/analyze 模式
├── background-notification/    # 系统通知
├── prometheus-md-only/         # 规划器只读模式
├── agent-usage-reminder/       # 专业 Agent 提示
├── auto-update-checker/        # 插件更新检查
├── tool-output-truncator.ts    # 防止上下文膨胀
├── compaction-context-injector/ # 压缩时注入上下文
├── language-reminder/           # 周期性中文提醒（每 N 次工具调用注入）
├── thinking-language-validator/ # thinking 块语言检测 + 纠正
├── delegate-task-retry/        # 重试失败的委派
├── runtime-fallback/           # Provider 错误自动 fallback（429/402/quota）
├── interactive-bash-session/   # Tmux 会话管理
├── non-interactive-env/        # 非 TTY 环境处理
├── start-work/                 # 主执行官工作会话启动器
├── task-resume-info/           # 已取消任务的恢复信息
├── question-label-truncator/   # 自动截断超过 30 字符的问题标签
├── perf-profiler/              # 性能分析（hooks 层）
├── empty-task-response-detector.ts # 检测空响应
└── index.ts                    # 钩子聚合 + 注册
```

## 钩子事件

| 事件 | 时机 | 可阻塞 | 使用场景 |
|-------|--------|-----------|----------|
| PreToolUse | 工具之前 | 是 | 验证/修改输入 |
| PostToolUse | 工具之后 | 否 | 追加警告、截断 |
| UserPromptSubmit | 提交提示时 | 是 | 关键词检测 |
| Stop | 会话空闲 | 否 | 自动继续 |
| onSummarize | 压缩时 | 否 | 保留状态 |

## 执行顺序

**chat.message**：keywordDetector → claudeCodeHooks → autoSlashCommand → startWork → ralphLoop

**tool.execute.before**：claudeCodeHooks → nonInteractiveEnv → commentChecker → directoryAgentsInjector → rulesInjector

**tool.execute.after**：editErrorRecovery → delegateTaskRetry → commentChecker → toolOutputTruncator → agentUsageReminder → languageReminder → thinkingLanguageValidator → claudeCodeHooks

## 如何添加

1. 创建 `src/hooks/name/` 目录，包含导出 `createMyHook(ctx)` 的 `index.ts`
2. 在 `src/config/schema.ts` 的 `HookNameSchema` 中添加钩子名称
3. 在 `src/index.ts` 中注册：
   ```typescript
   const myHook = isHookEnabled("my-hook") ? createMyHook(ctx) : null
   ```

## 模式

- **会话范围状态**：`Map<sessionID, Set<string>>`
- **条件执行**：处理前检查 `input.tool`
- **输出修改**：`output.output += "\n${REMINDER}"`

## 反模式

- **阻塞非关键操作**：使用 PostToolUse 警告代替
- **繁重计算**：保持 PreToolUse 轻量
- **冗余注入**：跟踪已注入的文件

## 语言约束

所有思考过程和输出必须使用中文。详细规则见根 `AGENTS.md`。

相关钩子：
1. **`language-reminder`**：周期性中文提醒（每 N 次工具调用注入）
2. **`thinking-language-validator`**：thinking 块语言检测 + 纠正
