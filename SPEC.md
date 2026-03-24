# ltm-claw — SPEC.md

**Plugin:** `@airouter.ch/ltm-claw`
**Philosophy:** Agent-managed, typed memory with relationships. Explicit-only storage. Local-only.

**Versioning:** Major version per major phase (v1 → v2 → v3 → v4). See `ROADMAP.md`.

| Version | Scope |
|---------|-------|
| v1 | Session history grep search (no schema, no embeddings) |
| v2 | Typed memories + hybrid search + relationships |
| v3 | Graph traversal (`ltm_explore`) + reflection |
| v4 | Self-evolution, memory hygiene |

**Docs:** `README.md` (quick start) · `SPEC.md` (this file, source of truth) · `ROADMAP.md` (milestones)
> **ROADMAP cross-reference rule:** every ROADMAP milestone must cite the SPEC section it implements. "v2.4 implements `ltm_connect` per SPEC.md §Tool Signatures" — not "implements relationship tools."

---

## Goals

- **v2:** Typed memories with 5 categories, hybrid BM25 + vector search, 6 relationship types
- Agent uses the tools via trigger descriptions — no passive accumulation
- Per-agent SQLite storage, completely outside OpenClaw's own directories
- **v3:** Graph traversal and reflection
- **v4:** Self-evolution, memory hygiene

## Non-Goals

- No cross-agent memory sharing (v4+)
- No cloud sync (ever)
- No contextEngine — tools ARE the context modification layer
- No bi-temporal model in v2 (deferred to v4)

---

## Storage Layout

```
~/.openclaw/ltm-claw/                  ← root (v2+), never inside ~/.openclaw/agents/ or ~/.openclaw/workspace/
└── <agentId>-memory-graph.db           # SQLite DB per agent (v2+, flat structure)

```

- **No pollution of OpenClaw's own directories**
- One DB per agent, named `<agentId>-memory-graph.db` (flat structure)
- If agent "main" → `main-memory-graph.db`; agent "night" → `night-memory-graph.db`
- Root marker file allows external tools to identify the install

**Known limitation:** If an agent is renamed, the DB file doesn't auto-rename. A migration script handles this manually if needed. Agents are rarely renamed in practice.

---

## Taxonomy

### Memory Categories (v2 — 5)

| Category | Agent Trigger | Example |
|----------|---------------|---------|
| `decision` | Agent commits to a choice or direction | "I'll use X approach for this" |
| `correction` | Agent or human corrects a prior belief | "Actually, Y was wrong because..." |
| `insight` | Agent derives something new from reasoning | "The pattern across these failures suggests..." |
| `fact` | User provided a persistent fact | "Chris prefers markdown files for notes" |
| `context` | Session-specific info worth preserving | Project state, active goals |

**Relationship types (v2 — 6):**

| Type | When to use |
|------|-------------|
| `supports` | New memory provides evidence for an existing one |
| `contradicts` | New memory undermines an existing one |
| `supersedes` | New memory replaces an older one (correction chain) |
| `depends_on` | Memory requires another to be fully understood |
| `related_to` | Loose thematic connection |
| `evolved_from` | Memory is a refinement of an existing one |

---

## Schema

> Schema applies to v2+. v1 has no database.

### SQLite (v2+) — `~/.openclaw/ltm-claw/<agentId>-memory-graph.db`

```sql
-- Enable WAL up front (before any tables)
PRAGMA journal_mode = WAL;

CREATE TABLE memories (
  id                TEXT PRIMARY KEY,  -- UUID
  category          TEXT NOT NULL,      -- decision|correction|insight|fact|context
  content           TEXT NOT NULL,      -- The memory text
  embedding         BLOB,               -- Float32 vector (1536-dim via Qwen3-Embedding); NULL = not yet embedded
  embedding_status  TEXT DEFAULT 'pending',  -- 'pending' | 'ready' | 'failed'
  agent_id          TEXT NOT NULL,
  created_at        TEXT NOT NULL,      -- ISO8601
  updated_at        TEXT NOT NULL,      -- ISO8601
  metadata          TEXT DEFAULT '{}'   -- JSON for future extensibility
);

CREATE TABLE relationships (
  id          TEXT PRIMARY KEY,   -- UUID
  source_id   TEXT NOT NULL,      -- Memory UUID
  target_id   TEXT NOT NULL,      -- Memory UUID
  rel_type    TEXT NOT NULL,      -- supports|contradicts|supersedes|depends_on|related_to|evolved_from
  created_at  TEXT NOT NULL,      -- ISO8601
  FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE,
  UNIQUE(source_id, target_id, rel_type)
);

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at  TEXT NOT NULL       -- ISO8601
);

CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='rowid'
);

-- FTS5 content table — keep FTS in sync via triggers
-- The memories table IS the content table (not external).
-- Deletions sync to FTS via 'delete' shadow table token.
-- Note: if switching to true external-content FTS, use DELETE FROM approach instead.
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
```

