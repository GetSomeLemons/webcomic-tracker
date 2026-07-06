---
id: features-gist-sync
title: GitHub Gist Sync
category: features
tags: [sync, github, gist, cloud]
related: [architecture-extension-overview]
context_keys: [background.js, syncToGist, pullFromGist, gistInit, GIST_INIT, GIST_FILENAME]
audience: [developer, ai]
level: intermediate
status: current
since: "2026-07"
---

# GitHub Gist Sync

All comic data syncs to a private GitHub Gist, making it available across devices and browser profiles. A Personal Access Token is required.

## Setup

1. Create a GitHub PAT: Settings → Developer settings → Tokens → Fine-grained token, scope: **Gists (read+write)**
2. In the options page: paste the PAT → "Connect" → a Gist is created or found automatically

## Gist Payload

The Gist contains one file, `webcomic-tracker.json`:

```json
{
  "version": 1,
  "exportedAt": "2026-07-01T12:00:00.000Z",
  "settings": {
    "darkModeGlobal": false,
    "updateAlarmMinutes": 60
  },
  "comics": {
    "asura__solo-leveling": { ... }
  }
}
```

`githubPat` and `gistId` are not included in the payload; they are the sync credentials themselves.

## Functions (background.js)

| Function | When called | Description |
|----------|-------------|-------------|
| `gistInit(pat)` | options: GIST_INIT | Finds an existing Gist or creates a new one, returns gistId |
| `syncToGist()` | after every UPSERT/REMOVE | PATCH overwrites the Gist with local data |
| `pullFromGist()` | chrome.runtime.onStartup | GET merges remote data into local storage |

## Merge Strategy

`pullFromGist()` uses timestamp-based merging:
- Remote wins; new comics are pulled in.
- Local wins if `lastVisited` is newer than remote (user has read on this device).

## Gotchas

- PAT is stored unencrypted in `chrome.storage.local`. Use a fine-grained Gist-scoped token.
- Gist size is limited to ~1 MB (roughly 1000 comics). Overflow shows as a 422 error in the console.
- All sync operations are fire-and-forget. Errors are logged to the console, not shown to the user.
- The Gist list fetch retrieves max 100 Gists (`?per_page=100`). If the user has more than 100 Gists, the tracker's Gist may be missed.
