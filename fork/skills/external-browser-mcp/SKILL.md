---
name: external-browser-mcp
description: >-
  Use external browser and desktop MCP servers (dusk, browser-use, background-computer-use)
  instead of Orca's internal browser. Trigger whenever a task needs to open a website, inspect
  a web app, take screenshots, interact with logged-in sessions, test localhost UI, or drive
  macOS windows.
---

# External Browser & Computer Use MCP (Orca fork)

Orca's internal browser is **disabled for agent flows** in this fork (`orca tab create`, `orca open-url`, `orca snapshot`, and `BROWSER` routing to Orca are blocked by default). Do not open Orca internal browser tabs for automation or web inspection — use the external MCP servers installed for your CLI instead.

## Which MCP server to pick

1. **`dusk` MCP** — **User's logged-in sessions & silent background tabs**
   - Use first when you need pages the user is already signed in to (Gmail, GitHub, cloud consoles, dashboards, internal tools) or want web work to run in Dusk background tabs without stealing screen focus.
   - Runs locally over HTTP against the user's Dusk browser.

2. **`browser-use` MCP** — **Local Google Chrome / Chromium automation**
   - Use for driving local Chrome or Chromium (`browser_exec`, `browser_screenshot`, form filling, localhost testing, JS-rendered scraping, visual UI checks).
   - Prefers the user's local Google Chrome and falls back to Chromium when Chrome remote debugging is unavailable.
   - If Chrome refuses remote debugging, ask the user or run `browser-use --doctor` / `browser-use mac-approve` to diagnose or approve macOS permissions.

3. **`background-computer-use` MCP** (`computer-use-mcp`) — **macOS window & desktop automation**
   - Use when a task needs native macOS app windows, OS dialogs, or non-browser desktop UI interaction.

## Rules

- **Never call** `orca tab create`, `orca open-url`, `orca https://...`, or `orca snapshot` for browser flows — they will fail with a policy error directing you back to `dusk` and `browser-use`.
- Only override with `ORCA_ALLOW_INTERNAL_BROWSER=1` if the user explicitly asks to debug Orca's own internal browser pane.
- Manual user clicks on Orca's desktop "+ Browser" button and mobile screencast continue to work normally and are unaffected by the agent block.
