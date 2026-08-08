---
id: architecture-extension-overview
title: Extension Architecture Overview
category: architecture
tags: [mv3, architecture, service-worker, content-script, storage]
related: [architecture-function-reference, features-dark-mode, features-gist-sync, concepts-site-adapters]
context_keys: [manifest.json, background.js, content.js, scrape.js, urls.js, popup.js, options.js]
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
| `content.js` | Injected into pages: dark mode, toast, key bindings, auto-tracking |
| `scrape.js` | The page scraper: `scrapeComic`, `scrapeGeneric` |
| `popup.js` | Popup UI: comic list, genre filter, detail/edit panel |
| `options.js` | Settings page: GitHub PAT, sync init, update interval |
| `urls.js` | The `SITES` table plus comic addresses: `parseComicUrl`, `comicId`, `siteFor`, `stableSlug`, `indexUrl`, `chapterUrl`, `lastReadChapter` |
| `status.js` | The `STATUSES` table plus `isTracked`, `statusMeta` |

Every top-level function in these files is listed one line each in
[[architecture-function-reference]], along with a map from "what I want to change"
to the function that owns it. Start there rather than opening `background.js`.

`urls.js` and `status.js` are loaded by all three contexts — `importScripts` in
the service worker, first entries in the `content_scripts` array, and `<script>`
tags before `popup.js` — so links are built and statuses named the same way
everywhere. Both are tables plus pure helpers; neither runs anything on load.

`scrape.js` is split out of `content.js` so the service worker can inject it as a
file when the content script is missing (see the fallback in `saveCurrentTab`),
without dragging in `content.js`'s listeners and observers. It holds no top-level
statements, because it is evaluated a second time in such tabs. There is no
second copy of the scraper any more.

Which sites are understood is entirely the `SITES` table in `urls.js` — see
[[concepts-site-adapters]] for the row fields and for how to add one.

## Message Protocol

All messages follow `{ type: string, ...payload }`.

| Sender | Receiver | Type | Response |
|--------|----------|------|----------|
| background | content | `SCRAPE_COMIC` | `{ id, title, site, urlRoot, slug, chapter }` |
| popup | background | `GET_ALL_COMICS` | `{ comics }` |
| popup | background | `UPSERT_COMIC` | `{ ok }` |
| popup | background | `REMOVE_COMIC` | `{ ok }` |
| popup | background | `CHECK_UPDATES` | `{ started }` — returns at once, see below |
| popup | background | `PULL_FROM_GIST` | `{ ok, count? , unchanged?, error? }` |
| popup | background | `SET_STATUS` | `{ ok, status }` — one of `STATUSES`, see drop-status |
| options | background | `GIST_INIT` | `{ ok, gistId, error? }` |
| options | background | `SAVE_SETTINGS` | `{ ok }` |
| options | background | `EXPORT_DATA` | `{ ok, payload }` — the Gist document, see gist-sync |
| options | background | `IMPORT_DATA` | `{ ok, count, error? }` — merges, never replaces |
| popup | content (tab) | `TOGGLE_DARK` | `{ darkNow }` |

`CHECK_UPDATES` takes `{ force }`. The popup sets it, because an explicit click
means "check now" and should ignore the freshness window.

### The popup does not wait for background work

`CHECK_UPDATES` and the popup's opening `PULL_FROM_GIST` both return immediately.
The background worker writes results to `chrome.storage.local` as they arrive and
the popup re-renders from a `chrome.storage.onChanged` listener, so the list fills
in live instead of blocking on a request that can take a while. Check progress is
published as `checkProgress` for the button label.

The listener skips re-rendering while the detail panel is open: rating and genre
edits live in the popup's `allComics` until Save, and a reload would drop them.

## Data Model (`chrome.storage.local`)

