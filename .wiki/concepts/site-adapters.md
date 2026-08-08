---
id: concepts-site-adapters
title: Site Adapters
category: concepts
tags: [sites, scraping, urls, extensibility]
related: [architecture-extension-overview]
context_keys: [SITES, urls.js, scrape.js, parseComicUrl, comicId, siteFor, manifest.json]
audience: [developer, ai]
level: intermediate
status: current
since: "2026-08"
---

# Site Adapters

Every comic site the extension understands is one row of the `SITES` table at the
top of `urls.js`. Nothing else in the extension names a site: the scraper, the
link builders and the update check are all generic over that table.

## Row fields

| Field | Required | Purpose |
|-------|----------|---------|
| `id` | yes | Storage id prefix — a comic is keyed `` `${id}__${stableSlug}` ``. Never change it for a live site; every stored comic is keyed by it. |
| `host` | yes | Apex hostname. Also the value of a comic's `site` field, which is how `siteFor()` finds the row again. |
| `pathType` | yes | Regex alternation of the path segment that introduces a comic (`"manga\|comics"`, `"series"`). Captured and stored in `urlRoot`, so a site serving both keeps whichever the page used. |
| `chapterSep` | yes | Separator between `chapter` and the number. Used when the comic was only ever tracked from its index page and no chapter URL was ever seen. |
| `titleSelectors` | yes | Array of CSS selectors tried **in order**, first with text wins. Not a comma-joined selector: that would resolve by document order and hand a header's `sr-only` h1 the win. |
| `slugSuffix` | no | Regex for a rotating slug suffix to strip when building the storage id. Omit it when the site's slugs are stable. |

`origin` and `re` are derived once at load; do not write them by hand.

## Derived URL pattern

```
origin / pathType / slug [ /chapter<sep><n> ] [ trailing slash ]
```

One anchored regex per site covers both the index page and a chapter page. The
chapter number is matched as `\d+(?:\.\d+)?` and parsed with `parseFloat`, because
bonus and side chapters are numbered `chapter-88.5`; parsing one as `88` would mark
the real chapter 88 as read and hide it. Every consumer — `Math.max` on
`lastChapter`, the `chapterHistory` sort, the `byChapter` map in `mergeComics()`,
`applyRewind()`'s cutoff — is numeric-generic and needed no change. Integers keep
serialising as integers, so stored data is untouched.

`parseComicUrl()` returns `{ site, urlRoot, slug, chapterSep, chapter }` — plain
JSON, because that value crosses `chrome.runtime.sendMessage` (which serializes
as JSON, so a descriptor with a `RegExp` field would arrive as `{}`) and lands in
`chrome.storage`.

Only `urlRoot` and `slug` are ever copied onto a stored comic. `applyCheckResult()`
and `splitAddress()` in `background.js` both narrow the parse explicitly —
`Object.assign(comic, wholeParse)` would overwrite a good `chapterSep` with `null`.

## Adding a site

1. Add a row to `SITES`. Confirm the chapter separator by loading a chapter URL
   with the other separator: on qimanga `/chapter/88` is a hard 404, so getting
   this wrong turns the whole chapter-history grid into dead links.
2. Add `"https://<host>/*"` to `host_permissions` in `manifest.json`. The
   background update check fetches index pages directly and needs it. Pin the
   apex: `www.qimanga.com` answers 400, which is why the origin is derived from
   `host` rather than read off the page.
3. Confirm the series page ships its chapter links in the raw markup —
   `curl` it and look for `href="…chapter…"`. If they are there,
   `extractLatestChapter()` reads the newest chapter from a plain `fetch` and the
   comic never needs the slow background-tab fallback.
4. Check the page title shape. `TITLE_CHAPTER_RE` in `scrape.js` trims a trailing
   `chapter 12` or `– Ch. 88`; a site with a different shape needs that regex
   widened rather than a per-site hook.

## Known gaps

- `extractLatestChapter()`'s href fallback is not scoped to the comic's own slug,
  so another series' chapter link on a series page would inflate the result.
  Neither supported site cross-links that way.
- qimanga rejects a default user agent with 403. The service worker's `fetch`
  sends a Chrome UA and gets through; a plain scripted `curl` will not.

See [[architecture-extension-overview]] for how the address model fits the rest.
