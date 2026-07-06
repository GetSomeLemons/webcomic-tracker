---
id: guides-getting-started
title: Getting Started
category: guides
tags: [setup, extension, chrome, edge]
related: [architecture-extension-overview]
context_keys: [manifest.json, src/]
audience: [developer, ai]
level: beginner
status: current
since: "2026-07"
---

# Getting Started

## Requirements

- Chrome or Edge with Developer mode enabled
- Development runs inside the `viking-claude-code` container (VS Code dev container)

## Loading the Extension

No build step. The extension loads directly from `src/`.

1. Open `edge://extensions` (or `chrome://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select `/workspace/src/`
4. After any change, click the reload icon on the extension card

## GitHub Gist Sync (optional)

1. Create a GitHub Personal Access Token with **Gists (read+write)** scope
2. Open the extension popup → **Settings**
3. Paste the PAT → **Connect** → the Gist URL appears on success

## Dev Environment

The VS Code dev container starts automatically when you open the folder and select "Reopen in Container".

Without the dev container (PowerShell):

```powershell
wslc run -it --rm -v "$($PWD.Path):/workspace" ghcr.io/getsomelemons/viking-claude-code:latest claude
```