**Indexes:**
```sql
CREATE INDEX idx_memories_agent_id ON memories(agent_id);
CREATE INDEX idx_memories_category ON memories(category);
CREATE INDEX idx_memories_embedding_status ON memories(embedding_status);
CREATE INDEX idx_memories_created_at ON memories(created_at);
CREATE INDEX idx_relationships_source ON relationships(source_id);
CREATE INDEX idx_relationships_target ON relationships(target_id);
CREATE INDEX idx_relationships_type ON relationships(rel_type);
```

---

## Tool Signatures

### `ltm_store`

```
category: "decision" | "correction" | "insight" | "fact" | "context"  (required)
content: string  (required)
supersedes_ids?: string[]  (optional, memory UUIDs this corrects/replaces)
metadata?: object  (optional, default {})
```

**Execution model:** Synchronous. Embedding call to `llama-server :8001` is inline (~200-500ms local). If embedding service is unavailable, memory is stored with `embedding_status: 'pending'` and retried on next search.

**Tool description trigger text:**
> Use `ltm_store` when: you make a decision or commit to a choice ("I'll use X approach"), the human corrects you or you self-correct ("actually, Y was wrong"), you derive a new insight from reasoning, the user provides a persistent fact worth remembering, or session context is worth preserving for later sessions.
>
> If storing a correction, pass the UUID(s) of the memory being corrected in `supersedes_ids` — this atomically creates supersedes relationship(s) and builds the correction chain.
>
> Returns the full memory object including ID for immediate chaining with `ltm_connect`.

**Returns:**
```json
{
  "id": "uuid",
  "category": "decision",
  "content": "...",
  "created_at": "ISO8601",
  "embedding_status": "ready | pending",
  "relationships": [{"target_id": "uuid", "type": "supersedes"}],
  "status": "stored"
}
```

### `ltm_search`

```
query: string  (required)
categories?: string[]  (optional, filter by category)
limit?: number  (optional, default 10, max 50)
agentId?: string  (optional, default: current agent)
```

**Execution model:** Always via subagent. The subagent handles: retry pending embeds (capped 50, FIFO) → embed query → BM25 + vector in parallel → Reciprocal Rank Fusion → return ranked results. Main agent context stays clean.

**Tool description trigger text:**
> Use `ltm_search` when: the user asks about past decisions, beliefs, insights, or facts you've stored; when you need to recall what you decided or learned previously; when context from earlier sessions is relevant.
>
> Hybrid search: BM25 keyword matching + vector similarity. Graph expansion comes in v3.

**Returns:**
```json
{
  "results": [
    {
      "id": "uuid",
      "category": "decision",
      "content": "...",
      "created_at": "ISO8601",
      "score": 0.85,
      "relationships": [{"target_id": "uuid", "type": "supersedes"}]
    }
  ],
  "total": 5,
  "status": "ok | partial_results"
}
```

**Partial results:** If vector search fails, returns BM25-only results with `status: "partial_results"` and a warning.

### `ltm_connect`

```
source_id: string  (required, memory UUID)
target_id: string  (required, memory UUID)
relationship_type: "supports" | "contradicts" | "supersedes" | "depends_on" | "related_to" | "evolved_from"  (required)
```

**Execution model:** Synchronous SQLite insert. No subagent needed (<10ms).

**Tool description trigger text:**
> Use `ltm_connect` to create a typed relationship between two existing memories. For corrections, use `ltm_store` with `supersedes_ids` instead — it atomically stores + creates the supersedes edge.

### `ltm_supersedes`

```
new_id: string  (required, the new memory UUID)
old_ids: string[]  (required, memory UUIDs being replaced)
```

**Execution model:** Synchronous. Creates one `supersedes` edge per old_id.

**Tool description trigger text:**
> Use `ltm_supersedes` when: you want to explicitly link a new memory as replacing old ones outside of the `ltm_store` call. Most corrections should use `ltm_store(supersedes_ids=[...])` for atomicity.

---

## Error Handling

