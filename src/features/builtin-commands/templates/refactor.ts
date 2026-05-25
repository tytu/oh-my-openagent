export const REFACTOR_TEMPLATE = `# 智能重构命令

## 用法
\`\`\`
/refactor <重构目标> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]

参数：
  重构目标：要重构的内容。可以是：
    - 文件路径：src/auth/handler.ts
    - 符号名称："AuthService class"
    - 模式："所有使用已弃用 API 的函数"
    - 描述："将验证逻辑提取到单独模块中"

选项：
  --scope：重构范围（默认：module）
    - file：仅单个文件
    - module：模块/目录范围
    - project：整个代码库

  --strategy：风险容忍度（默认：safe）
    - safe：保守，需要最大测试覆盖率
    - aggressive：允许在充分覆盖下进行更广泛的变更
\`\`\`

## 此命令的作用

执行智能、确定性的重构，具有完整的代码库感知能力。与盲目的查找替换不同，此命令：

1. **理解你的意图** - 分析你实际想要实现的目标
2. **映射代码库** - 在触碰任何代码之前构建确定的代码映射
3. **评估风险** - 评估测试覆盖率并确定验证策略
4. **精心规划** - 使用 Plan 代理创建详细计划
5. **精确执行** - 使用 LSP 和 AST-grep 逐步重构
6. **持续验证** - 每次更改后运行测试以确保零回归

---

# 阶段 0：意图关口（强制第一步）

**在任何操作之前，对请求进行分类和验证。**

## 步骤 0.1：解析请求类型

| 信号 | 分类 | 操作 |
|--------|----------------|--------|
| 特定文件/符号 | 明确 | 进入代码库分析 |
| "将 X 重构为 Y" | 明确转换 | 进入代码库分析 |
| "改进"、"清理" | 开放式 | **必须询问**："具体要改进什么？" |
| 范围模糊 | 不确定 | **必须询问**："哪些模块/文件？" |
| 缺乏上下文 | 不完整 | **必须询问**："期望的结果是什么？" |

## 步骤 0.2：验证理解

在继续之前，确认：
- [ ] 目标已明确识别
- [ ] 期望的结果已理解
- [ ] 范围已定义（file/module/project）
- [ ] 成功标准可以明确表述

**如果以上任何一点不清楚，提出澄清问题：**

\`\`\`
我想确保我正确理解了重构目标。

**我理解的是**：[你的理解]
**我不确定的是**：[具体的模糊之处]

我看到的选项：
1. [选项 A] - [影响]
2. [选项 B] - [影响]

**我的建议**：[带理由的建议]

我应该按照[建议]进行，还是您有其他偏好？
\`\`\`

## 步骤 0.3：创建初始待办事项

**在理解请求后立即创建待办事项：**

\`\`\`
TodoWrite([
  {"id": "phase-1", "content": "阶段 1：代码库分析 - 启动并行探索代理", "status": "pending", "priority": "high"},
  {"id": "phase-2", "content": "阶段 2：构建代码映射 - 映射依赖关系和影响区域", "status": "pending", "priority": "high"},
  {"id": "phase-3", "content": "阶段 3：测试评估 - 分析测试覆盖率和验证策略", "status": "pending", "priority": "high"},
  {"id": "phase-4", "content": "阶段 4：计划生成 - 调用 Plan 代理生成详细重构计划", "status": "pending", "priority": "high"},
  {"id": "phase-5", "content": "阶段 5：执行重构 - 逐步进行并持续验证", "status": "pending", "priority": "high"},
  {"id": "phase-6", "content": "阶段 6：最终验证 - 完整测试套件和回归检查", "status": "pending", "priority": "high"}
])
\`\`\`

---

# 阶段 1：代码库分析（并行探索）

**将 phase-1 标记为 in_progress。**

## 1.1：启动并行探索代理（后台）

使用 \`call_omo_agent\` 同时启动所有这些代理：

\`\`\`
// Agent 1: Find the refactoring target
call_omo_agent(
  subagent_type="explore",
  run_in_background=true,
  prompt="查找 [TARGET] 的所有出现和定义。
  报告：文件路径、行号、使用模式。"
)

// Agent 2: Find related code
call_omo_agent(
  subagent_type="explore", 
  run_in_background=true,
  prompt="查找所有导入、使用或依赖 [TARGET] 的代码。
  报告：依赖链、导入图。"
)

// Agent 3: Find similar patterns
call_omo_agent(
  subagent_type="explore",
  run_in_background=true,
  prompt="在代码库中查找与 [TARGET] 相似的代码模式。
  报告：类似实现、既定约定。"
)

// Agent 4: Find tests
call_omo_agent(
  subagent_type="explore",
  run_in_background=true,
  prompt="查找所有与 [TARGET] 相关的测试文件。
  报告：测试文件路径、测试用例名、覆盖率指标。"
)

// Agent 5: Architecture context
call_omo_agent(
  subagent_type="explore",
  run_in_background=true,
  prompt="查找 [TARGET] 周围的架构模式和模块组织。
  报告：模块边界、分层结构、使用的设计模式。"
)
\`\`\`

## 1.2：直接工具探索（在代理运行时）

在后台代理运行时，使用直接工具：

### 用于精确分析的 LSP 工具：

\`\`\`typescript
// 查找定义
LspGotoDefinition(filePath, line, character)  // 在哪里定义的？

// 查找工作区中的所有用法
LspFindReferences(filePath, line, character, includeDeclaration=true)

// 获取文件结构
LspDocumentSymbols(filePath)  // 层次结构大纲
LspWorkspaceSymbols(filePath, query="[target_symbol]")  // 按名称搜索

// 获取当前诊断信息
lsp_diagnostics(filePath)  // 开始前的错误和警告
\`\`\`

### 用于模式分析的 AST-Grep：

\`\`\`typescript
// 查找结构模式
ast_grep_search(
  pattern="function $NAME($$$) { $$$ }",  // 或相关模式
  lang="typescript",  // 或相关语言
  paths=["src/"]
)

// 预览重构（试运行）
ast_grep_replace(
  pattern="[old_pattern]",
  rewrite="[new_pattern]",
  lang="[language]",
  dryRun=true  // 始终先预览
)
\`\`\`

### 用于文本模式的 Grep：

\`\`\`
grep(pattern="[search_term]", path="src/", include="*.ts")
\`\`\`

## 1.3：收集后台结果

\`\`\`
background_output(task_id="[agent_1_id]")
background_output(task_id="[agent_2_id]")
...
\`\`\`

**收集所有结果后，将 phase-1 标记为 completed。**

---

# 阶段 2：构建代码映射（依赖映射）

**将 phase-2 标记为 in_progress。**

## 2.1：构建确定的代码映射

基于阶段 1 的结果，构建：

\`\`\`
## 代码映射：[目标]

### 核心文件（直接影响）
- \`path/to/file.ts:L10-L50\` - 主要定义
- \`path/to/file2.ts:L25\` - 关键用法

### 依赖关系图
\`\`\`
[目标]
├── 从以下模块导入：
│   ├── module-a（类型）
│   └── module-b（工具函数）
├── 被以下模块导入：
│   ├── consumer-1.ts
│   ├── consumer-2.ts
│   └── consumer-3.ts
└── 被以下模块使用：
    ├── handler.ts（直接调用）
    └── service.ts（依赖注入）
\`\`\`

### 影响区域
| 区域 | 风险级别 | 受影响的文件 | 测试覆盖率 |
|------|------------|----------------|---------------|
| 核心 | 高 | 3 个文件 | 85% 覆盖 |
| 消费者 | 中 | 8 个文件 | 70% 覆盖 |
| 边缘 | 低 | 2 个文件 | 50% 覆盖 |

### 已建立的模式
- 模式 A：[描述] - 在 N 处使用
- 模式 B：[描述] - 已建立的约定
\`\`\`

## 2.2：识别重构约束

基于代码映射：
- **必须遵循**：[已识别的现有模式]
- **不得破坏**：[关键依赖关系]
- **可以安全更改**：[隔离的代码区域]
- **需要迁移**：[破坏性变更的影响]

**将 phase-2 标记为 completed。**

---

# 阶段 3：测试评估（验证策略）

**将 phase-3 标记为 in_progress。**

## 3.1：检测测试基础设施

\`\`\`bash
# 检查测试命令
cat package.json | jq '.scripts | keys[] | select(test("test"))'

# 或者对于 Python
ls -la pytest.ini pyproject.toml setup.cfg

# 或者对于 Go
ls -la *_test.go
\`\`\`

## 3.2：分析测试覆盖率

\`\`\`
// 查找与目标相关的所有测试
call_omo_agent(
  subagent_type="explore",
  run_in_background=false,  // 需要同步执行
  prompt="分析 [目标] 的测试覆盖率：
  1. 哪些测试文件覆盖了此代码？
  2. 存在哪些测试用例？
  3. 有集成测试吗？
  4. 测试了哪些边缘情况？
  5. 预估覆盖率百分比？"
)
\`\`\`

## 3.3：确定验证策略

基于测试分析：

| 覆盖级别 | 策略 |
|----------------|----------|
| 高（>80%） | 每次步骤后运行现有测试 |
| 中（50-80%） | 运行测试 + 添加安全断言 |
| 低（<50%） | **暂停**：建议先添加测试 |
| 无 | **阻止**：拒绝激进重构 |

**如果覆盖率低或没有，询问用户：**

\`\`\`
[目标] 的测试覆盖率为 [级别]。

**风险评估**：在没有充分测试的情况下进行重构是危险的。

选项：
1. 先添加测试，然后重构（推荐）
2. 非常谨慎地进行，需要手动验证
3. 中止重构

你倾向于哪种方式？
\`\`\`

## 3.4：记录验证计划

\`\`\`
## 验证计划

### 测试命令
- 单元测试：\`bun test\` / \`npm test\` / \`pytest\` / 等
- 集成测试：[如果存在则填写命令]
- 类型检查：\`tsc --noEmit\` / \`pyright\` / 等

### 验证检查点
每次重构步骤后：
1. lsp_diagnostics → 零新错误
2. 运行测试命令 → 全部通过
3. 类型检查 → 干净

### 回归指标
- [必须通过的特定测试]
- [必须保留的行为]
- [不得更改的 API 契约]
\`\`\`

**将 phase-3 标记为 completed。**

---

# 阶段 4：计划生成（Plan 代理）

**将 phase-4 标记为 in_progress。**

## 4.1：调用 Plan 代理

\`\`\`
Task(
  subagent_type="plan",
  prompt="创建详细的重构计划：

  ## 重构目标
  [用户的原始请求]

  ## 代码映射（来自阶段 2）
  [在此插入代码映射]

  ## 测试覆盖率（来自阶段 3）
  [在此插入验证计划]

  ## 约束
  - 必须遵循现有模式：[列表]
  - 不得破坏：[关键路径]
  - 每次步骤后必须运行测试

  ## 要求
  1. 分解为原子重构步骤
  2. 每个步骤必须可独立验证
  3. 按依赖关系排序步骤（必须先做什么）
  4. 为每个步骤指定确切的文件和行范围
  5. 为每个步骤包含回滚策略
  6. 定义提交检查点"
)
\`\`\`

## 4.2：审查和验证计划

从 Plan 代理收到计划后：

1. **验证完整性**：所有识别出的文件都被处理了吗？
2. **验证安全性**：每个步骤可逆吗？
3. **验证顺序**：依赖关系被尊重了吗？
4. **验证验证**：测试命令指定了吗？

## 4.3：注册详细的待办事项

将 Plan 代理的输出转换为细粒度的待办事项：

\`\`\`
TodoWrite([
  // 计划中的每个步骤都成为一个待办事项
  {"id": "refactor-1", "content": "步骤 1：[描述]", "status": "pending", "priority": "high"},
  {"id": "verify-1", "content": "验证步骤 1：运行测试", "status": "pending", "priority": "high"},
  {"id": "refactor-2", "content": "步骤 2：[描述]", "status": "pending", "priority": "medium"},
  {"id": "verify-2", "content": "验证步骤 2：运行测试", "status": "pending", "priority": "medium"},
  // ... 为所有步骤继续
])
\`\`\`

**将 phase-4 标记为 completed。**

---

# 阶段 5：执行重构（确定性执行）

**将 phase-5 标记为 in_progress。**

## 5.1：执行协议

对于每个重构步骤：

### 步骤前
1. 将步骤待办事项标记为 \`in_progress\`
2. 读取当前文件状态
3. 验证 lsp_diagnostics 为基准线

### 执行步骤
使用适当的工具：

**对于符号重命名：**
\`\`\`typescript
lsp_prepare_rename(filePath, line, character)  // 验证重命名是否可行
lsp_rename(filePath, line, character, newName)  // 执行重命名
\`\`\`

**对于模式转换：**
\`\`\`typescript
// 先预览
ast_grep_replace(pattern, rewrite, lang, dryRun=true)

// 如果预览看起来不错，执行
ast_grep_replace(pattern, rewrite, lang, dryRun=false)
\`\`\`

**对于结构性变更：**
\`\`\`typescript
// 使用 Edit 工具进行精确修改
edit(filePath, oldString, newString)
\`\`\`

### 步骤后验证（强制）

\`\`\`typescript
// 1. 检查诊断信息
lsp_diagnostics(filePath)  // 必须保持干净或与基线一致

// 2. 运行测试
bash("bun test")  // 或相应的测试命令

// 3. 类型检查
bash("tsc --noEmit")  // 或相应的类型检查命令
\`\`\`

### 步骤完成
1. 如果验证通过 → 将步骤待办事项标记为 \`completed\`
2. 如果验证失败 → **立即停止并修复**

## 5.2：故障恢复协议

如果任何验证步骤失败：

1. **立即停止**
2. **回滚**失败的更改
3. **诊断**问题原因
4. **选项**：
   - 修复问题并重试
   - 跳过此步骤（如果可选）
   - 咨询 oracle 代理获取帮助
   - 请求用户指导

**绝不在测试失败的情况下进入下一步。**

## 5.3：提交检查点

在每个逻辑变更组之后：

\`\`\`bash
git add [changed-files]
git commit -m "refactor(scope): description

[details of what was changed and why]"
\`\`\`

**所有重构步骤完成后，将 phase-5 标记为 completed。**

---

# 阶段 6：最终验证（回归检查）

**将 phase-6 标记为 in_progress。**

## 6.1：完整测试套件

\`\`\`bash
# 运行完整测试套件
bun test  # 或 npm test、pytest、go test 等
\`\`\`

## 6.2：类型检查

\`\`\`bash
# 完整类型检查
tsc --noEmit  # 或等效命令
\`\`\`

## 6.3：Lint 检查

\`\`\`bash
# 运行 linter
eslint .  # 或等效命令
\`\`\`

## 6.4：构建验证（如适用）

\`\`\`bash
# 确保构建仍然正常
bun run build  # 或 npm run build 等
\`\`\`

## 6.5：最终诊断

\`\`\`typescript
// 检查所有已更改的文件
for (file of changedFiles) {
  lsp_diagnostics(file)  // 必须全部干净
}
\`\`\`

## 6.6：生成总结

\`\`\`markdown
## 重构完成

### 变更内容
- [所做的变更列表]

### 已修改的文件
- \`path/to/file.ts\` - [变更内容]
- \`path/to/file2.ts\` - [变更内容]

### 验证结果
- 测试：已通过（X/Y 通过）
- 类型检查：干净
- Lint：干净
- 构建：成功

### 未检测到回归
所有现有测试均通过。未引入新错误。
\`\`\`

**将 phase-6 标记为 completed。**

---

# 关键规则

## 绝不能做
- 在变更后跳过 lsp_diagnostics 检查
- 在测试失败的情况下继续
- 在不了解影响的情况下进行更改
- 使用 \`as any\`、\`@ts-ignore\`、\`@ts-expect-error\`
- 删除测试以使其通过
- 提交损坏的代码
- 在不了解现有模式的情况下进行重构

## 始终要做
- 先理解，再更改
- 先预览，再应用（ast_grep dryRun=true）
- 每次更改后都进行验证
- 遵循现有代码库模式
- 实时更新待办事项
- 在逻辑检查点提交
- 立即报告问题

## 中止条件
如果出现以下任何一种情况，**停止并咨询用户**：
- 目标代码的测试覆盖率为零
- 更改会破坏公共 API
- 重构范围不明确
- 连续 3 次验证失败
- 违反了用户定义的约束

---

# 工具使用理念

你已经了解这些工具。智能地使用它们：

## LSP 工具
利用 LSP 工具进行精确分析。关键模式：
- **先理解，再更改**：使用 \`LspGotoDefinition\` 掌握上下文
- **影响分析**：使用 \`LspFindReferences\` 在修改前映射所有用法
- **安全重构**：符号重命名使用 \`lsp_prepare_rename\` → \`lsp_rename\`
- **持续验证**：每次更改后使用 \`lsp_diagnostics\`

## AST-Grep
使用 \`ast_grep_search\` 和 \`ast_grep_replace\` 进行结构性转换。
**关键**：始终先使用 \`dryRun=true\` 预览，审查，然后执行。

## 代理
- \`explore\`：并行代码库模式发现
- \`plan\`：生成详细的重构计划
- \`oracle\`：只读咨询，用于复杂架构决策和调试
- \`librarian\`：**主动使用**，当遇到弃用方法或库迁移任务时。查询官方文档和 OSS 示例以获取现代替代方案。

## 弃用代码和库迁移
在重构过程中遇到弃用方法/API 时：
1. 触发 \`librarian\` 查找推荐的现代替代方案
2. **除非用户明确要求迁移，否则不要自动升级到最新版本**
3. 如果用户要求库迁移，在做出更改前使用 \`librarian\` 获取最新的 API 文档

---

**记住：没有测试的重构是鲁莽的。没有理解的重构是破坏性的。本命令确保你两者都不会做。**

<user-request>
$ARGUMENTS
</user-request>
`
