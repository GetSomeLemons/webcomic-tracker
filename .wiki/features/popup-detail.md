---
id: features-popup-detail
title: Popup Detail Panel
category: features
tags: [popup, genres, chapters, ui]
related: [architecture-extension-overview]
context_keys: [popup.js, popup.html, renderChapterHistory, renderGenreTags, addGenre, renderGenreFilter, updateGenreDatalist]
audience: [developer, ai]
level: intermediate
status: current
since: "2026-07"
---

# Popup Detail Panel

The detail panel opens when a comic row is clicked. It shows rating, genres, review, and chapter history.

## Actions

`Save` · a status selector · `Remove`. The selector is built from `STATUSES` and is
the only way to change status — see `drop-status.md`. Save persists
rating/genres/review only; it never changes status.

The list above the panel is split into one tab per status (`renderTabs()`), each
showing a count, with `activeStatus` holding the selection.

## Sorting

The filter row carries a sort `<select>` beside search and the genre filter. Each
option is one comparator in the `SORTS` map in `popup.js`:

| Option | Orders by |
|---|---|
| ★ Rating | `rating` descending — the default, and what the list did before the control existed |
| New first | `behindBy(c)` descending, ties broken by rating |
| Recent | `lastVisited` descending |
| A–Z | `title` via `localeCompare` |

`behindBy(c)` counts chapters published past the furthest one **read**, not past
the last one acknowledged. Acknowledging dismisses the "New chapters" notice; it
does not mean the chapter was read, so a library sorted by "New first" would
otherwise bury exactly what you were about to open. The same function drives the
red `→ N` row badge, which is where that predicate used to be written out inline.

The choice persists as `settings.popupSort`, written straight to
`chrome.storage.local` like `settings.popupTheme` rather than through
`SAVE_SETTINGS` — that handler re-runs `scheduleAlarms()`, which a display
preference has no business doing. An unrecognised stored value falls back to
`rating`.

Sort, search and the genre filter all persist across the status tabs.

## Chapter History

`renderChapterHistory(c)` renders chapters in reverse order (newest first) inside a 3-column grid.

- Every cell is a link: `chapterUrl(c, h.chapter)` builds the URL from the comic's
  current slug, so all of them keep working after a slug rotation. Before 1.5 only
  the newest cell was clickable, pointing at the stored `lastChapterUrl` — which
  was the URL of whichever chapter was read last, not of the chapter on the cell,
  and which went dead on the next rotation.
- The cell for `lastReadChapter(c)` — the most recently *visited* chapter, not
  necessarily the furthest one — is marked with `chapter-grid-cell--last` as the
  "carry on from here" target.
- The "Latest" row below the grid shows the scraped latest chapter with an Open button - this only appears when `c.latestChapter > c.lastChapter`.

### Rewind

The `Ch #` input plus `Rewind` button below the grid sends `REWIND_COMIC`, which
moves the reading position back to that chapter. It drops the chapters *after* the
one entered and keeps the ones at or below it; an empty input rewinds to the start
and clears the history entirely. Until 1.6.1 it wiped the whole history whatever
you typed, then re-seeded it with a single entry for the chapter you picked.

The cutoff is stored on the comic as `rewoundTo` + `rewoundAt` and re-applied on
every merge — without that marker the Gist copy handed the dropped chapters back
on the next sync. See `gist-sync.md` → Rewinds.

`acknowledgedChapter` is deliberately left alone: rewinding your reading position
does not un-see an update notification, so the badge does not light up again.

## Genres

Tags are stored as strings in `c.genres[]`. Display and input normalise to **Title Case** via `toTitleCase()`.

- Old lowercase data is displayed as Title Case automatically (stored value unchanged).
- New genres added via `addGenre()` are stored as Title Case.
- Dedup check uses `toTitleCase(g) === val` to prevent "action" and "Action" coexisting.

### Autocomplete

`<input list="genre-datalist">` with a native `<datalist>` element populated by `updateGenreDatalist()`. Called on every `loadComics()` and after `addGenre()`. Suggests all genres from all tracked comics.

## Genre Filter (list view)

`renderGenreFilter()` builds the `<select>` from all stored genres. Option values stay as raw stored strings (for `includes()` matching); display text is Title Case.