| Failure mode | Behavior |
|-------------|----------|
| DB write fails | Retry once (50ms backoff), then again (100ms). If still fails: `{ status: "error", error: "failed to store memory after retries" }` |
| Embedding call fails (store) | Store with `embedding_status: 'pending'`. Return success with `embedding_status: 'pending'` warning. |
| Embedding times out (search) | Subagent retries once. If still times out: return BM25-only results with `status: "partial_results"` + warning. Never fail completely. |

**Pending embed queue:** `ltm_search` (subagent) batch-retries up to 50 oldest pending memories (FIFO by `created_at`) before running the main query. If more than 50 are pending, remaining ones get resolved over subsequent searches. No separate tool needed.

---

## Architecture

```
ltm-claw/                      ← ~/.openclaw/ltm-claw/
│
├── index.ts                   # Plugin entry (v1)
├── tool.ts                    # ltm_search tool (v1: grep subagent)
├── retrieval.md               # Subagent prompt (v1)
├── startup-banner-log.ts      # Startup banner
├── openclaw.plugin.json       # Plugin config schema
│
├── store/                     # ← v2+ (not yet implemented)
│   ├── memory-store.ts        # SQLite CRUD + FTS sync
│   └── migrations.ts          # Idempotent schema migrations
├── retrieval/                 # ← v2+ (not yet implemented)
│   ├── bm25.ts                # FTS5 query builder
│   ├── vector.ts              # Embedding via llama-server :8001
│   └── hybrid.ts              # Reciprocal Rank Fusion
├── taxonomy.ts                # ← v2 (not yet implemented)
└── tools/                     # ← v2+ (not yet implemented)
    ├── ltm-store.ts
    ├── ltm-search.ts           # hybrid (replaces tool.ts v1)
    ├── ltm-connect.ts
    └── ltm-supersedes.ts
```

**Config:**
```json
{
  "retrievalTimeoutSeconds": 60,
  "embeddingModel": "then/qwen3-embedding-0.6b",
  "embeddingUrl": "http://127.0.0.1:8001"
}
```

---

## Execution Model Summary

| Tool | Sync/Spawn | Reason |
|------|-----------|--------|
| `ltm_store` | Sync | Inline embedding (~200-500ms), acceptable; agent waits anyway |
| `ltm_search` | Subagent | Hybrid = parallel embed + BM25; keeps main context clean |
| `ltm_connect` | Sync | SQLite insert only, <10ms |
| `ltm_supersedes` | Sync | SQLite insert only, <10ms |

---

## Implementation Notes

### Storage
- **WAL mode:** `PRAGMA journal_mode = WAL` set on every new DB initialization. WAL allows concurrent reads during writes and is faster for read-heavy workloads.
- **WAL artifacts:** SQLite auto-creates `*.db-wal` and `*.db-shm` alongside the main DB. Backup scripts must include `*.db*` patterns, not just `*.db`.
- **Absolute path only:** `~/.openclaw/ltm-claw/` is resolved to an absolute path before being passed to subagents via `extraSystemPrompt`. No `~` in the prompt string.

### Migrations
- **`autoMigrate()` on `open()`:** Every call to `open()` checks the migrations table and applies any pending migrations. This handles the case where a new plugin version adds a migration while a subagent has an older DB open.
- **Idempotent migrations:** Each migration is numbered and guarded with `IF NOT EXISTS` / version checks. Re-running is safe.
- **Schema migrations table:** `{ version: INTEGER, description: TEXT, applied_at: ISO8601 }`. Each migration records its description for human audit.

### Embedding
- **Sync embed in `ltm_store`:** HTTP POST to `llama-server :8001` inline. ~200-500ms latency, acceptable.
- **Store-then-embed:** If HTTP call fails, memory is stored with `embedding_status: 'pending'`. FTS entry is created immediately so BM25 search works even without vector.
- **Batch retry cap:** Max 50 pending embeds retried per `ltm_search` call. Ordered `created_at ASC` (oldest first). Bounds latency to ~15 seconds worst case (50 × 300ms).

### Search Subagent
- **Config via `extraSystemPrompt`:** Acceptable limitation for v2. No cleaner pattern available without gateway changes. Absolute DB path and embedding URL embedded as string literals.
- **Subagent task flow:** (1) Retry pending embeds (capped 50) → (2) Hybrid search → (3) Return results. Steps (1) and (2) run in the same subagent call.
- **No session re-use:** Each `ltm_search` spawns a fresh subagent session. No session affinity / pooling needed for v2.

