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

/** Direct JSONL read — no RPC, no sessions_history, no polling */
async function waitForSubagentResult(
  childSessionKey: string,
  agentId: string,
  maxPollTimeMs: number,
  onProgress?: (msg: string) => void,
): Promise<{ text: string; timedOut: boolean }> {
  const sessionsDir = getSessionsDir(agentId);
  const sessionFile = path.join(sessionsDir, `${childSessionKey.split(":").at(-1)}.jsonl`);
  const pollIntervalMs = 2_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollTimeMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    try {
      if (!fs.existsSync(sessionFile)) continue;

      const lines = fs.readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
      if (lines.length === 0) continue;

      // Look for the last assistant message with actual text content
      const assistantMessages = lines
        .map((line) => {
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "message") return null;
            const msg = entry.message;
            if (msg?.role !== "assistant") return null;
            const content = msg.content ?? [];
            if (!Array.isArray(content)) return null;
            const textBlocks = content.filter(
              (c: unknown) => typeof c === "object" && (c as { type?: string }).type === "text",
            );
            if (textBlocks.length === 0) return null;
            const text = textBlocks
              .map((c: unknown) => (c as { text?: string }).text ?? "")
              .join("\n")
              .trim();
            if (!text) return null;
            return { text, ended: entry.endedAt ?? entry.message?.endedAt };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ text: string; ended?: number }>;

      if (assistantMessages.length > 0) {
        return { text: assistantMessages[assistantMessages.length - 1].text, timedOut: false };
      }
    } catch {
      // keep polling
    }

    if (onProgress) onProgress("...");
  }

  return {
    text: `Search timed out after ${Math.round(maxPollTimeMs / 1000)}s.`,
    timedOut: true,
  };
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

/** Gateway RPC call */
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
                { status: "error", error: "sessions directory not found", sessionsDir },
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

      // Spawn subagent via sessions_spawn (delivers result back to parent automatically)
      let childId = "";
      try {
        const result = await deps.callGateway({
          method: "sessions_spawn",
          params: {
            task: systemPrompt,
            label: "ltm-search",
            runtime: "subagent",
            sessionKey: childSessionKey,
            extraSystemPrompt: `## Search Parameters\nSessions directory: ${sessionsDir}\nQuery: ${input.query}\nmaxAgeDays: ${maxAgeDays}\nExclude current session file: ${currentSessionFile}`,
            delivery: { mode: "none" },
          },
          timeoutMs: 10_000,
        });
        const r = result as { childSessionKey?: string; runId?: string; status?: string; error?: string };
        if (r?.status === "error") {
          return {
            content: [{ type: "text", text: `Subagent spawn failed: ${r.error}` }],
            details: input,
          };
        }
        childId = r?.childSessionKey ?? "";
      } catch (err) {
        return syncGrep(sessionsDir, currentSessionFile, input.query, maxAgeDays, input);
      }

      if (!childId) {
        return syncGrep(sessionsDir, currentSessionFile, input.query, maxAgeDays, input);
      }

      // Poll the subagent's session file directly — no sessions_history RPC, no pollution
      const result = await waitForSubagentResult(
        childId,
        agentId,
        cfg.retrievalTimeoutSeconds * 1000,
      );

      if (result.timedOut) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "timeout",
                  childSessionKey: childId,
                  maxAgeDays,
                  query: input.query,
                },
                null,
                2,
              ),
            },
          ],
          details: input,
        };
      }

      return {
        content: [{ type: "text", text: result.text }],
        details: input,
      };
    },
  };
}

/**
 * Fallback: synchronous grep across session files.
 * Used when subagent spawning is not available.
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
