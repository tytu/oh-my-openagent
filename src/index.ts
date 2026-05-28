import type { Plugin } from "@opencode-ai/plugin";
import {
  createTodoContinuationEnforcer,
  createContextWindowMonitorHook,
  createSessionRecoveryHook,
  createSessionNotification,
  createCommentCheckerHooks,
  createToolOutputTruncatorHook,
  createDirectoryAgentsInjectorHook,
  createDirectoryReadmeInjectorHook,
  createEmptyTaskResponseDetectorHook,
  createThinkModeHook,
  createClaudeCodeHooksHook,
  createAnthropicContextWindowLimitRecoveryHook,

  createCompactionContextInjector,
  createRulesInjectorHook,
  createBackgroundNotificationHook,
  createAutoUpdateCheckerHook,
  createKeywordDetectorHook,
  createAgentUsageReminderHook,
  createLanguageReminderHook,
  createThinkingLanguageValidatorHook,
  createNonInteractiveEnvHook,
  createInteractiveBashSessionHook,

  createThinkingBlockValidatorHook,
  createRalphLoopHook,
  createAutoSlashCommandHook,
  createEditErrorRecoveryHook,
  createDelegateTaskRetryHook,
  createTaskResumeInfoHook,
  createStartWorkHook,
  createAtlasHook,
  createPrometheusMdOnlyHook,
  createQuestionLabelTruncatorHook,
  createRuntimeFallbackHook,
} from "./hooks";
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from "./features/context-injector";
import { applyAgentVariant, resolveAgentVariant } from "./shared/agent-variant";
import { createFirstMessageVariantGate } from "./shared/first-message-variant";
import {
  discoverUserClaudeSkills,
  discoverProjectClaudeSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  mergeSkills,
} from "./features/opencode-skill-loader";
import { createBuiltinSkills } from "./features/builtin-skills";
import { getSystemMcpServerNames } from "./features/claude-code-mcp-loader";
import {
  setMainSession,
  getMainSessionID,
  setSessionAgent,
  updateSessionAgent,
  clearSessionAgent,
  subagentSessions,
} from "./features/claude-code-session-state";
import {
  builtinTools,
  createCallOmoAgent,
  createBackgroundTools,
  createLookAt,
  createSkillTool,
  createSkillMcpTool,
  createSlashcommandTool,
  discoverCommandsSync,
  sessionExists,
  createDelegateTask,
  interactive_bash,
  startTmuxCheck,
  lspManager,
} from "./tools";
import { BackgroundManager } from "./features/background-agent";
import { SkillMcpManager } from "./features/skill-mcp-manager";
import { initTaskToastManager } from "./features/task-toast-manager";
import { type FallbackModelEntry, type HookName } from "./config";
import { log, detectExternalNotificationPlugin, getNotificationConflictWarning, resetMessageCursor, includesCaseInsensitive, scanForReservedNames, formatReservedNamesWarning } from "./shared";
import { agentNameMatches } from "./shared/agent-display-names";
import { loadPluginConfig } from "./plugin-config";
import { createModelCacheState, getModelLimit } from "./plugin-state";
import { createConfigHandler } from "./plugin-handlers";
import { PerfTracer } from "./shared/perf-tracer"
import { createPerfProfilerHook } from "./hooks"
import { setFileIOMonitor, createFileIOMonitor } from "./shared/fileio-monitor"
import { patchSessionClient } from "./tools/perf-profiler/client-patch"

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  log("[OhMyOpenCodePlugin] ENTRY - plugin loading", { directory: ctx.directory })
  // Start background tmux check immediately
  startTmuxCheck();

  const pluginConfig = loadPluginConfig(ctx.directory, ctx);

  // Check for Windows reserved device names (nul, con, aux, etc.) that cause git snapshot failures
  if (process.platform === "win32") {
    const reservedNames = scanForReservedNames(ctx.directory, 3)
    if (reservedNames.length > 0) {
      console.warn(formatReservedNamesWarning(reservedNames))
      log("[oh-my-opencode] Windows reserved device names detected:", reservedNames)
    }
  }

  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);
  const firstMessageVariantGate = createFirstMessageVariantGate();
  const isHookEnabled = (hookName: HookName) => !disabledHooks.has(hookName);
  const parseConfiguredFallbackModels = (entries?: FallbackModelEntry[]) => entries?.map((entry) => {
    if ("model" in entry) {
      const separatorIndex = entry.model.indexOf("/")
      return {
        providerID: entry.model.slice(0, separatorIndex),
        modelID: entry.model.slice(separatorIndex + 1),
        variant: entry.variant,
      }
    }
    return entry
  })

  const modelCacheState = createModelCacheState();

  const contextWindowMonitor = isHookEnabled("context-window-monitor")
    ? createContextWindowMonitorHook(ctx)
    : null;
  const sessionRecovery = isHookEnabled("session-recovery")
    ? createSessionRecoveryHook(ctx, { experimental: pluginConfig.experimental })
    : null;
  const runtimeFallback = isHookEnabled("runtime-fallback") && pluginConfig.runtime_fallback?.enabled !== false
    ? createRuntimeFallbackHook(ctx, {
        config: pluginConfig.runtime_fallback,
        sessionRecovery: sessionRecovery ?? undefined,
        getConfiguredFallbackModels: (agent, category) => {
          const agentModels = agent && pluginConfig.agents?.[agent as keyof NonNullable<typeof pluginConfig.agents>]?.fallback_models
          if (agentModels) return parseConfiguredFallbackModels(agentModels)
          const categoryModels = category ? pluginConfig.categories?.[category]?.fallback_models : undefined
          return parseConfiguredFallbackModels(categoryModels)
        },
      })
    : null;
   
  // Check for conflicting notification plugins before creating session-notification
  let sessionNotification = null;
  if (isHookEnabled("session-notification")) {
    const forceEnable = pluginConfig.notification?.force_enable ?? false;
    const externalNotifier = detectExternalNotificationPlugin(ctx.directory);
    
    if (externalNotifier.detected && !forceEnable) {
      // External notification plugin detected - skip our notification to avoid conflicts
      console.warn(getNotificationConflictWarning(externalNotifier.pluginName!));
      log("session-notification disabled due to external notifier conflict", {
        detected: externalNotifier.pluginName,
        allPlugins: externalNotifier.allPlugins,
      });
    } else {
      sessionNotification = createSessionNotification(ctx);
    }
  }

  const commentChecker = isHookEnabled("comment-checker")
    ? createCommentCheckerHooks(pluginConfig.comment_checker)
    : null;
  const toolOutputTruncator = isHookEnabled("tool-output-truncator")
    ? createToolOutputTruncatorHook(ctx, {
        experimental: pluginConfig.experimental,
      })
    : null;
  const directoryAgentsInjector = isHookEnabled("directory-agents-injector")
    ? createDirectoryAgentsInjectorHook(ctx)
    : null;
  const directoryReadmeInjector = isHookEnabled("directory-readme-injector")
    ? createDirectoryReadmeInjectorHook(ctx)
    : null;
  const emptyTaskResponseDetector = isHookEnabled("empty-task-response-detector")
    ? createEmptyTaskResponseDetectorHook(ctx)
    : null;
  const thinkMode = isHookEnabled("think-mode") ? createThinkModeHook() : null;
  const claudeCodeHooks = createClaudeCodeHooksHook(
    ctx,
    {
      disabledHooks: (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
      keywordDetectorDisabled: !isHookEnabled("keyword-detector"),
    },
    contextCollector
  );
  const anthropicContextWindowLimitRecovery = isHookEnabled(
    "anthropic-context-window-limit-recovery"
  )
    ? createAnthropicContextWindowLimitRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
      })
    : null;
  const compactionContextInjector = isHookEnabled("compaction-context-injector")
    ? createCompactionContextInjector()
    : undefined;
  const rulesInjector = isHookEnabled("rules-injector")
    ? createRulesInjectorHook(ctx)
    : null;
  const autoUpdateChecker = isHookEnabled("auto-update-checker")
    ? createAutoUpdateCheckerHook(ctx, {
        showStartupToast: isHookEnabled("startup-toast"),
        isSisyphusEnabled: pluginConfig.sisyphus_agent?.disabled !== true,
        autoUpdate: pluginConfig.auto_update ?? true,
      })
    : null;
  const keywordDetector = isHookEnabled("keyword-detector")
    ? createKeywordDetectorHook(ctx, contextCollector)
    : null;
  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector);
  const agentUsageReminder = isHookEnabled("agent-usage-reminder")
    ? createAgentUsageReminderHook(ctx)
    : null;
  const languageReminder = isHookEnabled("language-reminder")
    ? createLanguageReminderHook(ctx)
    : null;
  const thinkingLanguageValidator = isHookEnabled("thinking-language-validator")
    ? createThinkingLanguageValidatorHook(ctx)
    : null;
  const nonInteractiveEnv = isHookEnabled("non-interactive-env")
    ? createNonInteractiveEnvHook(ctx)
    : null;
  const interactiveBashSession = isHookEnabled("interactive-bash-session")
    ? createInteractiveBashSessionHook(ctx)
    : null;

  const thinkingBlockValidator = isHookEnabled("thinking-block-validator")
    ? createThinkingBlockValidatorHook()
    : null;

  const ralphLoop = isHookEnabled("ralph-loop")
    ? createRalphLoopHook(ctx, {
        config: pluginConfig.ralph_loop,
        checkSessionExists: async (sessionId) => sessionExists(sessionId),
      })
    : null;

  const editErrorRecovery = isHookEnabled("edit-error-recovery")
    ? createEditErrorRecoveryHook(ctx)
    : null;

  const delegateTaskRetry = isHookEnabled("delegate-task-retry")
    ? createDelegateTaskRetryHook(ctx)
    : null;

  const startWork = isHookEnabled("start-work")
    ? createStartWorkHook(ctx)
    : null;

  const prometheusMdOnly = isHookEnabled("prometheus-md-only")
    ? createPrometheusMdOnlyHook(ctx)
    : null;

  const questionLabelTruncator = createQuestionLabelTruncatorHook();

  const taskResumeInfo = createTaskResumeInfoHook();

  const backgroundManager = new BackgroundManager(ctx, {
    ...pluginConfig.background_task,
    runtimeFallback: pluginConfig.runtime_fallback,
  });

  const atlasHook = isHookEnabled("atlas")
    ? createAtlasHook(ctx, { directory: ctx.directory, backgroundManager })
    : null;

  // ======== perf-profiler 初始化 ========
  const perfTracer = pluginConfig.experimental?.profiling?.enabled
    ? new PerfTracer({
        enabled: true,
        outputDir: pluginConfig.experimental.profiling.output_dir,
        slowThreshold: pluginConfig.experimental.profiling.slow_threshold_ms,
        memorySnapshotInterval: pluginConfig.experimental.profiling.memory_snapshot_interval,
      })
    : new PerfTracer({ enabled: false })

  const memoryProbes: Record<string, () => number> = {}
  if (perfTracer.isEnabled()) {
    memoryProbes.subagentSessions = () => subagentSessions.size
    memoryProbes.backgroundRunningTasks = () => backgroundManager.getRunningTasks().length
    memoryProbes.backgroundCompletedTasks = () => backgroundManager.getCompletedTasks().length
  }

  const perfProfiler = isHookEnabled("perf-profiler")
    ? createPerfProfilerHook({
        config: pluginConfig.experimental?.profiling ?? { enabled: false, slow_threshold_ms: 100, memory_snapshot_interval: 5, trace_api: true, trace_fileio: true, trace_polling: true },
        tracer: perfTracer,
        memoryProbes,
      })
    : null

  if (perfTracer.isEnabled()) {
    try { patchSessionClient(ctx.client, perfTracer) } catch {}
    try { setFileIOMonitor(createFileIOMonitor(perfTracer)) } catch {}
    try { backgroundManager.setPerfTracer(perfTracer) } catch {}
  }

  initTaskToastManager(ctx.client);

  const todoContinuationEnforcer = isHookEnabled("todo-continuation-enforcer")
    ? createTodoContinuationEnforcer(ctx, { backgroundManager })
    : null;

  if (sessionRecovery && todoContinuationEnforcer) {
    sessionRecovery.setOnAbortCallback(todoContinuationEnforcer.markRecovering);
    sessionRecovery.setOnRecoveryCompleteCallback(
      todoContinuationEnforcer.markRecoveryComplete
    );
  }

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? createBackgroundNotificationHook(backgroundManager)
    : null;
  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const callOmoAgent = createCallOmoAgent(ctx, backgroundManager);
  const isMultimodalLookerEnabled = !includesCaseInsensitive(
    pluginConfig.disabled_agents ?? [],
    "multimodal-looker"
  );
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null;
  const delegateTask = createDelegateTask({
    manager: backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: pluginConfig.agents?.["sisyphus-junior"]?.model,
    runtimeFallbackConfig: pluginConfig.runtime_fallback,
    agentFallbackModels: Object.fromEntries(Object.entries(pluginConfig.agents ?? {}).map(([agent, config]) => [agent, config?.fallback_models])),
  });
  const disabledSkills = new Set(pluginConfig.disabled_skills ?? []);
  const systemMcpNames = getSystemMcpServerNames();
  const builtinSkills = createBuiltinSkills().filter((skill) => {
    if (disabledSkills.has(skill.name as never)) return false;
    if (skill.mcpConfig) {
      for (const mcpName of Object.keys(skill.mcpConfig)) {
        if (systemMcpNames.has(mcpName)) return false;
      }
    }
    return true;
  });
  const includeClaudeSkills = pluginConfig.claude_code?.skills !== false;
  const [userSkills, globalSkills, projectSkills, opencodeProjectSkills] = await Promise.all([
    includeClaudeSkills ? discoverUserClaudeSkills() : Promise.resolve([]),
    discoverOpencodeGlobalSkills(),
    includeClaudeSkills ? discoverProjectClaudeSkills() : Promise.resolve([]),
    discoverOpencodeProjectSkills(),
  ]);
  const mergedSkills = mergeSkills(
    builtinSkills,
    pluginConfig.skills,
    userSkills,
    globalSkills,
    projectSkills,
    opencodeProjectSkills
  );
  const skillMcpManager = new SkillMcpManager();
  const getSessionIDForMcp = () => getMainSessionID() || "";
  const skillTool = createSkillTool({
    skills: mergedSkills,
    mcpManager: skillMcpManager,
    getSessionID: getSessionIDForMcp,
    gitMasterConfig: pluginConfig.git_master,
  });
  const skillMcpTool = createSkillMcpTool({
    manager: skillMcpManager,
    getLoadedSkills: () => mergedSkills,
    getSessionID: getSessionIDForMcp,
  });

  const commands = discoverCommandsSync();
  const slashcommandTool = createSlashcommandTool({
    commands,
    skills: mergedSkills,
  });

  const autoSlashCommand = isHookEnabled("auto-slash-command")
    ? createAutoSlashCommandHook({ skills: mergedSkills })
    : null;

  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
    modelCacheState,
  });

  // ======== perf-profiler 辅助函数 ========
  async function wrapWithTiming(
    tracer: PerfTracer, pipeline: string, hookName: string,
    fn: () => unknown, sessionID?: string, tool?: string
  ): Promise<void> {
    const start = performance.now()
    let error: string | undefined
    try { await fn() }
    catch (e) { error = String(e); throw e }
    finally { tracer.recordHook(pipeline, hookName, performance.now() - start, sessionID ?? "", tool, error) }
  }

  function getEventSessionID(input: { event: { type: string; properties?: unknown } }): string {
    const props = input.event.properties as Record<string, unknown> | undefined
    if (!props) return ""
    const info = props.info as { id?: string } | undefined
    if (input.event.type === "session.deleted" || input.event.type === "session.created") return info?.id ?? ""
    return (props.sessionID as string) ?? ""
  }

  return {
    tool: {
      ...builtinTools,
      ...backgroundTools,
      call_omo_agent: callOmoAgent,
      ...(lookAt ? { look_at: lookAt } : {}),
      delegate_task: delegateTask,
      skill: skillTool,
      skill_mcp: skillMcpTool,
      slashcommand: slashcommandTool,
      interactive_bash,
    },

    "chat.message": async (input, output) => {
      if (input.agent) {
        setSessionAgent(input.sessionID, input.agent);
      }

      const message = (output as { message: { variant?: string } }).message
      if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
        const variant = resolveAgentVariant(pluginConfig, input.agent)
        if (variant !== undefined) {
          message.variant = variant
        }
        firstMessageVariantGate.markApplied(input.sessionID)
      } else {
        applyAgentVariant(pluginConfig, input.agent, message)
      }

      const pipelineStart = performance.now()
      let hookCount = 0
      await wrapWithTiming(perfTracer, "chat.message", "keywordDetector", () => keywordDetector?.["chat.message"]?.(input, output), input.sessionID); hookCount++
      await wrapWithTiming(perfTracer, "chat.message", "claudeCodeHooks", () => claudeCodeHooks["chat.message"]?.(input, output), input.sessionID); hookCount++
      await wrapWithTiming(perfTracer, "chat.message", "autoSlashCommand", () => autoSlashCommand?.["chat.message"]?.(input, output), input.sessionID); hookCount++
      await wrapWithTiming(perfTracer, "chat.message", "startWork", () => startWork?.["chat.message"]?.(input, output), input.sessionID); hookCount++

      perfTracer.recordPipeline("chat.message", performance.now() - pipelineStart, hookCount, input.sessionID)

      if (ralphLoop) {
        const parts = (
          output as { parts?: Array<{ type: string; text?: string }> }
        ).parts;
        const promptText =
          parts
            ?.filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("\n")
            .trim() || "";

        const isRalphLoopTemplate =
          promptText.includes("You are starting a Ralph Loop") &&
          promptText.includes("<user-task>");
        const isCancelRalphTemplate = promptText.includes(
          "Cancel the currently active Ralph Loop"
        );

        if (isRalphLoopTemplate) {
          const taskMatch = promptText.match(
            /<user-task>\s*([\s\S]*?)\s*<\/user-task>/i
          );
          const rawTask = taskMatch?.[1]?.trim() || "";

          const quotedMatch = rawTask.match(/^["'](.+?)["']/);
          const prompt =
            quotedMatch?.[1] ||
            rawTask.split(/\s+--/)[0]?.trim() ||
            "Complete the task as instructed";

          const maxIterMatch = rawTask.match(/--max-iterations=(\d+)/i);
          const promiseMatch = rawTask.match(
            /--completion-promise=["']?([^"'\s]+)["']?/i
          );

          log("[ralph-loop] Starting loop from chat.message", {
            sessionID: input.sessionID,
            prompt,
          });
          ralphLoop.startLoop(input.sessionID, prompt, {
            maxIterations: maxIterMatch
              ? parseInt(maxIterMatch[1], 10)
              : undefined,
            completionPromise: promiseMatch?.[1],
          });
        } else if (isCancelRalphTemplate) {
          log("[ralph-loop] Cancelling loop from chat.message", {
            sessionID: input.sessionID,
          });
          ralphLoop.cancelLoop(input.sessionID);
        }
      }
    },

    "chat.params": async (
      input: {
        sessionID: string
        agent: string
        model: { id: string; providerID: string }
        provider: { source: string; info: unknown; options: Record<string, unknown> }
        message: { role: string; parts?: Array<{ type: string; text?: string }> }
      },
      output: {
        temperature: number
        topP: number
        topK: number
        maxOutputTokens: number | undefined
        options: Record<string, unknown>
      }
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await thinkMode?.["chat.params"]?.(input as any, output as any)

      if (runtimeFallback?.checkModelHealth) {
        const entry = runtimeFallback.checkModelHealth(input.model.providerID, input.model.id)
        if (entry && entry.lastCategory === "quota" && entry.errorCount > 0) {
          log("[runtime-fallback] WARN: model has recent quota errors", {
            modelKey: `${input.model.providerID}/${input.model.id}`,
            errorCount: entry.errorCount,
            lastErrorTime: new Date(entry.lastErrorTime).toISOString(),
            sessionID: input.sessionID,
          })
        }
      }
    },

    "experimental.chat.messages.transform": async (
      input: Record<string, never>,
      output: { messages: Array<{ info: unknown; parts: unknown[] }> }
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await contextInjectorMessagesTransform?.["experimental.chat.messages.transform"]?.(input, output as any);
      await thinkingBlockValidator?.[
        "experimental.chat.messages.transform"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]?.(input, output as any);

    },

    config: configHandler,

    event: async (input) => {
      const pipelineStart = performance.now()
      let hookCount = 0
      await perfProfiler?.event?.(input);
      const evtSessionID = getEventSessionID(input)
      await wrapWithTiming(perfTracer, "event", "autoUpdateChecker", () => autoUpdateChecker?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "claudeCodeHooks", () => claudeCodeHooks.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "backgroundNotificationHook", () => backgroundNotificationHook?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "sessionNotification", () => sessionNotification?.(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "todoContinuationEnforcer", () => todoContinuationEnforcer?.handler(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "contextWindowMonitor", () => contextWindowMonitor?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "directoryAgentsInjector", () => directoryAgentsInjector?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "directoryReadmeInjector", () => directoryReadmeInjector?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "rulesInjector", () => rulesInjector?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "thinkMode", () => thinkMode?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "anthropicContextWindowLimitRecovery", () => anthropicContextWindowLimitRecovery?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "runtimeFallback", () => runtimeFallback?.handler(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "agentUsageReminder", () => agentUsageReminder?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "languageReminder", () => languageReminder?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "thinkingLanguageValidator", () => thinkingLanguageValidator?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "interactiveBashSession", () => interactiveBashSession?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "ralphLoop", () => ralphLoop?.event(input), evtSessionID); hookCount++
      await wrapWithTiming(perfTracer, "event", "atlasHook", () => atlasHook?.handler(input), evtSessionID); hookCount++

      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.created") {
        const sessionInfo = props?.info as
          | { id?: string; title?: string; parentID?: string }
          | undefined;
        if (!sessionInfo?.parentID) {
          setMainSession(sessionInfo?.id);
        }
        firstMessageVariantGate.markSessionCreated(sessionInfo);
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id === getMainSessionID()) {
          setMainSession(undefined);
        }
        if (sessionInfo?.id) {
          clearSessionAgent(sessionInfo.id);
          resetMessageCursor(sessionInfo.id);
          firstMessageVariantGate.clear(sessionInfo.id);
          subagentSessions.delete(sessionInfo.id);
          await skillMcpManager.disconnectSession(sessionInfo.id);
          await lspManager.cleanupTempDirectoryClients();
        }
      }

      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined;
        const sessionID = info?.sessionID as string | undefined;
        const agent = info?.agent as string | undefined;
        const role = info?.role as string | undefined;
        if (sessionID && agent && role === "user") {
          updateSessionAgent(sessionID, agent);
        }
      }

      if (event.type === "session.error") {
        const sessionID = props?.sessionID as string | undefined;
        const error = props?.error;

        if (sessionRecovery?.isRecoverableError(error)) {
          const messageInfo = {
            id: props?.messageID as string | undefined,
            role: "assistant" as const,
            sessionID,
            error,
          };
          const recovered =
            await sessionRecovery.handleSessionRecovery(messageInfo);

          if (recovered && sessionID && sessionID === getMainSessionID()) {
            await ctx.client.session
              .prompt({
                path: { id: sessionID },
                body: { parts: [{ type: "text", text: "continue" }] },
                query: { directory: ctx.directory },
              })
              .catch(() => {});
          }
        }
      }

      perfTracer.recordPipeline("event", performance.now() - pipelineStart, hookCount, evtSessionID)
      perfTracer.flush()
    },

    "tool.execute.before": async (input, output) => {
      const pipelineStart = performance.now()
      let hookCount = 0
      await wrapWithTiming(perfTracer, "tool.execute.before", "questionLabelTruncator", () => questionLabelTruncator["tool.execute.before"]?.(input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.before", "claudeCodeHooks", () => claudeCodeHooks["tool.execute.before"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.before", "nonInteractiveEnv", () => nonInteractiveEnv?.["tool.execute.before"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.before", "commentChecker", () => commentChecker?.["tool.execute.before"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.before", "directoryAgentsInjector", () => directoryAgentsInjector?.["tool.execute.before"]?.(input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.before", "directoryReadmeInjector", () => directoryReadmeInjector?.["tool.execute.before"]?.(input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.before", "rulesInjector", () => rulesInjector?.["tool.execute.before"]?.(input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.before", "prometheusMdOnly", () => prometheusMdOnly?.["tool.execute.before"]?.(input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.before", "atlasHook", () => atlasHook?.["tool.execute.before"]?.(input, output), input.sessionID, input.tool); hookCount++

      if (input.tool === "task") {
        const args = output.args as Record<string, unknown>;
        const subagentType = args.subagent_type as string;
        const isExploreOrLibrarian = subagentType
          ? ["explore", "librarian"].some((a) => agentNameMatches(subagentType, a))
          : false

        args.tools = {
          ...(args.tools as Record<string, boolean> | undefined),
          delegate_task: false,
          ...(isExploreOrLibrarian ? { call_omo_agent: false } : {}),
        };
      }

      if (ralphLoop && input.tool === "slashcommand") {
        const args = output.args as { command?: string } | undefined;
        const command = args?.command?.replace(/^\//, "").toLowerCase();
        const sessionID = input.sessionID || getMainSessionID();

        if (command === "ralph-loop" && sessionID) {
          const rawArgs =
            args?.command?.replace(/^\/?(ralph-loop)\s*/i, "") || "";
          const taskMatch = rawArgs.match(/^["'](.+?)["']/);
          const prompt =
            taskMatch?.[1] ||
            rawArgs.split(/\s+--/)[0]?.trim() ||
            "Complete the task as instructed";

          const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i);
          const promiseMatch = rawArgs.match(
            /--completion-promise=["']?([^"'\s]+)["']?/i
          );

          ralphLoop.startLoop(sessionID, prompt, {
            maxIterations: maxIterMatch
              ? parseInt(maxIterMatch[1], 10)
              : undefined,
            completionPromise: promiseMatch?.[1],
          });
         } else if (command === "cancel-ralph" && sessionID) {
           ralphLoop.cancelLoop(sessionID);
         } else if (command === "ulw-loop" && sessionID) {
           const rawArgs =
             args?.command?.replace(/^\/?(ulw-loop)\s*/i, "") || "";
           const taskMatch = rawArgs.match(/^["'](.+?)["']/);
           const prompt =
             taskMatch?.[1] ||
             rawArgs.split(/\s+--/)[0]?.trim() ||
             "Complete the task as instructed";

           const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i);
           const promiseMatch = rawArgs.match(
             /--completion-promise=["']?([^"'\s]+)["']?/i
           );

           ralphLoop.startLoop(sessionID, prompt, {
             ultrawork: true,
             maxIterations: maxIterMatch
               ? parseInt(maxIterMatch[1], 10)
               : undefined,
             completionPromise: promiseMatch?.[1],
           });
          }
      }

      perfTracer.recordPipeline("tool.execute.before", performance.now() - pipelineStart, hookCount, input.sessionID)
    },

    "tool.execute.after": async (input, output) => {
      const pipelineStart = performance.now()
      let hookCount = 0
      await wrapWithTiming(perfTracer, "tool.execute.after", "claudeCodeHooks", () => claudeCodeHooks["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "toolOutputTruncator", () => toolOutputTruncator?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "contextWindowMonitor", () => contextWindowMonitor?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "commentChecker", () => commentChecker?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "directoryAgentsInjector", () => directoryAgentsInjector?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "directoryReadmeInjector", () => directoryReadmeInjector?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "rulesInjector", () => rulesInjector?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "emptyTaskResponseDetector", () => emptyTaskResponseDetector?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "agentUsageReminder", () => agentUsageReminder?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "languageReminder", () => languageReminder?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "thinkingLanguageValidator", () => thinkingLanguageValidator?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "interactiveBashSession", () => interactiveBashSession?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "editErrorRecovery", () => editErrorRecovery?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "delegateTaskRetry", () => delegateTaskRetry?.["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "atlasHook", () => atlasHook?.["tool.execute.after"]?.(input, output), input.sessionID, input.tool); hookCount++
      await wrapWithTiming(perfTracer, "tool.execute.after", "taskResumeInfo", () => taskResumeInfo["tool.execute.after"](input, output), input.sessionID, input.tool); hookCount++

      perfTracer.recordPipeline("tool.execute.after", performance.now() - pipelineStart, hookCount, input.sessionID)
    },
  };
};

export default OhMyOpenCodePlugin;

export type {
  OhMyOpenCodeConfig,
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  McpName,
  HookName,
  BuiltinCommandName,
} from "./config";

// NOTE: Do NOT export functions from main index.ts!
// OpenCode treats ALL exports as plugin instances and calls them.
// Config error utilities are available via "./shared/config-errors" for internal use only.
export type { ConfigLoadError } from "./shared/config-errors";