### Error Handling Details
- **DB write retry:** Two attempts total (original + one retry). 50ms then 100ms backoff. No exponential backoff beyond that — if the DB is inaccessible, it's a systemic problem.
- **Subagent timeout:** Subagent run has a `timeoutSeconds` from config (`retrievalTimeoutSeconds`, default 60s). If exceeded, the subagent run is aborted. Partial results may already have been returned to the requester.
- **Partial results structure:** Always returns `{ results: [...], total: N, status: "partial_results", warning: "vector search unavailable" }`. `results` contains BM25-ranked memories. Never returns empty `results` array due to failures.

---

## Implementation Order

1. **taxonomy.ts** — constants, types, validation
2. **migrations.ts** — migration framework (version table, idempotent apply)
3. **memory-store.ts** — SQLite setup, WAL, auto-migrate on open(), CRUD, FTS triggers
4. **vector.ts** — embedding generation via llama-server :8001
5. **hybrid.ts** — BM25 + vector RRF fusion
6. **ltm-store.ts** — `ltm_store` tool with supersedes_ids atomicity
7. **ltm-search.ts** — `ltm_search` tool (subagent-powered, v2 hybrid — replaces tool.ts v1)
8. **ltm-connect.ts + ltm-supersedes.ts** — relationship tools
9. **plugin.ts** — OpenClaw plugin wiring + marker file creation
10. **Test end-to-end** — store decisions, corrections, search, connect

---

## Open Questions (Deferred)

- [ ] `ltm_explore` (graph traversal) — v3
- [ ] `ltm_reflect` + `ltm_should_reflect` — v4
- [ ] Weekly hygiene pass (scheduled reflection task, not cron)
- [ ] Session-start auto-recall integration
- [ ] Cross-agent memory sharing (explicit design decision)
- [ ] Agent rename migration (rename DB file when agent is renamed)

---

## Temporal Model

### Simplified (v2)

We store:
- `created_at` — when the memory was created in the system
- `supersedes` chains — when a belief was updated

We do **not** model:
- The distinction between "when was this true in the world" vs "when did the system learn it" (bi-temporal)
- For example: "I decided X on Tuesday" and "X was true as of Monday but I only learned it Tuesday" are stored identically

**v3** should consider bi-temporal modeling if temporal reasoning becomes a priority.

---

## v3 Reference

Production-derived constants from high-scale systems (RedPlanet, 10M+ nodes):

| Parameter | Value | Source |
|-----------|-------|--------|
| BFS explore threshold | 0.3 | RedPlanet — low threshold prevents traversal explosion |
| BFS keep threshold | 0.65 | RedPlanet — only high-confidence results retained |
| Embedding retry batch cap | 50 | SPEC §Error Handling |
| Hybrid search weight: graph | 5.0× | RedPlanet — episode graph most accurate for personal queries |
| Hybrid search weight: BFS | 3.0× | RedPlanet |
| Hybrid search weight: vector | 1.5× | RedPlanet |
| Hybrid search weight: BM25 | 0.2× | RedPlanet — keyword only for exact matches |

*Note: these weights are for v3 `ltm_explore` implementation. v2 uses simple RRF fusion.*

---

## References

Research inputs used in this spec:

1. **Evo-Memory (DeepMind, 2025)** — agents benefit from refine-and-prune, not just accumulate. Correction chains and self-evolution are the primary mechanism.
2. **Penfield** — typed memories (11 categories), knowledge graph (24 relationship types), agent-managed self-evolution, hybrid search. Cloud-hosted. *(original inspiration, not a public paper)*
3. **RedPlanet Memory System (2025)** — 10M+ node production knowledge graph. Key insights: reified triples, async graph resolution, sparse LLM output, BFS depth pruning (0.3/0.65 thresholds), hierarchical search weighting.
4. **Mem0** — universal memory layer for agents, hybrid storage + graph. Inspiration for typed categories.
5. **Zep** — bi-temporal knowledge graph (when something happened vs when the system learned it). Inspiration for temporal modeling deferral.
6. **Supermemory** — unified data model for personal memory, privacy-first.
7. **LoCoMo-Plus benchmark** — graph-based memory scored 93.3% vs 45.7% for Gemini 2.5 Pro 1M context vs 29.8% for standard RAG.

---

## Appendix: Failure Modes

