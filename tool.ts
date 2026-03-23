// Replaced @sinclair/typebox with inline schema to avoid runtime dependency
// (only used for tool definition, not validation)
type TSchema = Record<string, unknown>;
const Type = {
  Object: (schema: Record<string, unknown>) => schema,
  String: (opts?: Record<string, unknown>) => ({ type: "string", ...opts }),
  Number: (opts?: Record<string, unknown>) => ({ type: "number", ...opts }),
  Optional: (s: unknown) => s,
};
import crypto from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LtmSearchConfig {
  retrievalTimeoutSeconds?: number;
  workspaceDir?: string;
}

const DEFAULT_CONFIG = {
  retrievalTimeoutSeconds: 120,
  workspaceDir: "/tmp/ltm-claw",
};

let _cfg: Partial<LtmSearchConfig> = {};

export function setConfig(cfg: Partial<LtmSearchConfig>) {
  _cfg = cfg;
}

function getConfig() {
  return {
    retrievalTimeoutSeconds:
      _cfg.retrievalTimeoutSeconds ?? DEFAULT_CONFIG.retrievalTimeoutSeconds,
    workspaceDir: _cfg.workspaceDir ?? DEFAULT_CONFIG.workspaceDir,
  };
}

function getSessionsDir(agentId: string): string {
  return path.join(process.env.HOME!, ".openclaw", "agents", agentId, "sessions");
}

// ─── OpenClaw subagent runtime interface (matches PluginRuntime.subagent) ──────

interface SubagentRunParams {
  sessionKey: string;
  message: string;
  extraSystemPrompt?: string;
  lane?: string;
  deliver?: boolean;
  idempotencyKey?: string;
}

interface SubagentRunResult {
  runId: string;
}

interface SubagentWaitResult {
  status: "ok" | "error" | "timeout";
  error?: string;
}

interface SubagentMessagesResult {
  messages: unknown[];
}

export type SubagentRuntime = {
  run: (params: SubagentRunParams) => Promise<SubagentRunResult>;
  waitForRun: (params: { runId: string; timeoutMs?: number }) => Promise<SubagentWaitResult>;
  getSessionMessages: (params: { sessionKey: string; limit?: number }) => Promise<SubagentMessagesResult>;
};

// ─── Tool schema ──────────────────────────────────────────────────────────────

export const LtmSearchSchema = Type.Object(
  {
    query: Type.String({
      description:
        "Search query. Use when the user asks about past conversations, prior work, " +
        "things they mentioned before, history across sessions, or anything requiring " +
        "context from earlier sessions.",
    }),
    maxAge: Type.Optional(
      Type.Number({
        description: "Only search sessions modified within the last N days (default: 10).",
        minimum: 1,
      }),
    ),
    agentId: Type.Optional(
      Type.String({ description: "Agent ID to search sessions for (default: auto-detected)" }),
    ),
  },
  { additionalProperties: false },
);

export type LtmSearchInput = { query: string; maxAge?: number; agentId?: string };

type AgentToolResult<T> = {
  content: Array<{ type: "text"; text: string }>;
  details: T;
};

// ─── Session file reader (no RPC, no pollution) ───────────────────────────────

/**
 * Extract assistant text from a session JSONL file.
 * Reads the file directly — no sessions_history RPC needed.
 */
function extractAssistantTextFromSession(sessionFile: string): string | null {
  if (!fs.existsSync(sessionFile)) return null;

  const lines = fs.readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
  let lastAssistantText: string | null = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg?.role !== "assistant") continue;
      const content = msg.content ?? [];
      if (!Array.isArray(content)) continue;
      const textBlocks = content.filter(
        (c: unknown) =>
          typeof c === "object" && (c as { type?: string }).type === "text",
      );
      if (textBlocks.length === 0) continue;
      const text = textBlocks
        .map((c: unknown) => (c as { text?: string }).text ?? "")
        .join("\n")
        .trim();
      if (text) lastAssistantText = text;
    } catch {
      // skip unparseable lines
    }
  }

  return lastAssistantText;
}

