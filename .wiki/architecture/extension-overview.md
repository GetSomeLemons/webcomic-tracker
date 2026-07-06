---
id: architecture-extension-overview
title: Extension Architecture Overview
category: architecture
tags: [mv3, architecture, service-worker, content-script, storage]
related: [features-dark-mode, features-gist-sync]
context_keys: [manifest.json, background.js, content.js, popup.js, options.js]
audience: [developer, ai]
level: intermediate
status: current
since: "2026-07"
---

# Extension Architecture Overview

Webcomic Tracker is a Manifest V3 browser extension for Chrome and Edge. It saves webcomics to a reading list via keyboard shortcut, tracks chapters and ratings, checks for new chapters automatically, and syncs data to a private GitHub Gist.

## File Roles

| File | Role |
|------|------|
| `manifest.json` | Permissions, commands (Alt+S), content_scripts, host_permissions |
| `background.js` | Service worker: onCommand, alarms, Gist sync, message hub |
| `content.js` | Injected into pages: AsuraScans scraper, dark mode, toast, key bindings |
| `popup.js` | Popup UI: comic list, genre filter, detail/edit panel |
| `options.js` | Settings page: GitHub PAT, sync init, update interval |

## Message Protocol

All messages follow `{ type: string, ...payload }`.

| Sender | Receiver | Type | Response |
|--------|----------|------|----------|
| background | content | `SCRAPE_COMIC` | `{ title, slug, chapter, url } \| null` |
| popup | background | `GET_ALL_COMICS` | `{ comics }` |
| popup | background | `UPSERT_COMIC` | `{ ok }` |
| popup | background | `REMOVE_COMIC` | `{ ok }` |
| popup | background | `CHECK_UPDATES` | `{ done }` |
| options | background | `GIST_INIT` | `{ ok, gistId, error? }` |
| options | background | `SAVE_SETTINGS` | `{ ok }` |
| popup | content (tab) | `TOGGLE_DARK` | `{ darkNow }` |

## Data Model (`chrome.storage.local`)

```js
{
  settings: {
    githubPat: "ghp_...",      // not synced to Gist
    gistId: null,
    darkModeGlobal: false,
    autoUpdate: false,         // off by default; manual CHECK_UPDATES always works
    updateAlarmMinutes: 60
  },
  comics: {
    "asura__<slug>": {
      id, title,
      url,                     // manga index URL
      lastChapter: 187,        // last chapter read by the user
      lastChapterUrl,
      lastVisited,             // ISO timestamp
      latestChapter: 192,      // from update check
      latestChecked,
      newChapters: 5,          // latestChapter - lastChapter
      rating: null,            // 1-10
      review: "",
      genres: [],
      addedAt
    }
  },
  darkTabs: { "<tabId>": true }  // cleaned up on tabs.onRemoved
}
```

## Flow: Hotkey Save (Alt+S)

```
Alt+S
  → background.js onCommand("save-comic")
  → chrome.tabs.query(active) → sendMessage(SCRAPE_COMIC)
  → content.js scrapeAsura() → { title, slug, chapter, url }
  → background.js upsertComic() → chrome.storage.local
  → syncToGist()
```

## Flow: Update Check

```
chrome.alarms "update-check" (60 min, only if settings.autoUpdate === true)
  → background.js runUpdateCheck()
  → fetch(asura manga index) per tracked asura comic
  → DOMParser → latestChapter
  → comic.newChapters = latestChapter - lastChapter
  → chrome.storage.local

Manual: popup "Check for updates" → CHECK_UPDATES (always available)
```

## Gotchas

- The service worker is ephemeral. No module-level state; wrap all async operations to be self-contained.
- `content_scripts` with `<all_urls>` does not require broad host permissions (injection only, no fetch).
- PAT is stored as plaintext in `chrome.storage.local`. Use a fine-grained Gist-scoped token.
- AsuraScans DOM selectors may change. A selector array is used; first match wins.
