import * as fs from "fs";
import * as path from "path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createLtmSearchTool, setConfig, type LtmSearchConfig } from "./tool.js";
import { logStartupBannerOnce } from "./startup-banner-log.js";

const DEFAULT_WORKSPACE_DIR = "/tmp/ltm-retrieval";

const ltmSearchPlugin = {
  id: "ltm-claw",
  name: "LTM Claw",
  description: "Agent-managed long-term memory — session search, typed memories, knowledge graph",

  configSchema: {
    parse(value: unknown) {
      const raw =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return {
        retrievalModel: typeof raw.retrievalModel === "string" ? raw.retrievalModel : undefined,
        retrievalProvider: typeof raw.retrievalProvider === "string" ? raw.retrievalProvider : undefined,
        retrievalTimeoutSeconds:
          typeof raw.retrievalTimeoutSeconds === "number" ? raw.retrievalTimeoutSeconds : 60,
        workspaceDir:
          typeof raw.workspaceDir === "string" ? raw.workspaceDir : DEFAULT_WORKSPACE_DIR,
      } satisfies LtmSearchConfig;
    },
  },

  register(api: OpenClawPluginApi) {
    const config = ltmSearchPlugin.configSchema.parse(api.pluginConfig);
    setConfig(config);

    // Ensure workspace dir exists
    if (!fs.existsSync(config.workspaceDir)) {
      fs.mkdirSync(config.workspaceDir, { recursive: true });
    }

    // Build callGateway — mirrors lossless-claw's pattern, lane: "subagent" for child sessions
    const callGateway: Parameters<typeof createLtmSearchTool>[0]["callGateway"] = async ({
      method,
      params,
    }) => {
      return api.runtime.subagent.run({
        sessionKey: String(params?.sessionKey ?? ""),
        message: String(params?.message ?? ""),
        extraSystemPrompt: params?.extraSystemPrompt as string | undefined,
        lane: params?.lane as string | undefined,
        deliver: (params?.deliver as boolean) ?? false,
        
        idempotencyKey: params?.idempotencyKey as string | undefined,
      });
    };

    // Register tool factory — factory called per-turn with tool context
    api.registerTool((ctx) => {
      const agentId = ctx.agentId ?? "main";
      const sessionsDir = path.join(process.env.HOME!, ".openclaw", "agents", agentId, "sessions");
      const currentSessionFile = ctx.sessionKey
        ? path.join(sessionsDir, `${ctx.sessionKey}.jsonl`)
        : undefined;

      return createLtmSearchTool(
        { callGateway },
        { agentId, sessionKey: ctx.sessionKey, currentSessionFile },
      );
    });

    logStartupBannerOnce("[plugins/ltm-claw] v1 loaded — session search via ltm_search", api.logger);
  },
};

export default ltmSearchPlugin;
