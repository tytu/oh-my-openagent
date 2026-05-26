import { join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"

export const OPENCODE_STORAGE = getOpenCodeStorageDir()
export const THINKING_VALIDATOR_STORAGE = join(
  OPENCODE_STORAGE,
  "thinking-language-validator",
)

export const THINKING_VIOLATION_REMINDER = `

[SYSTEM DIRECTIVE: OH-MY-OPENCODE - LANGUAGE]
检测到你的思考过程使用了英文。请立即切换回中文思考。
这是身份级硬约束，不可违反。非法例外不是借口。`
