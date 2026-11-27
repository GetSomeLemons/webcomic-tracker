---
id: features-recommendations
title: Recommendations
category: features
tags: [recommendations, asurascans, qimanga, rating, genres, author]
related: [architecture-extension-overview, concepts-site-adapters, features-drop-status]
context_keys: [recommendations.html, recommendations.js, qiDetails, recommendations, astroDecode, buildProfile, score]
audience: [developer, ai]
level: intermediate
status: current
since: "2026-11"
---

# Recommendations

`recommendations.html` suggests series from AsuraScans and Qi Manga that are not in
the library yet. It is opened from the 💡 button in the popup header. The page
shows the last result from storage and builds one on first open or when the user
clicks Refresh. A build takes about 10 seconds and some 50 requests, and opens no tabs.

All the work runs in the page itself. An extension page has a DOM and the
extension's host permissions, and nothing here needs to happen while nobody is
looking. The service worker is not involved and there is no message type for it.

## Where the data comes from

| | AsuraScans | Qi Manga |
|---|---|---|
| Catalog | `/browse?page=N`, 22 pages × 20 | `api.qimanga.com/api/v1/series?genre=<slug>&perPage=100&sort=popular` |
| Genres, author, artist | in the browse records | only from `/series/<slug>` (detail call) |
| Site rating | `rating`, 0–10 | `avgRating`, 0–5 |

**AsuraScans.** Comic pages sit behind a Cloudflare challenge (see the gotchas in
[[architecture-extension-overview]]), but `/browse` does not. The page is an Astro
site, and the browse grid's `<astro-island component-url="…BrowseFilters…">`
carries the whole result page in its `props` attribute: `initialSeries` (full
records with `slug`, `genres`, `author`, `artist`, `rating`, `public_url`,
`latest_chapters`) and `initialTotalPages`. Astro serializes props as nested
`[type, value]` pairs, and `astroDecode()` unwraps them. The `slug` in these
records already lacks the rotating suffix, so `comicId(asura, slug)` matches
stored ids directly.

**Qi Manga.** The list endpoint gives title, slug, cover and `avgRating` but no
genres or people. Candidates therefore come from the listings of the profile's
four strongest genres, two pages each. Only the 20 best of them get the detail
call that names the author and artist, and only fully known entries reach the
final list. `?genre=` must be a slug Qi has, checked against `/series/genres`,
because an unknown value cannot be trusted to filter. `perPage` caps at 100. The
API host needed its own `host_permissions` entry.

Detail calls are cached in `chrome.storage.local.qiDetails` for 7 days, keyed by
slug. Without the cache, every saved Qi comic would cost a request on every build.

## Scoring

1. **Weight per saved comic.** The user's rating minus 5.5, so 10 → +4.5 and
   1 → −4.5. An unrated comic counts +1 (being read is mild interest), or −2 if dropped.
2. **Profile.** Each genre slug and each person (author or artist) collects the
   weights of the saved comics that have it. Affinity is `sum / (n + 1)`, which
   shrinks a single example toward zero. The user's own genre tags count as well,
   matched to site genres by slug.
3. **Candidate score** = genre affinities summed and divided by √(genre count),
   plus 2 × the strongest person affinity, plus a site-rating term
   `(rating − 0.8) × 5` on a 0–1 scale. Site ratings cluster high, so the rating
   term only tips close calls.
4. **People are discounted by how prolific they are.** A person's affinity is
   divided by √(number of catalog entries crediting them). Studios such as Daon
   or Studio Inus are credited on dozens of series, and without the discount every
   suggestion read "same author as …". A person is named as a reason only above
   0.5 after the discount.

Excluded are any saved comic, of any status, by id, and also by normalized
title. The title check stops a comic saved on one site from being suggested from
the other. The same series on both sites is shown once.

## Storage

```js
qiDetails: { "<qi slug>": { at, genres: [{ slug, name }], people: [author, artist] } },
recommendations: { builtAt, items: [{ title, url, cover, site, genres, reasons }],
                   errors, savedCount, ratedCount, topGenres }
```

Neither key is synced to the Gist. Both are rebuilt from the sites.

## Gotchas

- Both sources are scraped, not contracted. If Asura's browse page loses the
  island, the build reports "the browse page no longer carries series data" and
  continues with Qi alone, and the reverse also works.
- The catalog code lives in `asura.js` and is shared with the update check (pass 0,
  which reads `latest_chapters`). It parses text, not a DOM, because the service
  worker has none. A change to the browse page breaks both features at once.