```js
{
  settings: {
    githubPat: "ghp_...",      // not synced to Gist
    gistId: null,
    gistEtag: null,            // conditional-request cache for pulls
    darkModeGlobal: false,
    autoUpdate: false,         // off by default; manual CHECK_UPDATES always works
    updateAlarmMinutes: 60
  },
  comics: {
    // "<site.id>__<stableSlug>" — "asura__solo-leveling", "qi__tower-of-god"
    "asura__<slug>": {
      id, title,
      urlRoot: "https://asurascans.com/manga",   // origin + path type
      slug: "solo-leveling-30e93729",            // rotates on sites that do that
      chapterSep: "/",         // "/chapter/12" vs "/chapter-12"; falls back to
                               // the site's default, then to "/"
      url,                     // unsupported sites only: page URL as-is
      lastChapter: 187,        // furthest chapter read by the user
      lastVisited,             // ISO timestamp
      chapterHistory: [{ chapter, visitedAt }],   // capped at 30 entries
      latestChapter: 192,      // from update check
      latestChecked,
      acknowledgedChapter,     // dismisses the badge up to this chapter
      status: "tracked",       // any STATUSES id; absent or unknown = tracked
      statusChangedAt,         // merge key for status; see drop-status
      rating: null,            // 1-10
      review: "",
      genres: [],
      coverUrl,
      addedAt
    }
  },
  deletedComics: { "<id>": isoTimestamp },  // tombstones; see gist-sync
  checkProgress: { running, done, total },  // present only during a check
  darkTabs: { "<tabId>": true }             // cleaned up on tabs.onRemoved
}
```

The unread badge compares `latestChapter` against `acknowledgedChapter ?? lastChapter`.
There is no stored `newChapters` field — it was written but never read.

### Addresses are stored split, links are derived

No whole URL is stored for a comic on a supported site. `urlRoot` + `slug`
(+ `chapterSep`) are the record; `indexUrl(comic)` and `chapterUrl(comic, n)`
rebuild links on every read. A slug rotation is therefore one field write, after
which every link — index, each history entry, the Open button — is correct again.

`chapterSep` is only written when a chapter page was actually seen. A comic
tracked from its index page alone falls back to its site's `chapterSep`, then to
`"/"`. That fallback is load-bearing: on qimanga `/chapter/88` is a hard 404, so
without it every chapter cell in the detail panel would be a dead link.

Pre-1.5 storage held `url` (index) and `lastChapterUrl` instead. They rotted
independently: `url` was rewritten on each visit, `lastChapterUrl` never was, so
"open where I left off" eventually landed on a dead link that AsuraScans
redirects to the comic's front page. `splitAddress()` in `background.js`
converts old entries on service-worker startup and drops both fields; it also
runs against entries arriving from an older profile over Gist.

"Where you left off" is derived too — `lastReadChapter()` takes the newest
`chapterHistory` entry by `visitedAt`, which is not necessarily `lastChapter`
(the furthest read).

All writes to `comics` go through `withComicsLock()` (`upsertComic`, `patchComic`).
The whole library lives under one storage key, so two overlapping
read-modify-write cycles drop one side's changes — reachable whenever a page visit
lands during an update check, or between the check's own parallel workers.

## Flow: Hotkey Save (Alt+S)

```
Alt+S
  → background.js onCommand("save-comic")
  → chrome.tabs.query(active) → sendMessage(SCRAPE_COMIC)
  → scrape.js scrapeComic() → { id, title, site, urlRoot, slug, chapter }
  → background.js upsertComic() → chrome.storage.local
  → syncToGist()
```

If the content script is not in the tab (a page opened before the extension was
reloaded), `saveCurrentTab()` injects `urls.js` + `scrape.js` with
`executeScript({ files })` and then calls `scrapeComic()` in a second call. The
first call is allowed to fail: re-injecting into a tab that already has them
throws on the `const SITES` redeclaration, and in that case the function is
already there.

## Flow: Update Check

```
chrome.alarms "update-check" (60 min, only if settings.autoUpdate === true)
  → runUpdateCheck()
  → skip parked (non-tracked) comics, comics on unsupported sites, comics with no split
    address, and any whose latestChecked is under 6 h old (unless force)
  → pass 1: fetch(index) for 5 comics at a time
            → extractLatestChapter(html)   // text parsing, no DOM
            → parseComicUrl(res.url) or the canonical link → fresh slug
            → patchComic() per result, progress published as it goes
  → pass 2: whatever pass 1 could not read → checkComicViaTab(), serialized,
            max 3 per run
  → updateBadge() → queueGistSync()

Manual: popup "Check for updates" → CHECK_UPDATES { force: true }
```

