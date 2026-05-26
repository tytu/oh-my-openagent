import { join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"

export const OPENCODE_STORAGE = getOpenCodeStorageDir()
export const LANGUAGE_REMINDER_STORAGE = join(
  OPENCODE_STORAGE,
  "language-reminder",
)

export const LANGUAGE_REMINDER_MESSAGE = `

[SYSTEM DIRECTIVE: OH-MY-OPENCODE - LANGUAGE]

请用中文思考和回复。这是身份级硬约束，不可在长会话中遗忘。
禁止在内部推理（Thought/Thinking）中使用英文，禁止在回复正文中使用英文句子。
技术术语、代码标识符、文件路径、Shell 命令、代码块内容允许保留英文。
如果你发现自己开始用英文思考，立即切换到中文。`
