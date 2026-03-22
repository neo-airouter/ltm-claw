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

```bash
cd ~/.openclaw/workspace/projects
git clone https://github.com/airouter-ch/ltm-claw.git
cd ltm-claw
npm install
```

Configure in OpenClaw:
```json
{
  "plugins": {
    "entries": [{
      "id": "ltm-claw",
      "path": "/home/chris/.openclaw/workspace/projects/ltm-claw"
    }]
  },
  "ltm-claw": {
    "retrievalTimeoutSeconds": 60
  }
}
```

Restart OpenClaw. The plugin creates `~/.openclaw/ltm-claw/.ltm-claw-root` on first load.

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

- v1: no DB, just `~/.openclaw/ltm-claw/.ltm-claw-root` marker
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
