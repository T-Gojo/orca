---
name: hermes-suite
description: 'Use Orca-Hermes PTC, /review, Skills Hub, and channel push'
---

# Orca-Hermes Intelligence Suite (`orca-hermes` MCP)

All 6 CLIs and Orca Bots have the `orca-hermes` MCP server installed (`~/.config/orca-ecosystem/runtime/orca-hermes-mcp.mjs`).

## Tools & When to Use Them

1. **`orca_ptc` (Programmatic Tool Calling / `execute_code`):**
   - Collapse 5–20 sequential tool calls into **one Python 3 script** that imports from `orca_tools`:
     `from orca_tools import rikugan_search, rikugan_aggregate, rikugan_context, read_file, search_files, web_extract, shell, json_parse`
   - Only compact `stdout` (`<=50 KB`, 40%/60% head/tail with automatic spill file recovery) enters your context window.
2. **`orca_review` (Independent Senior Reviewer):**
   - Spawns an independent background review turn in Orca to inspect git diffs, PRs, security boundaries, and test coverage against active skills.
3. **`orca_skills_hub` (Autonomous Skill Distillation):**
   - Save or patch reusable workflows across `~/.agents/skills/` and all 6 CLIs (`action: "save"`).
   - **Strict routing rule:** `description` MUST be `1–60` characters so CLI skill routers never truncate it. Every write creates an Undo backup (`orca ecosystem undo-skill <name>`).
4. **`orca_session_recall`:**
   - Search past sessions across both Rikugan (`recall_sessions`) and local CLI session vaults.
5. **`ecosystem_notify`:**
   - Send proactive completion alerts or summaries to the owner's paired **Telegram** or **WhatsApp** via the local OpenClaw bridge (`127.0.0.1:6770`).