// ─── Subagent-based search ───────────────────────────────────────────────────

export interface LtmSearchToolContext {
  sessionKey?: string;
  agentId?: string;
}

export interface LtmSearchDependencies {
  subagent: SubagentRuntime;
  sessionsDir: string;
  agentId: string;
}

export function createLtmSearchTool(deps: LtmSearchDependencies, ctx?: LtmSearchToolContext) {
  const cfg = getConfig();

  return {
    name: "ltm_search",
    label: "LTM Claw",
    description:
      "Search past session files for relevant context. Only searches sessions " +
      "modified within maxAge days (default: 10). Use when asked about past " +
      "conversations, prior work, or anything requiring context from earlier sessions.",

    parameters: LtmSearchSchema as unknown as TSchema,

    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<AgentToolResult<LtmSearchInput>> {
      const input = params as LtmSearchInput;
      const maxAgeDays = input.maxAge ?? 10;
      const { subagent, sessionsDir } = deps;
      const parentSessionKey = ctx?.sessionKey ?? "";

      // Read retrieval prompt
      const promptPath = path.join(__dirname, "retrieval.md");
      const systemPrompt = fs.readFileSync(promptPath, "utf8");

      // Build child session key — derive from parent to keep session hierarchy clean
      const childSessionKey = parentSessionKey
        ? `${parentSessionKey}!ltm-${crypto.randomUUID().slice(0, 8)}`
        : `ltm-${crypto.randomUUID().slice(0, 8)}`;
      const idempotencyKey = crypto.randomUUID();
      const sessionFile = path.join(sessionsDir, `${childSessionKey}.jsonl`);

      // Extra system prompt with search parameters
      const extraSystemPrompt =
        `## Search Parameters\n` +
        `Sessions directory: ${sessionsDir}\n` +
        `Query: ${input.query}\n` +
        `maxAgeDays: ${maxAgeDays}\n` +
        `Current session (exclude): ${parentSessionKey}\n` +
        `This subagent's session (exclude): ${childSessionKey}`;

      // Spawn subagent via OpenClaw runtime
      // deliver=true → subagent completes before HTTP response is sent
      // This avoids OpenClaw's tool-call timeout killing the request prematurely
      let runId: string;
      try {
        const result = await subagent.run({
          sessionKey: childSessionKey,
          message: systemPrompt,
          extraSystemPrompt,
          lane: "subagent",
          deliver: false, // async; we poll session file directly, no channel announce needed
          idempotencyKey,
        });
        runId = result.runId;
      } catch (err) {
        // Subagent spawning failed
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

      // Wait for completion — subagent should be done since deliver=true
      const waitResult = await subagent.waitForRun({
        runId,
        timeoutMs: cfg.retrievalTimeoutSeconds * 1000,
      });

      if (waitResult.status === "ok") {
        // Subagent finished — extract result from session file
        const text = extractAssistantTextFromSession(sessionFile);
        if (text) {
          return { content: [{ type: "text", text }], details: input };
        }
        // Session file empty even though run completed — try live messages
        try {
          const msgs = await subagent.getSessionMessages({ sessionKey: childSessionKey, limit: 5 });
          const last = msgs.messages.filter((m: any) => m.message?.role === "assistant").at(-1);
          if (last?.message?.content) {
            const texts = last.message.content.filter((c: any) => c.type === "text").map((c: any) => c.text);
            if (texts.length) return { content: [{ type: "text", text: texts.join("\n") }], details: input };
          }
        } catch { /* ignore */ }
      }

      if (waitResult.status === "error") {
        return {
          content: [{ type: "text", text: `Search error: ${waitResult.error}` }],
          details: input,
        };
      }

      // Timed out — subagent still running (API too slow)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "timeout",
                childSessionKey,
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
    },
  };
}
