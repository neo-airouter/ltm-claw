import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import crypto from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LtmSearchConfig {
  retrievalModel?: string | null;
  retrievalProvider?: string | null;
  retrievalTimeoutSeconds?: number;
  workspaceDir?: string;
}

const DEFAULT_CONFIG = {
  retrievalModel: undefined as string | undefined,
  retrievalProvider: undefined as string | undefined,
  retrievalTimeoutSeconds: 200,
  workspaceDir: "/tmp/ltm-retrieval",
};

let _cfg: Partial<LtmSearchConfig> = {};

export function setConfig(cfg: Partial<LtmSearchConfig>) {
  _cfg = cfg;
}

function getConfig() {
  return {
    retrievalModel: _cfg.retrievalModel ?? DEFAULT_CONFIG.retrievalModel,
    retrievalProvider: _cfg.retrievalProvider ?? DEFAULT_CONFIG.retrievalProvider,
    retrievalTimeoutSeconds: _cfg.retrievalTimeoutSeconds ?? DEFAULT_CONFIG.retrievalTimeoutSeconds,
    workspaceDir: _cfg.workspaceDir ?? DEFAULT_CONFIG.workspaceDir,
  };
}

function getSessionsDir(agentId: string): string {
  return path.join(process.env.HOME!, ".openclaw", "agents", agentId, "sessions");
}

export const LtmSearchSchema = Type.Object(
  {
    query: Type.String({
      description:
        "Search query. Use when the user asks about past conversations, prior work, " +
        "things they mentioned before, history across sessions, or anything requiring " +
        "context from earlier sessions (e.g. 'what did I work on last week', " +
        "'remember when we discussed X', 'did I ever mention Y', " +
        "'search my sessions for Z').",
    }),
    maxAge: Type.Optional(
      Type.Number({
        description:
          "Only search sessions modified within the last N days (default: 10). " +
          "Set higher for older context (e.g. 30 for 'a month ago', 90 for 'last year').",
        minimum: 1,
      }),
    ),
    agentId: Type.Optional(
      Type.String({ description: "Agent ID to search sessions for (default: auto-detected)" }),
    ),
  },
  { additionalProperties: false },
);

export type LtmSearchInput = {
  query: string;
  maxAge?: number;
  agentId?: string;
};

type AgentToolResult<T> = {
  content: Array<{ type: "text"; text: string }>;
  details: T;
};

/** Gateway RPC call — mirrors lossless-claw's CallGatewayFn */
type CallGatewayFn = (params: {
  method: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}) => Promise<unknown>;

export interface LtmSearchDependencies {
  callGateway: CallGatewayFn;
}

export interface LtmSearchToolContext {
  agentId?: string;
  sessionKey?: string;
  currentSessionFile?: string;
}

