# CLI 知识库

## 概述

CLI 工具：交互式安装、诊断、会话启动、版本管理。通过 `bunx oh-my-opencode` 调用。

## 结构

```
cli/
├── index.ts               # CLI 入口 + 子命令注册
├── install.ts             # 交互式安装
├── config-manager.ts      # JSONC 配置解析（551 行）
├── model-fallback.ts      # 模型 fallback 配置生成
├── run.ts                 # 会话启动
├── get-local-version/     # 本地版本检测
├── doctor/                # 诊断工具
│   ├── index.ts           # 诊断入口
│   ├── checks/            # 14 个诊断检查
│   └── types.ts           # CheckResult 等类型
└── __snapshots__/         # 测试快照
```

## 子命令

| 命令 | 用途 |
|------|------|
| `bunx oh-my-opencode install` | 交互式安装 |
| `bunx oh-my-opencode doctor` | 运行 14 项诊断 |
| `bunx oh-my-opencode run` | 启动会话 |

## 核心组件

### ConfigManager（551 行）

JSONC 配置解析和管理：
- 多层配置合并（项目 → 用户）
- JSONC 格式支持（注释、尾随逗号）
- bun install 自动执行
- 模块级可变状态 `configContext`

### Doctor（14 项检查）

诊断工具检查：
- OpenCode 版本
- 插件安装状态
- 配置文件有效性
- 依赖完整性
- MCP 服务器状态

## 模式

- **交互式安装**：使用 `@clack/prompts` 进行交互式配置
- **JSONC 支持**：使用 `jsonc-parser` 库解析
- **快照测试**：CLI 输出使用快照测试

## 反模式

- **硬编码路径**：使用 `getOpenCodeConfigDir()`
- **忽略错误**：所有操作都需要错误处理

## 语言约束

所有思考过程和输出必须使用中文。详细规则见根 `AGENTS.md`。
