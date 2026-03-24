<div align="center">

# ltm-claw

<img src="sidecar.png" alt="ltm-claw" width="400">

<br/>

Long-term memory (LTM) access for OpenClaw without bloating session context (using subagents).

<br/>

<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat&labelColor=555" alt="License MIT"></a>
<img src="https://img.shields.io/badge/v1-GA-yellow?style=flat&labelColor=555" alt="v1 GA">
<img src="https://img.shields.io/badge/v2-In%20Progress-blue?style=flat&labelColor=555" alt="v2 In Progress">
<img src="https://img.shields.io/badge/Zero%20Dependencies-v1Cyan?style=flat&labelColor=555" alt="Zero Dependencies v1">
<img src="https://img.shields.io/badge/Local%20Only-purple?style=flat&labelColor=555" alt="Local Only">

</div>

---

## Overview

ltm-claw gives your OpenClaw agent persistent, queryable memory across sessions. It is installed as an OpenClaw plugin and exposes tools for storing and retrieving memories.

**v1 (current):** grep-based session history search via subagent — no external dependencies.

**v2 (coming):** Typed memories + hybrid BM25/vector search using a local llama-server embedding endpoint.

**v3:** Graph traversal + reflection.

**v4:** Self-evolution + memory hygiene.

See [ROADMAP.md](ROADMAP.md) for full milestones.

---

## Installation

v1 has no external dependencies (no SQLite, no embeddings). Just the subagent grep pipeline.

**Host requirements:** `python3` and `jq` must be available in PATH.

```bash
openclaw plugins install @airouter.ch/ltm-claw
```

## Configuration

Defaults are set during installation in `~/.openclaw/openclaw.json`:

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

---

## Tools

### `ltm_search`
Search session history via grep + subagent.

---

## Project docs

| File | Purpose |
|------|---------|
| `README.md` | This file — overview, install, tools |
| `ROADMAP.md` | Version milestones |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