export function createLtmSearchTool(
  deps: LtmSearchDependencies,
  toolCtx?: LtmSearchToolContext,
) {
  return {
    name: "ltm_search",
    label: "LTM Claw",
    description:
      "Search past session files for relevant context. Only searches sessions " +
      "modified within maxAge days (default: 10). Use when asked about past " +
      "conversations, prior work, things mentioned before, or anything requiring " +
      "context from earlier sessions.",

    parameters: LtmSearchSchema as unknown as TSchema,

    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<AgentToolResult<LtmSearchInput>> {
      const cfg = getConfig();
      const input = params as LtmSearchInput;
      const agentId = input.agentId ?? toolCtx?.agentId ?? "main";
      const sessionsDir = getSessionsDir(agentId);
      const maxAgeDays = input.maxAge ?? 10;
      const currentSessionFile = toolCtx?.currentSessionFile ?? "";

      if (!fs.existsSync(sessionsDir)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: "sessions directory not found", sessionsDir },
                null,
                2,
              ),
            },
          ],
          details: input,
        };
      }

      // Read retrieval prompt
      const promptPath = path.join(__dirname, "retrieval.md");
      const systemPrompt = fs.readFileSync(promptPath, "utf8");

      const parentSessionKey = toolCtx?.sessionKey ?? "";
      const childSessionKey = parentSessionKey
        ? `${parentSessionKey}!ltm-${crypto.randomUUID()}`
        : "";

      if (!parentSessionKey) {
        // No parent session — fall back to sync grep
        return syncGrep(sessionsDir, currentSessionFile, input.query, maxAgeDays, input);
      }

      // Step 1: Spawn subagent via api.runtime.subagent.run()
      // Requires OpenClaw with withGatewayRequestScope fix (in main since commit a1520d70,
      // coming in next release after 2026.3.13). Falls back to sync grep if this fails.
      let runId = "";
      try {
        const result = await deps.callGateway({
          method: "agent",
          params: {
            message: systemPrompt,
            sessionKey: childSessionKey,
            deliver: false,
            lane: "subagent",
            idempotencyKey: crypto.randomUUID(),
            extraSystemPrompt: `\n\n## Search Parameters\nSessions directory: ${sessionsDir}\nQuery: ${input.query}\nmaxAgeDays: ${maxAgeDays}\nExclude current session file: ${currentSessionFile}`,
          },
          timeoutMs: 5_000,
        });
        runId = (result as { runId?: string })?.runId ?? "";
      } catch (err) {
        return syncGrep(sessionsDir, currentSessionFile, input.query, maxAgeDays, input);
      }

      if (!runId) {
        return syncGrep(sessionsDir, currentSessionFile, input.query, maxAgeDays, input);
      }

      // Step 2: Poll sessions_history on child session until subagent finishes
      const pollIntervalMs = 2_000;
      const maxPollTimeMs = cfg.retrievalTimeoutSeconds * 1_000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxPollTimeMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        try {
          const sessionResult = await deps.callGateway({
            method: "sessions_history",
            params: { sessionKey: childSessionKey, limit: 20, includeTools: false },
            timeoutMs: 10_000,
          });

          const messages = (sessionResult as { messages?: unknown[] })?.messages ?? [];
          if (messages.length === 0) continue;

          const readableResults = messages
            .map((m) => {
              const msg = m as { type?: string; message?: { role?: string; content?: unknown[] } };
              if (msg.type !== "message" || msg.message?.role !== "assistant") return null;
              const content = msg.message.content ?? [];
              return content
                .filter((c: unknown) => typeof c === "object" && (c as { type?: string }).type === "text")
                .map((c: unknown) => (c as { text?: string }).text ?? "")
                .join("\n")
                .trim();
            })
            .filter(Boolean);

          return {
            content: [
              {
                type: "text",
                text: readableResults.join("\n\n") || "search completed but returned no readable output",
              },
            ],
            details: input,
          };
        } catch {
          // Keep polling
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { status: "timeout", runId, maxAgeDays, query: input.query },
              null,
              2,
            ),
          },
        ],
        details: input,
      };
    },
  };
}

/**
 * Fallback: synchronous grep across session files.
 * Used when subagent spawning is not available (pre-fix OpenClaw).
 */
function syncGrep(
  sessionsDir: string,
  currentSessionFile: string,
  query: string,
  maxAgeDays: number,
  input: LtmSearchInput,
): AgentToolResult<LtmSearchInput> {
  const results: Array<{ sessionId: string; mtime: string; entries: string[] }> = [];

  try {
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));

    for (const file of files) {
      if (file === path.basename(currentSessionFile)) continue;

      const filePath = path.join(sessionsDir, file);
      const stat = fs.statSync(filePath);
      const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > maxAgeDays) continue;

      let matches: string[] = [];
      try {
        const { execSync } = require("child_process");
        const escapedQuery = query.replace(/'/g, "'\\''");
        const output = execSync(
          `grep -i '${escapedQuery}' '${filePath.replace(/'/g, "'\\''")}' 2>/dev/null`,
          { timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
        );
        const lines = output.toString().trim().split("\n").filter(Boolean);
        matches = lines.filter((l: string) => {
          try {
            JSON.parse(l);
            return true;
          } catch {
            return false;
          }
        });
      } catch {
        // no matches
      }

      if (matches.length > 0) {
        results.push({
          sessionId: file.replace(".jsonl", ""),
          mtime: stat.mtime.toISOString().split("T")[0],
          entries: matches,
        });
      }
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { status: "error", error: err instanceof Error ? err.message : String(err) },
            null,
            2,
          ),
        },
      ],
      details: input,
    };
  }

  if (results.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { status: "no matches", query, maxAgeDays, agentId: input.agentId ?? "auto" },
            null,
            2,
          ),
        },
      ],
      details: input,
    };
  }

  const formatted = results.map(({ sessionId, mtime, entries }) => {
    return `## ${sessionId} (${mtime})\n\n${entries.map((e) => `\`\`\`json\n${e}\n\`\`\``).join("\n\n")}`;
  });

  return {
    content: [{ type: "text", text: formatted.join("\n\n") }],
    details: input,
  };
}
