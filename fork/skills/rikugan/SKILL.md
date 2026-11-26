---
name: rikugan
description: 'Query and update Rikugan personal knowledge graph on :5680'
---

# Rikugan — Personal Knowledge & Continuity Hub

Rikugan runs locally on the Mac internal SSD (`http://127.0.0.1:5680/mcp` & `/v1/tools/*`) and indexes the owner's personal and app data (SuperMailAnalyzer 24 mailboxes, Artha finance, SuperGDrive, Dusk stats, Level Up habits, documents, code projects, and cross-agent session records).

## Core Rules

1. **Read `<memory-context>` first:** Non-trivial turns inside Orca include a `<memory-context>` block from `get_context` with deduplicated preferences, facts, people, and prior sessions. Cite `[node_id]` when referencing records.
2. **Use targeted MCP tools (`mcp__rikugan__*` or `rikugan` server):**
   - `search` / `get_node` / `get_neighbors` / `get_day` — hybrid vector + FTS5 lookup
   - `aggregate` — exact SQL counts/sums (`where`, `groupBy`, `sumProp`) over finance/activity records
   - `recall_sessions` — recall prior work across Claude, Codex, Kiro, Antigravity, Hermes, and Mobile
   - `remember` — save lasting facts, preferences, or goals (`slot` for single-valued facts; never store transient errors or secrets)
   - `correct` — fix an outdated record instead of duplicating it
   - `record_session` — record `title`, `summary`, `decisions`, and `openThreads` at the end of substantial multi-step work
3. **Zero secret reconstruction:** Never guess or reconstruct masked phone numbers, card digits, or tokens. If a write requires a missing grant, call `request_permission` and inform the owner.
