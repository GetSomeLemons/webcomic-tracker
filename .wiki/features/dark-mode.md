---
id: features-dark-mode
title: Dark Mode
category: features
tags: [dark-mode, css, content-script]
related: [architecture-extension-overview]
context_keys: [content.js, TOGGLE_DARK, QUERY_DARK, wct-dark]
audience: [developer, ai]
level: beginner
status: current
since: "2026-07"
---

# Dark Mode

CSS-filter-based dark mode injected into pages via `content.js`. Toggled from the popup or set globally in settings.

## How It Works

A `<style id="wct-dark-style">` element is injected and the `wct-dark` class is added to `<html>`:

```css
html.wct-dark { filter: invert(1) hue-rotate(180deg); }
html.wct-dark img,
html.wct-dark video,
html.wct-dark canvas,
html.wct-dark picture { filter: invert(1) hue-rotate(180deg); }
```

The double inversion on media elements restores their original appearance. `hue-rotate(180deg)` corrects the color shift that a plain `invert(1)` introduces.

## State

- **Global**: `settings.darkModeGlobal` in `chrome.storage.local`, checked on every page load.
- **Per-tab**: ephemeral, resets on page reload or navigation.

## Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `TOGGLE_DARK` | popup → content (tab) | Toggle dark mode on/off, responds with `{ darkNow }` |
| `QUERY_DARK` | popup → content (tab) | Query current state, responds with `{ darkNow }` |

## Gotchas

- Works on ~95% of sites. Background images set via inline `style` attributes may remain inverted.
- SPA navigation without a full page load does not re-run the content script; dark state persists in the DOM.
- Content scripts do not run on `chrome://` pages. The popup dark toggle throws there (caught with try/catch).
- ponytail: no MutationObserver for dynamic images; add if needed.
