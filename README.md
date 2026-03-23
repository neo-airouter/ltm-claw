# ltm-claw

**Plugin for OpenClaw.** Agent-managed long-term memory. Local-only.

## Versioning

| Version | What it does |
|---------|--------------|
| **v1** | `ltm_search` — grep session history via subagent. No schema, no embeddings. |
| **v2** | Typed memories + hybrid search + relationships (SQLite + llama-server) |
| **v3** | Graph traversal (`ltm_explore`) + reflection |
| **v4** | Self-evolution, memory hygiene |

See `ROADMAP.md` for milestones.

## Install — v1 (current)

v1 has no external dependencies (no SQLite, no embeddings). Just the subagent grep pipeline.

**Host requirements:** `python3` and `jq` must be available in the PATH. Install with `apt install python3 jq` (or equivalent).

Use OpenClaw's plugin installer (recommended):

```bash
openclaw plugins install @airouter.ch/ltm-claw
```

If you're running from a local OpenClaw checkout, use:

```bash
pnpm openclaw plugins install @airouter.ch/ltm-claw
```

Configure in OpenClaw (`~/.openclaw/openclaw.json`):

```json
{
  "plugins": {
    "entries": {
      "ltm-claw": {
        "enabled": true,
        "config": {
          "retrievalTimeoutSeconds": 60,
          "workspaceDir": "/tmp/ltm-claw"
        }
      }
    }
  }
}
```

Restart OpenClaw. The plugin creates `/tmp/ltm-claw` on first load. This is the subagent's scratch directory — kept empty so the subagent doesn't load any workspace files, keeping it fast.

## Install — v2 (future)

v2 requires a local embedding service: llama-server with Qwen3-Embedding on port 8001. Config fields `embeddingUrl` and `embeddingModel` will be documented here when v2 is implemented.

## v1 Tool

- `ltm_search` — search session history via grep + subagent

## v2 Tools (not yet implemented)

- `ltm_store` — save a typed memory (decision, correction, insight, fact, context)
- `ltm_search` — hybrid BM25 + vector search
- `ltm_connect` — link two memories with a relationship
- `ltm_supersedes` — mark a new memory as replacing old ones

## Storage

- v1: no DB, just `/tmp/ltm-claw` scratch directory for the subagent
- v2+: one SQLite DB per agent at `~/.openclaw/ltm-claw/<agentId>-memory-graph.db`
- WAL mode enabled
- Completely outside OpenClaw's own directories

## Docs

| File | Purpose |
|------|---------|
| `README.md` | This file — install, quick start |
| `SPEC.md` | Full specification — schema, tools, failure modes, decisions |
| `ROADMAP.md` | Version milestones, each referencing SPEC sections |

## References

See `SPEC.md §References` for research sources (Evo-Memory, Penfield, RedPlanet, Mem0, Zep, Supermemory, LoCoMo-Plus).
