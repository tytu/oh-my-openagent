# MCP 知识库

## 概述

内置 MCP（Model Context Protocol）服务器：websearch（Exa）、context7（文档）、grep_app（GitHub 搜索）。

## 结构

```
mcp/
├── index.ts           # MCP 配置注册
├── websearch.ts       # Exa 网页搜索
├── context7.ts        # Context7 文档查询
├── grep_app.ts        # GitHub 代码搜索
└── types.ts           # MCP 配置类型
```

## MCP 服务器

| 服务器 | 用途 | 配置 |
|--------|------|------|
| `websearch` | 网页搜索（Exa API） | 需要 `EXA_API_KEY` |
| `context7` | 官方文档查询 | 无需配置 |
| `grep_app` | GitHub 代码搜索 | 无需配置 |

## 三层 MCP 系统

1. **内置**：websearch、context7、grep_app（本目录）
2. **Claude Code 兼容**：`.mcp.json` 文件，支持 `${VAR}` 变量展开
3. **技能嵌入**：技能中的 YAML 前置元数据

## 如何添加

1. 创建 `src/mcp/my-mcp.ts`
2. 导出配置对象：
   ```typescript
   export const myMcpConfig = {
     name: "my-mcp",
     command: ["bunx", "my-mcp-server"],
     // ...
   }
   ```
3. 在 `src/mcp/index.ts` 中注册

## 模式

- **命令配置**：`command: string[]` 格式
- **环境变量**：使用 `${VAR}` 展开
- **延迟加载**：MCP 服务器按需启动

## 反模式

- **硬编码密钥**：使用环境变量
- **阻塞启动**：MCP 服务器应异步启动

## 语言约束

所有思考过程和输出必须使用中文。详细规则见根 `AGENTS.md`。
