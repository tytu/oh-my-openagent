import { describe, expect, it } from "bun:test"
import { createLanguageReminderHook } from "./index"
import { clearLanguageReminderState } from "./storage"

function makeToolInput(sessionID: string, tool = "read"): any {
  return { tool, sessionID, callID: `call-${sessionID}-${Date.now()}` }
}

function makeToolOutput(): any {
  return { title: "", output: "", metadata: {} }
}

const UID = `${Date.now()}-${Math.random().toString(36).slice(2)}`

describe("language-reminder hook", () => {
  it("should not inject reminder before reaching interval (default 5)", async () => {
    // #given
    const sid = `ses-a-${UID}`
    clearLanguageReminderState(sid)
    const hook = createLanguageReminderHook({} as any)

    // #when - 4 tool calls, each with fresh output
    for (let i = 0; i < 4; i++) {
      const output = makeToolOutput()
      await hook["tool.execute.after"](makeToolInput(sid), output)
      // #then - no reminder injected on calls 1-4
      expect(output.output).toBe("")
    }
  })

  it("should inject reminder at 5th call and reset counter", async () => {
    // #given
    const sid = `ses-b-${UID}`
    clearLanguageReminderState(sid)
    const hook = createLanguageReminderHook({} as any)
    const output = makeToolOutput()

    // #when - 5 tool calls
    for (let i = 0; i < 5; i++) {
      const input = makeToolInput(sid)
      await hook["tool.execute.after"](input, output)
    }

    // #then - reminder injected
    expect(output.output).toContain("[SYSTEM DIRECTIVE: OH-MY-OPENCODE - LANGUAGE]")
    expect(output.output).toContain("请用中文思考和回复")
  })

  it("should inject at 10th and 15th calls", async () => {
    // #given
    const sid = `ses-c-${UID}`
    clearLanguageReminderState(sid)
    const hook = createLanguageReminderHook({} as any)

    // #when - 15 tool calls, checking output at 5, 10, 15
    let got5 = false
    let got10 = false
    let got15 = false
    for (let i = 1; i <= 15; i++) {
      const output = makeToolOutput()
      await hook["tool.execute.after"](makeToolInput(sid), output)
      if (output.output.includes("LANGUAGE")) {
        if (i === 5) got5 = true
        else if (i === 10) got10 = true
        else if (i === 15) got15 = true
      }
    }

    // #then
    expect(got5).toBe(true)
    expect(got10).toBe(true)
    expect(got15).toBe(true)
  })

  it("should respect config reminder_interval", async () => {
    // #given
    const sid = `ses-d-${UID}`
    clearLanguageReminderState(sid)
    const ctx = { config: { language_enforcement: { reminder_interval: 3 } } } as any
    const hook = createLanguageReminderHook(ctx)

    // #when - 3 calls
    const output = makeToolOutput()
    for (let i = 0; i < 3; i++) {
      await hook["tool.execute.after"](makeToolInput(sid), output)
    }

    // #then
    expect(output.output).toContain("LANGUAGE")
  })

  it("should clean up state on session.deleted", async () => {
    // #given
    const sid = `ses-e-${UID}`
    clearLanguageReminderState(sid)
    const hook = createLanguageReminderHook({} as any)

    // #when - build up some state
    const output = makeToolOutput()
    for (let i = 0; i < 5; i++) {
      await hook["tool.execute.after"](makeToolInput(sid), output)
    }
    expect(output.output).toContain("LANGUAGE")

    // session.deleted
    await hook.event({ event: { type: "session.deleted", properties: { info: { id: sid } } } })

    // #then - state reset, next 5 calls should trigger again
    const output2 = makeToolOutput()
    for (let i = 0; i < 5; i++) {
      await hook["tool.execute.after"](makeToolInput(sid), output2)
    }
    expect(output2.output).toContain("LANGUAGE")
  })
})
