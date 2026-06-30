# edge-extension

A Manifest V3 browser extension for Chrome and Edge (Edge can use Chrome
extensions). This repo runs inside the `viking-claude-code` container, so Claude
Code, tooling, and the org-wide skills are already available.

## Conventions
- All code and comments in English.
- Manifest V3 only. No remotely hosted code (MV3 forbids it).
- Keep the service worker stateless where possible; persist via `chrome.storage`.

## Layout
- `src/` — the extension source. `src/manifest.json` is the entry point.
- `.claude/skills/` — project-specific skills (see that folder's README).
- `.claude/settings.json` — project Claude Code settings.

## Building / loading the extension
This extension loads unpacked, no build step required to start:
1. Open `edge://extensions` (or `chrome://extensions`).
2. Enable "Developer mode".
3. "Load unpacked" → select the `src/` folder.
4. After changes, hit the reload icon on the extension card.

## What to build next
Ask Claude Code to flesh out the popup and the service worker. Start small:
a popup with a button that runs a content script on the active tab.
