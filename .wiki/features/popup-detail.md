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

## Chapter History

`renderChapterHistory(c)` renders chapters in reverse order (newest first) inside a 3-column grid.

- The most recent cell (`i === 0`) gets class `chapter-grid-cell--link` and `data-url` set to `c.lastChapterUrl`.
- Clicking it opens the URL directly in a new tab.
- The "Latest" row below the grid shows the scraped latest chapter with an Open button - this only appears when `c.latestChapter > c.lastChapter`.

## Genres

Tags are stored as strings in `c.genres[]`. Display and input normalise to **Title Case** via `toTitleCase()`.

- Old lowercase data is displayed as Title Case automatically (stored value unchanged).
- New genres added via `addGenre()` are stored as Title Case.
- Dedup check uses `toTitleCase(g) === val` to prevent "action" and "Action" coexisting.

### Autocomplete

`<input list="genre-datalist">` with a native `<datalist>` element populated by `updateGenreDatalist()`. Called on every `loadComics()` and after `addGenre()`. Suggests all genres from all tracked comics.

## Genre Filter (list view)

`renderGenreFilter()` builds the `<select>` from all stored genres. Option values stay as raw stored strings (for `includes()` matching); display text is Title Case.
