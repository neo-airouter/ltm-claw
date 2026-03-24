<div align="center">

# ltm-claw

<img src="sidecar.png" alt="ltm-claw" width="400">

<br/>

Long-term memory (LTM) access for OpenClaw without bloating session context using subagents (sidecar).

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

## Usage

`ltm_search` is triggered automatically when you ask about past conversations, prior work, or anything that would require context from earlier sessions. Examples:

**"Hey, didn't we talk about Rickrolling someone last week?"**

```
## a3f9c812 (2026-03-18)

Never gonna give you up — the session discussed deploying a Never Gonna Give You Up
autoresponder as a mitigation for a specific trigger phrase. The decision was to flag
it as low-priority幽默 rather than implement it as a production rule.
```

**"What did we decide on the Ultimate Answer again?"**

```
## 7b2d1e45 (2026-03-21)

42. The session confirmed 42 as the agreed-upon answer, contingent on the universe
not changing its numbering system. Further research into alternative numbering systems
was deemed out of scope but noted for v3 graph traversal.
```

---

## Project docs

| File | Purpose |
|------|---------|
| [README.md](README.md) | This file — overview, install, tools |
| [ROADMAP.md](ROADMAP.md) | Version milestones |

---

## 💜 Sponsors

[AI Router Switzerland](https://airouter.ch) — unlimited API access with flatrate pricing.
Main sponsor of the infrastructure and research behind ltm-claw.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
