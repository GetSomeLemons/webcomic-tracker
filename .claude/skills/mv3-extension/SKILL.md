---
name: mv3-extension
description: Manifest V3 browser extension conventions for this project. Use when creating or editing the manifest, service worker, content scripts, popup, or permissions so output follows MV3 rules and loads cleanly in Chrome and Edge.
---

# Manifest V3 extension conventions

Apply these when working on this extension.

## Hard rules (MV3)
- `"manifest_version": 3`.
- No remotely hosted code. All JS ships in the package.
- Background logic runs in a **service worker** (`background.service_worker`),
  not a persistent background page. It can be terminated at any time.

## Permissions
- Request the minimum. Prefer `activeTab` over broad host permissions.
- Declare host permissions only for the sites the extension truly needs.

## State
- The service worker is ephemeral — never hold state in module-level variables
  expecting it to survive. Persist with `chrome.storage.local` / `.session`.

## Messaging
- Popup ↔ service worker ↔ content script communicate via
  `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`.

## Edge note
- Edge runs Chrome extensions as-is. Test in `edge://extensions` with
  Developer mode + "Load unpacked".
