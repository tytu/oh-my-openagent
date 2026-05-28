import { describe, expect, it, beforeEach } from "bun:test"
import { createThinkingLanguageValidatorHook } from "./index"
import { THINKING_VALIDATOR_STORAGE } from "./constants"
import { loadThinkingValidatorState } from "./storage"
import { existsSync, rmSync } from "node:fs"

function makeToolInput(sessionID: string): any {
  return { tool: "read", sessionID, callID: `call-${sessionID}` }
}

function makeToolOutput(): any {
  return { title: "", output: "", metadata: {} }
}

describe("thinking-language-validator hook", () => {
  beforeEach(() => {
    // 清理持久化状态文件，防止测试间状态泄漏
    if (existsSync(THINKING_VALIDATOR_STORAGE)) {
      rmSync(THINKING_VALIDATOR_STORAGE, { recursive: true, force: true })
    }
  })

  it("T1: should inject reminder when English thinking violation detected", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - simulate message.part.updated with English thinking
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-1", role: "assistant" },
          part: { type: "thinking", text: "Let me start more searches and wait for the results of the explore agent" },
        },
      },
    })

    // then tool.execute.after should inject
    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-1"), output)

    // #then
    expect(output.output).toContain("[SYSTEM DIRECTIVE: OH-MY-OPENCODE - LANGUAGE]")
  })

  it("T2: should not inject reminder when Chinese thinking is not violation", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - simulate message.part.updated with Chinese thinking
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-2", role: "assistant" },
          part: { type: "thinking", text: "让我搜索一下这个库的文档，看看是否有相关的实现" },
        },
      },
    })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-2"), output)

    // #then - no violation for Chinese thinking
    expect(output.output).toBe("")
  })

  it("T3: should not inject duplicate reminder for same thinking content", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - same thinking content twice
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-3", role: "assistant" },
          part: { type: "thinking", text: "Let me start more searches and wait" },
        },
      },
    })

    const output1 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-3"), output1)
    expect(output1.output).toContain("LANGUAGE")

    // same content again
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-3", role: "assistant" },
          part: { type: "thinking", text: "Let me start more searches and wait" },
        },
      },
    })

    const output2 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-3"), output2)

    // #then - second call should NOT inject (same fingerprint)
    expect(output2.output).toBe("")
  })

  it("T4: should inject independent reminders for different messages", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - 3 different messages with violations
    const messages = [
      { sessionID: "ses-4a", text: "Let me search for documentation about this feature" },
      { sessionID: "ses-4b", text: "I need to check the API reference for this endpoint" },
      { sessionID: "ses-4c", text: "Let me analyze the code structure to understand the pattern" },
    ]

    for (const msg of messages) {
      await hook.event({
        event: {
          type: "message.part.updated",
          properties: {
            info: { sessionID: msg.sessionID, role: "assistant" },
            part: { type: "thinking", text: msg.text },
          },
        },
      })

      const output = makeToolOutput()
      await hook["tool.execute.after"](makeToolInput(msg.sessionID), output)

      // #then - each message should get independent reminder
      expect(output.output).toContain("[SYSTEM DIRECTIVE: OH-MY-OPENCODE - LANGUAGE]")
    }
  })

  it("T5: should skip excluded agents (librarian)", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - librarian agent with English thinking
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-5", role: "assistant", agent: "librarian" },
          part: { type: "thinking", text: "Let me search the documentation for this library" },
        },
      },
    })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-5"), output)

    // #then - no violation for excluded agent
    expect(output.output).toBe("")
  })

  it("T6: should clean up state on session.deleted", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - violation then session deleted
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-6", role: "assistant" },
          part: { type: "thinking", text: "Let me start more searches and wait" },
        },
      },
    })

    await hook.event({ event: { type: "session.deleted", properties: { info: { id: "ses-6" } } } })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-6"), output)

    // #then - state cleaned, no pending violation
    expect(output.output).toBe("")
  })

  it("T7: should throttle high-frequency streaming events", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - 5 consecutive updates with small text growth (< 100 chars)
    for (let i = 0; i < 5; i++) {
      await hook.event({
        event: {
          type: "message.part.updated",
          properties: {
            info: { sessionID: "ses-7", role: "assistant" },
            part: { type: "thinking", text: "Let me search" + "x".repeat(i * 10) },
          },
        },
      })
    }

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-7"), output)

    // #then - only first detection should trigger (subsequent growth < 100 chars)
    expect(output.output).toContain("[SYSTEM DIRECTIVE: OH-MY-OPENCODE - LANGUAGE]")
  })

  it("T8: should re-detect when text grows significantly (>= 100 chars)", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - first violation (text must be >= 20 meaningful chars)
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-8", role: "assistant" },
          part: { type: "thinking", text: "Let me search for the documentation" },
        },
      },
    })

    const output1 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-8"), output1)
    expect(output1.output).toContain("LANGUAGE")

    // text grows by >= 100 chars with more English content
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-8", role: "assistant" },
          part: { type: "thinking", text: "Let me search for the documentation and find the relevant API reference for this feature and understand the implementation details and the architecture" },
        },
      },
    })

    const output2 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-8"), output2)

    // #then - should re-detect and inject again
    expect(output2.output).toContain("[SYSTEM DIRECTIVE: OH-MY-OPENCODE - LANGUAGE]")
  })

  it("T9: should not detect non-thinking/reasoning parts", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - text part (not thinking/reasoning)
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-9", role: "assistant" },
          part: { type: "text", text: "Let me search the documentation for this library" },
        },
      },
    })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-9"), output)

    // #then - no detection for non-thinking parts
    expect(output.output).toBe("")
  })

  it("T10: should clean up state on session.compacted", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - violation then session compacted
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-10", role: "assistant" },
          part: { type: "thinking", text: "Let me start more searches and wait" },
        },
      },
    })

    await hook.event({ event: { type: "session.compacted", properties: { sessionID: "ses-10" } } })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-10"), output)

    // #then - state cleaned, no pending violation
    expect(output.output).toBe("")
  })
})

