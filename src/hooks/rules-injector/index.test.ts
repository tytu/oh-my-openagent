import { describe, expect, it } from "bun:test"

describe("rules-injector index", () => {
  it("should import injectHookMessage from hook-message-injector", async () => {
    // #given
    // #when - import the module
    const mod = await import("./index")

    // #then - module exports createRulesInjectorHook
    expect(mod.createRulesInjectorHook).toBeDefined()
    expect(typeof mod.createRulesInjectorHook).toBe("function")
  })

  it("should create hook with tool.execute.after and event handlers", () => {
    // #given - minimal mock ctx
    const mockCtx = {
      directory: "/test",
    } as any
    const { createRulesInjectorHook } = require("./index")

    // #when
    const hook = createRulesInjectorHook(mockCtx)

    // #then
    expect(hook["tool.execute.after"]).toBeDefined()
    expect(typeof hook["tool.execute.after"]).toBe("function")
    expect(hook["tool.execute.before"]).toBeDefined()
    expect(hook["event"]).toBeDefined()
  })
})
