---
name: rikugan
description: 'On-demand Rikugan personal brain — ONLY when user asks'
---

# Rikugan — Explicit On-Demand Personal Knowledge Hub

Rikugan runs locally on the Mac internal SSD (`http://127.0.0.1:5680/mcp` & `/v1/tools/*`) and indexes the owner's personal and app data (SuperMailAnalyzer, Artha finance, SuperGDrive, Dusk stats, Level Up habits, documents, code projects, and cross-agent session records).

## Strict Opt-In Rule (Critical)

1. **NEVER involve Rikugan unprompted:** During urgent tasks, coding, debugging, refactoring, builds, reviews, or general CLI sessions in Claude Code, Codex/ChatGPT, Kiro, Antigravity, Mistral Vibe, or OpenCode, **do NOT call any `rikugan` tool (`get_context`, `search`, `remember`, `record_session`, etc.)** unless the owner **explicitly asks** for Rikugan (e.g. mentions `Rikugan`, `/rikugan`, or explicitly asks to query/save personal records in Rikugan).
2. **Do NOT auto-record completed tasks:** Completing a task in Orca or any CLI must **never** trigger `record_session` or `remember` unless the owner specifically asks to save or log that session/fact into Rikugan.
3. **When explicitly requested by the owner, use targeted MCP tools (`mcp__rikugan__*` or `rikugan` server):**
   - `get_context` / `search` / `get_node` / `get_neighbors` / `get_day` — hybrid vector + FTS5 lookup (cite `[node_id]` when referencing records)
   - `aggregate` — exact SQL counts/sums (`where`, `groupBy`, `sumProp`) over finance/activity records
   - `recall_sessions` — recall prior saved sessions when asked
   - `remember` / `correct` / `record_session` — write or update records **only** when the owner explicitly asks to store them
4. **Zero secret reconstruction:** Never guess or reconstruct masked phone numbers, card digits, or tokens. If an explicitly requested write requires a missing grant, call `request_permission` and inform the owner.
