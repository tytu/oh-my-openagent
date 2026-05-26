import { describe, expect, it } from "bun:test"
import { createThinkingLanguageValidatorHook } from "./index"

function makeToolInput(sessionID: string): any {
  return { tool: "read", sessionID, callID: `call-${sessionID}` }
}

function makeToolOutput(): any {
  return { title: "", output: "", metadata: {} }
}

describe("thinking-language-validator hook", () => {
  it("should inject reminder when pending violation exists", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - simulate message.updated with English thinking
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "ses-1",
          message: {
            id: "msg-1",
            role: "assistant",
            agent: "sisyphus",
            parts: [{ type: "thinking", thinking: "Let me start more searches and wait for the results of the explore agent" }],
          },
        },
      },
    })

    // then tool.execute.after should inject
    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-1"), output)

    // #then
    expect(output.output).toContain("[SYSTEM DIRECTIVE: OH-MY-OPENCODE - LANGUAGE]")
  })

  it("should only inject once per violation", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - one violation, two tool calls
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "ses-2",
          message: {
            id: "msg-2",
            role: "assistant",
            agent: "sisyphus",
            parts: [{ type: "thinking", thinking: "Let me start more searches and wait" }],
          },
        },
      },
    })

    const output1 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-2"), output1)
    expect(output1.output).toContain("LANGUAGE")

    const output2 = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-2"), output2)

    // #then - second call should NOT inject
    expect(output2.output).toBe("")
  })

  it("should skip excluded agents", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when - librarian agent with English thinking
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "ses-3",
          message: {
            id: "msg-3",
            role: "assistant",
            agent: "librarian",
            parts: [{ type: "thinking", thinking: "Let me search the documentation for this library" }],
          },
        },
      },
    })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-3"), output)

    // #then - no violation for excluded agent
    expect(output.output).toBe("")
  })

  it("should clean up state on session.deleted", async () => {
    // #given
    const hook = createThinkingLanguageValidatorHook({} as any)

    // #when
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "ses-4",
          message: { id: "m", role: "assistant", agent: "sisyphus", parts: [{ type: "thinking", thinking: "Let me start more searches and wait" }] },
        },
      },
    })

    await hook.event({ event: { type: "session.deleted", properties: { info: { id: "ses-4" } } } })

    const output = makeToolOutput()
    await hook["tool.execute.after"](makeToolInput("ses-4"), output)

    // #then - state cleaned, no pending violation
    expect(output.output).toBe("")
  })
})