describe("detection counters", () => {
  beforeEach(() => {
    if (existsSync(THINKING_VALIDATOR_STORAGE)) {
      rmSync(THINKING_VALIDATOR_STORAGE, { recursive: true, force: true })
    }
  })

  it("T11: should initialize all counters to 0 for new session", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-11", role: "assistant" },
          part: { type: "thinking", text: "Let me search for the implementation" },
        },
      },
    })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-11"), output)

    // #then
    const state = loadThinkingValidatorState("ses-11")
    expect(state).not.toBeNull()
    expect(state!.totalDetectionCount).toBe(1)
    expect(state!.triggerWordHitCount).toBe(1)
    expect(state!.asciiRatioHitCount).toBe(0)
    expect(state!.dedupSkipCount).toBe(0)
    expect(state!.throttleSkipCount).toBe(0)
    expect(state!.reminderInjectedCount).toBe(1)
  })

  it("T12: should increment totalDetectionCount on each detection", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-12", role: "assistant" },
          part: { type: "thinking", text: "Let me check" },
        },
      },
    })

    const output1 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-12"), output1)

    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-12", role: "assistant" },
          part: { type: "thinking", text: "Let me check" + "x".repeat(100) },
        },
      },
    })

    const output2 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-12"), output2)

    // #then
    const state = loadThinkingValidatorState("ses-12")
    expect(state).not.toBeNull()
    expect(state!.totalDetectionCount).toBe(2)
  })

  it("T13: should increment triggerWordHitCount on trigger match", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-13", role: "assistant" },
          part: { type: "thinking", text: "Let me search for the implementation" },
        },
      },
    })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-13"), output)

    // #then
    const state = loadThinkingValidatorState("ses-13")
    expect(state).not.toBeNull()
    expect(state!.triggerWordHitCount).toBe(1)
    expect(state!.asciiRatioHitCount).toBe(0)
  })

  it("T14: should increment asciiRatioHitCount on ASCII ratio match", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-14", role: "assistant" },
          part: { type: "thinking", text: "This is a very long English sentence without any trigger words but has high ASCII ratio" },
        },
      },
    })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-14"), output)

    // #then
    const state = loadThinkingValidatorState("ses-14")
    expect(state).not.toBeNull()
    expect(state!.asciiRatioHitCount).toBe(1)
    expect(state!.triggerWordHitCount).toBe(0)
  })

  it("T15: should increment throttleSkipCount when throttled", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-15", role: "assistant" },
          part: { type: "thinking", text: "Let me search" + "x".repeat(10) },
        },
      },
    })

    for (let i = 0; i < 5; i++) {
      await hook.event({
        event: {
          type: "message.part.updated",
          properties: {
            info: { sessionID: "ses-15", role: "assistant" },
            part: { type: "thinking", text: "Let me search" + "x".repeat(10 + i * 10) },
          },
        },
      })
    }

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-15"), output)

    // #then
    const state = loadThinkingValidatorState("ses-15")
    expect(state).not.toBeNull()
    expect(state!.throttleSkipCount).toBe(5)
  })

  it("T16: should not dedup when fingerprint differs", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-16", role: "assistant" },
          part: { type: "thinking", text: "Let me check" },
        },
      },
    })

    const output1 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-16"), output1)

    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-16", role: "assistant" },
          part: { type: "thinking", text: "Let me check" + "x".repeat(100) },
        },
      },
    })

    const output2 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-16"), output2)

    // #then
    const state = loadThinkingValidatorState("ses-16")
    expect(state).not.toBeNull()
    expect(state!.totalDetectionCount).toBe(2)
    expect(state!.dedupSkipCount).toBe(0)
  })

  it("T17: should increment reminderInjectedCount on tool.execute.after", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-17", role: "assistant" },
          part: { type: "thinking", text: "Let me search for the implementation" },
        },
      },
    })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-17"), output)

    // #then
    const state = loadThinkingValidatorState("ses-17")
    expect(state).not.toBeNull()
    expect(state!.reminderInjectedCount).toBe(1)
  })

  it("T18: should persist counters across save/load cycle", async () => {
    // #given
    const hook1 = createThinkingLanguageValidatorHook({} as any)

    // #when
    await hook1.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-18", role: "assistant" },
          part: { type: "thinking", text: "Let me search for the implementation" },
        },
      },
    })

    const output1 = makeToolOutput()
    await hook1["tool.execute.after"](makeToolInput("ses-18"), output1)

    const hook2 = createThinkingLanguageValidatorHook({} as any)

    await hook2.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-18", role: "assistant" },
          part: { type: "thinking", text: "Let me search for the implementation" + "x".repeat(100) },
        },
      },
    })

    const output2 = makeToolOutput()
    await hook2["tool.execute.after"](makeToolInput("ses-18"), output2)

    // #then
    const state = loadThinkingValidatorState("ses-18")
    expect(state).not.toBeNull()
    expect(state!.totalDetectionCount).toBe(2)
    expect(state!.reminderInjectedCount).toBe(2)
  })

  it("T19: should reset counters on session.deleted", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when
    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-19", role: "assistant" },
          part: { type: "thinking", text: "Let me search for the implementation" },
        },
      },
    })

    const output1 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-19"), output1)

    await hook.event({ event: { type: "session.deleted", properties: { info: { id: "ses-19" } } } })

    await hook.event({
      event: {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "ses-19", role: "assistant" },
          part: { type: "thinking", text: "Let me search for the implementation" },
        },
      },
    })

    const output2 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-19"), output2)

    // #then
    const state = loadThinkingValidatorState("ses-19")
    expect(state).not.toBeNull()
    expect(state!.totalDetectionCount).toBe(1)
    expect(state!.reminderInjectedCount).toBe(1)
  })
})
