# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# edge-extension

A Manifest V3 browser extension for Chrome and Edge developed inside the `viking-claude-code` container.

## Loading the extension

No build step. The extension loads directly from `src/`:
1. Open `edge://extensions` (or `chrome://extensions`).
2. Enable "Developer mode".
3. "Load unpacked" → select the `src/` folder.
4. After any change, hit the reload icon on the extension card.

## Architecture

```
src/manifest.json   — entry point; declares permissions, popup, and service worker
src/background.js   — ephemeral service worker (MV3); no persistent in-memory state
src/popup.html      — browser action popup; inline JS or a <script src="popup.js">
```

Communication flow: **popup ↔ background ↔ content scripts** via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. Content scripts are injected into pages (declared in manifest or via `scripting.executeScript`).

## Conventions

- All code and comments in English.
- Manifest V3 only — no remotely hosted code.
- Service worker is **ephemeral** (can be terminated at any time). Persist state via `chrome.storage.local` or `.session`, never in module-level variables.
- Request minimum permissions; prefer `activeTab` over broad host permissions.

## Internal Documentation

This project uses `.wiki/` for internal documentation. See `.wiki/_index.md` for the directory map. Always:
1. Read relevant articles before making changes
2. Update articles when you modify code

## Skills

- **`mv3-extension`** — Use when editing manifest, service worker, content scripts, popup, or permissions.
- **`viking-orchestrator`** — Always active; coordinates ponytail, wiki, backlog, and conventions.
- **`ponytail`** — Minimal code by default. Check laziness ladder before writing anything new.
