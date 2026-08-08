---
id: architecture-function-reference
title: Function Reference
category: architecture
tags: [reference, functions, map, entry-points]
related: [architecture-extension-overview, concepts-site-adapters, features-gist-sync, features-popup-detail, features-drop-status, features-dark-mode]
context_keys: [background.js, content.js, popup.js, urls.js, status.js, scrape.js, options.js]
audience: [developer, ai]
level: intermediate
status: current
since: "2026-08"
---

# Function Reference

Every top-level function in `src/`, one line each, so a change can be located
without opening the file it lives in. The *why* behind the tricky ones lives in
the linked articles — this is the index, not the explanation.

`background.js` is 928 lines and `popup.js` 608; reading either whole to find one
function costs more than this page does.

## Change map

| To change… | Touch |
|---|---|
| What a page yields when saved | `scrapeComic` (scrape.js) |
| Which sites are understood | the `SITES` row (urls.js) → [[concepts-site-adapters]] |
| How a stored comic becomes a link | `indexUrl`, `chapterUrl` (urls.js) |
| What a save writes to storage | `applyUpsert` (background.js) |
| How two profiles' copies reconcile | `mergeComics`, `mergeComicMaps` (background.js) → [[features-gist-sync]] |
| When/which comics get checked | `runUpdateCheck` (background.js) |
| How a latest chapter is read | `extractLatestChapter` (fetch) / `checkComicViaTab` (rendered) |
| The unread count | `updateBadge` (background.js) |
| A new popup↔background message | `handleMessage` switch (background.js) + caller |
| Popup list rows | `renderList` (popup.js) |
| Popup detail panel | `showDetail`, `renderChapterHistory` (popup.js) → [[features-popup-detail]] |
| Anything on a page itself | content.js |

## Entry points (not functions)

Where execution actually starts — the functions below hang off these.

| File | Trigger |
|---|---|
| background.js | `onInstalled`, `onStartup`, `commands.onCommand("save-comic")`, `alarms.onAlarm`, `tabs.onRemoved`, `runtime.onMessage`, and a bare `migrateComics()` on every worker wake |
| content.js | top-level `setupKeyBindings()`, `onNavigate()`, a `MutationObserver` on `location.href`, `runtime.onMessage` |
| popup.js | `DOMContentLoaded`, `storage.onChanged` |
| options.js | `DOMContentLoaded`, two button listeners |
| scrape.js | none by design — it is evaluated twice in injected tabs |

## urls.js — addresses

Loaded by all three contexts (`importScripts`, `content_scripts`, `<script>`).

| Function | Does |
|---|---|
| `siteFor(host)` | `SITES` row for a host string, or `null` |
| `parseComicUrl(url)` | URL → `{ site, urlRoot, slug, chapterSep, chapter }`, plain JSON; `null` if no site matches |
| `stableSlug(site, slug)` | Strips the site's rotating suffix; no-op for sites without one |
| `comicId(site, slug)` | Storage key: `` `${site.id}__${stableSlug}` `` |
| `ownsAddress(id, address)` | Guard: does this address still reduce to that comic id? Gates every slug adoption |
| `indexUrl(comic)` | Index link from `urlRoot`+`slug`; falls back to stored `url` for generic comics |
| `chapterUrl(comic, n)` | Chapter link; separator falls back stored → site default → `"/"` |
| `lastReadChapter(comic)` | Newest history entry by `visitedAt` — where you left off, not the furthest read |

## status.js — reading statuses

Loaded by all three contexts, same as `urls.js`. → [[features-drop-status]]

| Function | Does |
|---|---|
| `isTracked(comic)` | Is this comic actively followed? Missing or unknown status reads as tracked |
| `statusMeta(comic)` | The comic's `STATUSES` row — `{ id, label, icon, accent }` — falling back to tracked |

## scrape.js — page scraping

| Function | Does |
|---|---|
| `scrapeComic()` | Supported site → id, title, chapter, split address, cover (index pages only). Falls through to `scrapeGeneric` |
| `scrapeGeneric()` | Unsupported site → `generic__<host+path>` id, page title, whole URL |

