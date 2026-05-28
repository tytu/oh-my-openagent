# 共享工具知识库

## 概述

40 个横切工具：路径解析、token 截断、配置解析、模型解析、Agent 显示名称、provider 错误分类、retry 策略、runtime fallback。

## 结构

```
shared/
├── logger.ts              # 基于文件的日志
├── permission-compat.ts   # Agent 工具限制
├── dynamic-truncator.ts   # 感知 token 的截断
├── frontmatter.ts         # YAML 前置元数据
├── jsonc-parser.ts        # 带注释的 JSON
├── data-path.ts           # XDG 兼容存储
├── opencode-config-dir.ts # ~/.config/opencode
├── claude-config-dir.ts   # ~/.claude
├── migration.ts           # 旧版配置迁移
├── opencode-version.ts    # 版本比较
├── external-plugin-detector.ts # OAuth 欺骗检测
├── model-requirements.ts  # Agent/分类要求
├── model-availability.ts  # 模型获取 + 模糊匹配
├── model-resolver.ts      # 3 步解析
├── model-sanitizer.ts     # 模型 ID 规范化
├── shell-env.ts           # 跨平台 shell
├── agent-display-names.ts # Agent 显示名称映射
├── agent-tool-restrictions.ts # 工具限制辅助函数
├── agent-variant.ts       # Agent 变体检测
├── case-insensitive.ts    # 大小写不敏感匹配
├── command-executor.ts    # 子进程执行
├── config-errors.ts       # 配置错误类型
├── deep-merge.ts          # 深度对象合并
├── file-reference-resolver.ts # 文件路径解析
├── file-utils.ts          # 文件工具
├── fileio-monitor.ts      # 文件 I/O 监控
├── first-message-variant.ts # 首条消息变体
├── hook-disabled.ts       # 钩子启用/禁用检查
├── pattern-matcher.ts     # Glob 模式匹配
├── perf-timer.ts          # 性能计时工具
├── perf-tracer.ts         # 性能追踪工具
├── session-cursor.ts      # 会话光标跟踪
├── snake-case.ts          # 字符串大小写转换
├── system-directive.ts    # 系统提示辅助函数
├── tool-name.ts           # 工具名称常量
├── windows-reserved-names.ts # Windows 保留文件名检查
├── zip-extractor.ts       # ZIP 文件提取
├── provider-error-classifier.ts # Provider 错误分类（429/402/quota）
├── retry-strategy.ts      # Retry/backoff 策略
├── runtime-fallback.ts    # Runtime fallback 决策
├── index.ts               # Barrel 导出
└── *.test.ts              # 同目录测试
```

## 何时使用

| 任务 | 工具 |
|------|---------|
| 调试日志 | `log(message, data)` |
| 限制上下文 | `dynamicTruncate(ctx, sessionId, output)` |
| 解析前置元数据 | `parseFrontmatter(content)` |
| 加载 JSONC | `parseJsonc(text)` 或 `readJsoncFile(path)` |
| 限制工具 | `createAgentToolAllowlist(tools)` |
| 解析路径 | `getOpenCodeConfigDir()` |
| 比较版本 | `isOpenCodeVersionAtLeast("1.1.0")` |
| 解析模型 | `resolveModelWithFallback()` |
| Agent 显示名称 | `getAgentDisplayName(agentName)` |
| 分类 provider 错误 | `classifyProviderError(error)` |
| 计算 retry 延迟 | `calculateRetryDelay(attempt, config, retryAfterMs?)` |
| 获取 fallback 模型 | `resolveNextFallbackModel(input)` |

## 模式

```typescript
// 感知 token 的截断
const { result } = await dynamicTruncate(ctx, sessionID, buffer)

// JSONC 配置
const settings = readJsoncFile<Settings>(configPath)

// 版本门控
if (isOpenCodeVersionAtLeast("1.1.0")) { /* ... */ }

// 模型解析
const model = await resolveModelWithFallback(client, requirements, override)

// Provider 错误分类
const classification = classifyProviderError(error)
if (classification.shouldFallback) {
  const fallback = resolveNextFallbackModel({ currentModel, attempts, ... })
}

// Retry 策略
const decision = calculateRetryDelay(attempt, DEFAULT_RETRY_CONFIG, retryAfterMs)
if (decision.retryable) {
  await sleep(decision.delay_ms)
}
```

## 反模式

- **原始 JSON.parse**：使用 `jsonc-parser.ts`
- **硬编码路径**：使用 `*-config-dir.ts`
- **console.log**：后台使用 `logger.ts`
- **无界输出**：使用 `dynamic-truncator.ts`

## 语言约束

所有思考过程和输出必须使用中文。详细规则见根 `AGENTS.md`。