Results are written per comic as they arrive, not once at the end, so a worker
that gets terminated mid-run keeps the progress it made.

The check also refreshes the slug. It already has the page in hand, so a stale
slug costs nothing extra to notice: pass 1 reads the fetch's final URL (a stale
slug redirects) or the page's canonical link, pass 2 reads the tab's
`location.href` after loading. `ownsAddress(id, address)` gates the write — the
new slug must still reduce to the comic's id, so a redirect to somewhere else
cannot take over the entry. Visiting the site is no longer the only way stored
links get repaired.

Two alarms exist: `update-check` (gated on `autoUpdate`) and `gist-pull` (always
on when sync is configured). `scheduleAlarms()` owns both.

## Gotchas

- **There is no DOM in a service worker.** `DOMParser`, `document`, and `window` are all undefined in `background.js`. An earlier version parsed fetched index pages with `DOMParser` inside a `try`/`catch` that swallowed the `ReferenceError`, so the fast path failed silently on *every* comic and each one fell through to the background-tab fallback with its fixed 4-second wait. That was the entire cause of update checks taking minutes. `extractLatestChapter()` now parses the markup as text. Injected scripts (`chrome.scripting.executeScript`) do run in a real document and may use selectors — `checkComicViaTab` does.
- The service worker is ephemeral. Module-level variables are acceptable only for transient coordination that is worthless if lost (`writeChain`, `pushInFlight`); everything of record lives in `chrome.storage`.
- Long-running background work must persist incrementally. The worker can be terminated mid-run, and anything only held in memory or written at the end is gone.
- `content_scripts` with `<all_urls>` does not require broad host permissions (injection only, no fetch).
- PAT is stored as plaintext in `chrome.storage.local`. Use a fine-grained Gist-scoped token.
- Site DOM selectors change. `titleSelectors` is an **ordered array**, tried first-with-text-wins — not a comma-joined selector, which `querySelector` would resolve by document order and so let a header's `sr-only` h1 beat the breadcrumb. AsuraScans has already dropped the `.breadcrumb` and `.entry-title` elements its first two selectors target; they are kept because a miss costs nothing.
- Both supported sites are SPAs (AsuraScans on Next.js, Qi Manga on Angular). `onNavigate()` re-runs on client-side routing via a `MutationObserver` watching `location.href`, since the content script only runs once per full page load.
- A site's slug may carry a rotating suffix — AsuraScans uses a hex one (`-30e93729` → `-a80d257e`), likely anti-scraper. That is the `slugSuffix` field of its `SITES` row, not a universal rule; `stableSlug()` is a no-op for sites without it. Stripping it keeps the storage id (`asura__<stableSlug>`) stable across a rotation instead of spawning a duplicate entry. The stored `slug` is refreshed from any page visit (`upsertComic`, `checkIndexForUpdates`) and from every update check.
- Slug refresh during a check depends on the site redirecting (or serving a canonical link) for a rotated slug. If it hard-404s instead, that comic's check yields nothing and the slug is only repaired by the user visiting the comic again — nothing else knows the new suffix.
- The parse from `parseComicUrl()` carries more than the address of record (`chapter`, and a `chapterSep` that is `null` on an index page). Never `Object.assign` it wholesale onto a comic — `applyCheckResult()` and `splitAddress()` both pick out `urlRoot` and `slug` explicitly, because a `null` would clobber a good separator.
- `chrome.runtime.sendMessage` serializes as JSON, not structured clone. That is why `parseComicUrl()` returns `site` as a host string: a `SITES` descriptor would arrive with its `RegExp` fields as empty objects.
- qimanga.com answers 403 to a default user agent and 400 to the `www.` host. The service worker's `fetch` sends a Chrome UA and reaches the apex fine; a scripted `curl` needs `-A`.
- `mergeComics` resolves the slug through the generic "most recently visited copy wins" rule, so a profile that read a chapter but has an older slug can push a stale one over a fresher one. It self-corrects on that profile's next check or visit rather than sticking.