> Stress-tested by Night. 22 failure modes across storage, schema, embedding pipeline, search, and subagent layers. "🔴" = silent wrong results (agent won't notice), "🟡" = degradation, "🔴" = hard failure.

---

### Fixed in v1 (2026-03-23)

**A. `retrieval.md` Step 1→2 pipe broken (critical, always fails)** — Step 1 used `find | while read` which consumes stdin, then Step 2's `$(cat /dev/stdin)` received nothing. `grep` always got empty input.
*Fix: capture file list in a shell variable (`files=$(find ...)`), pass directly to grep. No stdin, no temp file.*

**B. Subagent announce step requires channel context** — `deliver: true` triggers an announce step that posts the result back to the requester's channel. In the dev gateway (no channels configured), this fails with "Channel is required (no configured channels detected)". In production gateways with channels, this works because the parent session has a channel.
*Fix: use `deliver: false`, poll `waitForRun` + `getSessionMessages` directly. No announce step needed since we retrieve the subagent's session output manually.*

### 🔴 Silent Wrong Results (agent cannot detect)

**1. Category/rel_type not validated at insert** — `CHECK` constraints absent from schema. A buggy or malicious agent call with `category: "foo"` stores garbage silently. Validation must live in `memory-store.ts` CRUD layer (not just tool descriptions). If CRUD validation is missing, invalid categories persist forever.
*Fix: add `category TEXT NOT NULL CHECK(category IN ('decision','correction','insight','fact','context'))` and equivalent for `rel_type`.*

**2. `embedding_status: 'ready'` set without embedding existing** — code could set `ready` without confirming the BLOB is stored. Search would return the memory with vector similarity, but the embedding is NULL → bad scores.
*Fix: `ready` status set only after embedding BLOB is confirmed written.*

**3. Partial results surfaced as `status: "ok"`** — BM25-only fallback looks identical to a full hybrid result. Agent cannot distinguish "search worked fully" from "vector was unavailable, BM25 only".
*Fix: `status: "partial_results"` when vector unavailable. Agent checks status before trusting scores.*

**4. Zero genuine matches surfaced as error** — `status: "no_matches"` vs `status: "error"` not distinguished. The tool returns `{ results: [], status: "ok" }` for zero real matches and `{ results: [], status: "error" }` for failures identically.
*Fix: explicit `status: "no_matches"` when BM25 returns 0 results legitimately.*

---

### 🟡 Degraded Behavior

**5. FTS5 trigger uses wrong delete syntax** — schema uses `INSERT INTO memories_fts(...) VALUES('delete', ...)` but correct FTS5 external-content delete is `INSERT INTO memories_fts(rowid, content) VALUES(old.rowid, old.content)` — no `'delete'` magic token. The current trigger syntax is invalid SQLite and won't compile.
*Fix: use `INSERT INTO memories_fts(rowid, content) VALUES('delete', old.rowid, old.content)` — or better, populate a shadow content table and use `WHERE rowid=?` to update.*

**6. FTS orphan entries after failed migrations** — if a migration runs inside a transaction and fails mid-way, FTS entries can exist without corresponding memories, or memories without FTS entries. No integrity check exists.
*Fix: post-migration validation query checks rowid counts match between `memories` and `memories_fts`.*

**7. Unbounded `content` length** — no length limit on memory content. A very large memory (>1MB) OOMs the embed generation call or creates a bloated FTS entry.
*Fix: enforce `content.length <= 10000` chars in `ltm_store` validation.*

**8. Concurrent `ltm_store` calls race on embedding endpoint** — multiple simultaneous stores fire parallel HTTP POSTs to `:8001`. No connection pool, no serialization. Burst of concurrent stores causes cascading `pending` writes even when sequential calls would succeed.
*Fix: serialize embedding calls via a queue or mutex in `vector.ts`, or accept the limitation and document it.*

**9. `pending` → `ready` update has no retry** — if the HTTP embed call succeeds but the DB update to `ready` fails (crash mid-write), the embed exists in memory but the record stays `pending`. It's effectively lost — retry won't find it (HTTP call won't fire again), BM25 only.
*Fix: wrap the embed-generation + DB-update in a single transaction, or retry the update separately.*

**10. WAL file grows indefinitely (no checkpointing)** — WAL mode writes uncheckpointed frames indefinitely. Disk can fill up on a write-heavy agent.
*Fix: periodic `PRAGMA wal_checkpoint(TRUNCATE)` via a cron job or explicit call after N writes.*

**11. `maxAge` / time filtering not in search spec** — every search scans all memories. On a system with thousands of memories, this is slow. `maxAge` parameter exists in ltm-search v1 but is absent from ltm-claw v2 spec.
*Fix: add `maxAgeDays` parameter to `ltm_search` — already validated in v1, carry forward.*

**12. No result freshness/ranking tiebreak** — when BM25 + vector scores are equal, sort order is undefined. Ambiguous for agent consuming results.
*Fix: always sort by `score DESC, created_at DESC` as tiebreaker.*

---

### 🔴 Hard Failures

**13. Agent ID unsanitized in filesystem path** — `agentId` directly interpolated into `<agentId>-memory-graph.db`. `agentId` containing `/`, `\`, `..`, `:` creates broken paths or path traversal. OpenClaw agent IDs are user-controlled strings.
*Fix: sanitize to `[a-zA-Z0-9_-]` before constructing path. `agentId.replace(/[^a-zA-Z0-9_-]/g, '_')`.*

**14. Embedding call has no HTTP timeout** — if `llama-server :8001` hangs (model reload, OOM), `ltm_store` blocks indefinitely on the HTTP POST.
*Fix: set `fetch` timeout to 10s, treat as `pending` on timeout.*

**15. Subagent spawn failure → empty results, no error surfaced** — if `sessions_spawn` throws, current fallback returns empty results with no error indicator.
*Fix: return `{ status: "error", error: "search unavailable" }` on spawn failure. Never return `results: []` with `status: "ok"`.*

**16. DB file opened externally (by another process) causes `SQLITE_BUSY`** — default `busy_timeout` is 0. Under contention, writes fail immediately instead of waiting.
*Fix: set `PRAGMA busy_timeout = 5000` on every connection.*

**17. Disk full on `ltm_store`** — `SQLITE_FULL` error propagated as cryptic exception, not clear user-facing error.
*Fix: catch `SQLITE_FULL`, return `{ status: "error", error: "disk full" }`.*

**18. Subagent crash mid-pending-embed-batch** — if subagent is killed during the pending-embed retry loop (50 memories), partial embeddings are updated to `ready` while others remain `pending`. No transaction wraps the batch.
*Fix: wrap pending-retry batch in explicit `BEGIN / COMMIT`. On crash, either all retry or none — not partial.*

---

### ⚠️ Limitations (acceptable for v2, document and move on)

**19. Embedding URL hardcoded in `extraSystemPrompt`** — if embedding service port/host changes between plugin reloads, subagents use stale config until gateway restart. Config refresh mechanism not available.
*Document: plugin reload required if embedding URL changes.*

**20. No subagent session cleanup** — `ltm_search` spawns a new subagent session per call. Sessions accumulate until OpenClaw's default 60-minute archive TTL. On a write-heavy agent, many sessions pile up.
*Document: known. Session GC is gateway responsibility, not ltm-claw's.*

**21. UUID v4 collision (theoretical)** — probability ~10⁻³⁷ per call. Practically zero. Not worth mitigating.
*Accept.*

**22. WAL recovery on crash** — if process is killed mid-write (SIGKILL, OOM), WAL replay runs on restart. Small delay (~1-5s) but no data loss.
*Accept: WAL is safe. Just slow startup on large WAL.*

---

### Summary: Required SPEC Changes

| # | Severity | Change |
|---|----------|--------|
| 1,2,3,4 | 🔴 Silent | Add CHECK constraints + validation in CRUD layer |
| 5 | 🟡 Schema | Fix FTS5 trigger syntax to valid SQLite |
| 7 | 🟡 Impl | Add `content.length` cap in `ltm_store` |
| 8 | 🟡 Impl | Serialize embedding calls or document burst limitation |
| 9 | 🟡 Impl | Retry `pending→ready` DB update separately |
| 10 | 🟡 Impl | Add periodic `wal_checkpoint(TRUNCATE)` |
| 11 | 🟡 Spec | Add `maxAgeDays` to `ltm_search` |
| 12 | 🟡 Spec | Define sort tiebreaker (`score DESC, created_at DESC`) |
| 13 | 🔴 Security | Sanitize agentId for filesystem use |
| 14 | 🔴 Hard | Add HTTP timeout to embedding fetch |
| 15 | 🔴 Hard | Return error on subagent spawn failure |
| 16 | 🔴 Hard | Set `busy_timeout = 5000` on DB connection |
| 17 | 🔴 Hard | Catch and surface `SQLITE_FULL` clearly |
| 18 | 🔴 Hard | Wrap pending-embed batch in explicit transaction |
| 19–22 | ⚠️ Accept | Document as v2 limitations |
