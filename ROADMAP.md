# ltm-claw — ROADMAP

> Each milestone is independently testable.
> Versions are major versions: v1 → v2 → v3 → v4.

---

## v1.0 — Session History Search (✅ DONE)

**Status:** Code exists in `tool.ts` — subagent grep and polling.

**What it does:** `ltm_search` — grep session JSONL files via subagent. No typed memories, no SQLite, no embeddings.

**v1.0 — Polish & OpenClaw Plugin Load**
- [x] Rename plugin id from `ltm-search` to `ltm-claw` in `index.ts` and `openclaw.plugin.json`
- [x] Update `tool.ts` label from "LTM Search" to "LTM Claw"
- [x] Update `openclaw.plugin.json` description and plugin id for v1
- [x] Update `package.json` name and GitHub URLs
- [x] Update `startup-banner-log.ts` log key
- [x] Verify plugin loads without errors in OpenClaw (manual step)

**v1.1 — README + Docs**
- [x] `README.md` v1 install and version docs
- [x] Mark v1 complete in `CHANGELOG.md`
- [x] Update `ROADMAP.md` version structure

**Test:** Plugin loads. `ltm_search` callable. Session grep returns results.

---

## v2.0 — Typed Memories + Hybrid Search

**Goal:** Agent can store typed memories, search them, and connect them. Core loop works end-to-end.

**What it adds over v1:** SQLite store, typed categories, embedding pipeline, hybrid search, relationship edges.

### v2.1 — Foundation
- [ ] `taxonomy.ts` — constants, types, validation
- [ ] `migrations.ts` — version table, idempotent apply
- [ ] `memory-store.ts` — SQLite setup, WAL, auto-migrate, CRUD, FTS triggers
- [ ] Storage at `~/.openclaw/ltm-claw/<agentId>-memory-graph.db`
- [ ] Agent ID sanitization (`replace(/[^a-zA-Z0-9_-]/g, '_')`)
- [ ] `busy_timeout = 5000` on all connections
- [ ] `CHECK` constraints on `category` and `rel_type`
- [ ] `content.length` cap (10,000 chars)
- [ ] HTTP timeout on embedding fetch (10s)

**Test:** Store a `decision` memory, verify it persists and appears in search.

### v2.2 — Store + Embed
- [ ] `vector.ts` — embedding via llama-server :8001
- [ ] `ltm_store.ts` — store tool with `supersedes_ids` atomicity
- [ ] Embedding failures → `embedding_status: 'pending'`
- [ ] Retry `pending→ready` DB update with its own retry loop

**Test:** Store 5 memories of different categories. Search returns all 5. Embedding service restart → memories still stored as `pending`, become `ready` after service restores.

### v2.3 — Search
- [ ] `hybrid.ts` — BM25 + vector RRF fusion
- [ ] `ltm_search.ts` (v2) — subagent-powered hybrid search
- [ ] Subagent config via `extraSystemPrompt` (absolute paths)
- [ ] `maxAgeDays` parameter
- [ ] `score DESC, created_at DESC` sort tiebreaker
- [ ] Partial results → `status: "partial_results"`
- [ ] Zero matches → `status: "no_matches"`
- [ ] Subagent spawn failure → explicit error

**Test:** Store memories with specific content. Search for keywords. Kill embedding service → verify partial results mode.

### v2.4 — Relationships
- [ ] `ltm_connect.ts` — relationship creation
- [ ] `ltm_supersedes.ts` — explicit supersedes edges
- [ ] `ltm_store` with `supersedes_ids` — atomic store + edge

**Test:** Store a correction with `supersedes_ids`. Verify `relationships` array returned.

### v2.5 — Polish + Integration
- [ ] `plugin.ts` — OpenClaw plugin wiring, marker file
- [ ] WAL checkpoint strategy (`wal_checkpoint(TRUNCATE)`)
- [ ] Pending embed batch wrapped in explicit `BEGIN / COMMIT`
- [ ] End-to-end integration test

**Test:** Full flow — store decisions, corrections, search, connect. Plugin loads without errors.

---

## v3.0 — Graph: Explore + Reflect

### v3.1 — Graph Traversal
- [ ] `ltm_explore.ts` — BFS traversal from a memory
- [ ] BFS thresholds: explore at 0.3, keep at 0.65
- [ ] Relationship expansion

### v3.2 — Reflection
- [ ] `ltm_reflect.ts` — "what do I know about X, how has my understanding evolved?"
- [ ] `ltm_should_reflect.ts` — cheap introspection hook

### v3.3 — Temporal Model (Simplified)
- [ ] `evolved_from` relationship use cases
- [ ] Explicit `updated_at` vs `created_at` semantics documented

---

## v4.0 — Self-Evolution

### v4.1 — Pruning
- [ ] Memory hygiene reflection task (weekly)
- [ ] Contradiction detection via `contradicts` relationships
- [ ] Superseded memory archival

### v4.2 — Session Integration
- [ ] Session-start auto-recall of relevant memories
- [ ] Cross-agent memory sharing (explicit design decision)

---

## Deferred / Unscheduled

Not yet assigned to a version.

- [ ] Bi-temporal model (when true vs when learned — v4+)
- [ ] Agent rename migration (DB file rename)
- [ ] Cross-agent shared memory
- [ ] Cloud sync
