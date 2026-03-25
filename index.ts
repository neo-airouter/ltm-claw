import * as fs from "fs";
import * as path from "path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createLtmSearchTool, setConfig, type LtmSearchConfig } from "./tool.js";
import { logStartupBannerOnce } from "./startup-banner-log.js";

const DEFAULT_WORKSPACE_DIR = "/tmp/ltm-claw";

const ltmSearchPlugin = {
  id: "ltm-claw",
  name: "LTM Claw",
  description:
    "Long-term memory (LTM) access for OpenClaw without bloating session context (using subagents). v1: session grep search.",

  configSchema: {
    parse(value: unknown) {
      const raw =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return {
        retrievalTimeoutSeconds:
          typeof raw.retrievalTimeoutSeconds === "number" ? raw.retrievalTimeoutSeconds : 200,
        workspaceDir:
          typeof raw.workspaceDir === "string" ? raw.workspaceDir : DEFAULT_WORKSPACE_DIR,
      } satisfies LtmSearchConfig;
    },
  },

  register(api: OpenClawPluginApi) {
    const config = ltmSearchPlugin.configSchema.parse(api.pluginConfig);
    setConfig(config);

    if (!fs.existsSync(config.workspaceDir)) {
      fs.mkdirSync(config.workspaceDir, { recursive: true });
    }

    const subagent = api.runtime.subagent;

    api.registerTool((ctx) => {
      const agentId = ctx.agentId ?? "main";
      const sessionsDir = path.join(
        process.env.HOME!,
        ".openclaw",
        "agents",
        agentId,
        "sessions",
      );

      // Pass ctx so createLtmSearchTool has access to sessionKey
      return createLtmSearchTool({ subagent, sessionsDir, agentId }, ctx);
    });

    logStartupBannerOnce({
      key: "plugin-loaded",
      log: (msg) => api.logger?.info(msg),
      message: "[plugins/ltm-claw] v1 loaded — session search via ltm_search",
    });
  },
};

export default ltmSearchPlugin;