## background.js — service worker

### Storage and locking

| Function | Does |
|---|---|
| `withComicsLock(fn)` | Serializes every `comics` write onto one promise chain. **All writers must use it** |
| `migrateComics()` / `applyComicMigration()` | Idempotent per-wake migration: re-key pre-table ids, split old URL pairs |
| `splitAddress(comic)` | Pre-1.5 `url`+`lastChapterUrl` → `urlRoot`+`slug`+`chapterSep` |
| `upsertComic(scraped)` / `applyUpsert()` | Create or update a comic: history entry, `lastChapter` max, slug self-heal, user fields |
| `patchComic(id, fields)` | Assign fields to one comic, re-reading inside the lock |
| `ensureDefaults()` | First-run `settings` / `comics` / `darkTabs` / `elementBindings` |

### Merging

| Function | Does |
|---|---|
| `mergeComics(a, b)` | Field-level merge of one comic's two copies — history union, chapter max, per-field timestamp winners |
| `applyRewind(comic, to, at)` | Drops chapters above the cutoff, records `rewoundTo`/`rewoundAt`; spares chapters visited after `at` |
| `mergeComicMaps(remote, local, tombstones)` | Merges whole libraries, honouring tombstones |
| `pruneTombstones(tombstones, comics)` | Drops tombstones older than 30 days or whose id resolves again |

### Update check

| Function | Does |
|---|---|
| `runUpdateCheck({force})` | Picks eligible comics, runs pass 1 (fetch) then pass 2 (tab), writes per comic |
| `mapLimit(items, limit, fn)` | N workers over a shared cursor — the pass-1 concurrency |
| `fetchLatestChapter(url)` | `fetch` + parse → `{ latestChapter, coverUrl, address }`; `null`s on any failure |
| `extractLatestChapter(html)` | Text parsing: `__NEXT_DATA__` blob first, then highest `href="…chapter…"`. **No DOM here** |
| `canonicalUrl(html)` | `rel=canonical` or `og:url`, for spotting a rotated slug |
| `checkComicViaTab(comic)` | Fallback: background tab, poll the rendered DOM, close it. Capped per run |
| `applyCheckResult(id, result)` | Writes latest/cover, and the new address only if `ownsAddress` agrees |
| `setCheckProgress(p)` | Publishes progress to storage so the popup can render it |
| `updateBadge()` | Unread count: `latestChapter > (acknowledgedChapter ?? lastChapter)`, parked comics excluded |

### Gist sync

| Function | Does |
|---|---|
| `queueGistSync()` | Coalesces pushes; re-runs once if a write landed mid-push. **The entry point — not `syncToGist`** |
| `syncToGist()` | Read-merge-write. Skips the push entirely if the read failed |
| `pullFromGist()` | Conditional GET via etag, merge, adopt |
| `adoptMerged(comics, tombs, etag)` | Stores a merge result, re-merging against current storage inside the lock |
| `fetchGist(settings, etag)` | GET the gist; `{unchanged:true}` on 304 |
| `gistInit(pat)` | Finds the existing tracker gist or creates a private one |
| `gistHeaders(pat)` | Auth headers |

### Messaging and misc

| Function | Does |
|---|---|
| `handleMessage(msg)` | The whole message protocol, one switch. Add new types here |
| `saveCurrentTab(tabId)` | Alt+S path: message the content script, else inject `urls.js`+`scrape.js` and call `scrapeComic` |
| `sendToast(tabId, msg)` | Fire-and-forget toast, errors swallowed |
| `scheduleAlarms()` | Owns both alarms: `update-check` (gated on `autoUpdate`) and `gist-pull` (on whenever sync is set up) |

## content.js — injected into pages

| Function | Does |
|---|---|
| `applyDark(enable)` | Adds the filter stylesheet and toggles `html.wct-dark` → [[features-dark-mode]] |
| `showToast(msg, accent)` | Fixed-position toast, 2.5 s, optional accent stripe |
| `onNavigate()` | Runs `autoTrack` + `checkIndexForUpdates` + `showStatusToast`. Called on load and on SPA navigation |
| `autoTrack()` | Silently logs a chapter for an already-tracked comic; 60 s re-visit guard |
| `indexAddress()` | The parsed address, but only on an index page — the guard both index-only features share |
| `checkIndexForUpdates()` | Reads latest chapter + cover + current slug off the rendered index page; sends only when something changed |
| `latestChapterFromIndexDom(slug)` | Highest chapter number linked on the page |
| `showStatusToast()` | "✓ Tracked · read up to Ch N · X new" on opening an index page; icon and accent from `statusMeta` |
| `setupKeyBindings()` | Installs the per-hostname keydown handler; ignores input fields |
| `saveBinding(hostname, b)` | Stores one binding, replacing any with the same key |
| `keyStr(e)` | Keydown → `"Ctrl+Alt+]"` string. Same format on both write and read paths |
| `enterPickMode()` / `exitPickMode()` | Element picker on/off: overlay, banner, three capture-phase listeners |
| `injectPickOverlay()` / `removePickOverlay()` | The dim layer plus the hover highlight box |
| `onPickHover(e)` / `onPick(e)` / `onPickEscape(e)` | Track hover, capture the click then the key, cancel |
| `generateSelector(el)` | Shortest `#id`-or-`tag.class` path (max 6 levels) that still selects the element |
| `showPickBanner(text)` / `removePickBanner()` | The instruction bar during picking |

## popup.js — popup UI

State lives in module globals: `allComics`, `currentId`, `activeTab`, `activeStatus`,
`sortMode`.
Detail-panel edits sit in `allComics` until Save, which is why `storage.onChanged`
skips reloading while `currentId` is set.

| Function | Does |
|---|---|
| `loadComics()` | Fetches all comics, then re-renders tabs, list, genre filter, datalist, notice |
| `renderList()` | The comic rows: status tab, search and genre filter, ordered by the chosen `SORTS` comparator |
| `behindBy(comic)` | Chapters published past the furthest one read; drives the red row badge and the "New first" sort |
| `applySort()` / `saveSort(mode)` | Read and persist `settings.popupSort` |
| `renderTabs()` | Builds one tab per `STATUSES` row with its count, binds their clicks → [[features-drop-status]] |
| `renderUpdatesNotice()` | Unread banner with per-comic acknowledge buttons |
| `renderGenreFilter()` / `updateGenreDatalist()` | Genre `<select>` and the input's autocomplete list |
| `showDetail(id)` / `hideDetail()` | Open and close the detail panel |
| `renderChapterHistory(c)` | Chapter grid with derived links, "where you left off" marker, Latest row |
| `renderRating(current)` | 1-10 buttons; click toggles, writes to `allComics` only |
| `renderGenreTags(genres)` / `addGenre()` | Tag chips and Title Case add-with-dedupe |
| `bindEvents()` | Every listener in the popup except the tabs', including Track, Rewind, status, Check, Sync, Save, Remove |
| `renderProgress()` | Turns the Check button into a live `Checking n/m…` label |
| `applyTheme()` / `toggleTheme()` | Popup light/dark, persisted as `settings.popupTheme` |
| `showBindingsView()` / `hideBindingsView()` / `renderBindingsList(host)` / `deleteBinding(host, key)` | The key-bindings view for the active tab's hostname |
| `toggleDebugPanel()` / `populateDebug()` | Diagnostics: worker ping, content-script ping, shortcut, storage summary |
| `checkTabRestriction()` / `checkSyncStatus()` / `showVersion()` | The three notices: non-web tab, sync not configured, version badge |
| `updateLastChecked()` | "Last: 3h ago" from the newest `latestChecked` |
| `timeAgo` / `formatDate` / `formatDateMD` / `toTitleCase` / `esc` | Formatting helpers. **`esc()` guards every interpolation into `innerHTML`** |

## options.js — settings page

| Function | Does |
|---|---|
| `showGistLink(gistId)` | Reveals the gist.github.com link after a successful connect |
| `setStatus(id, msg, cls)` | Writes one of the two inline status lines |

Connect sends `GIST_INIT`, Save sends `SAVE_SETTINGS`; both are inline listeners.
