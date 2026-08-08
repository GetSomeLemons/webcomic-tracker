---
id: features-gist-sync
title: GitHub Gist Sync
category: features
tags: [sync, github, gist, cloud, merge]
related: [architecture-extension-overview]
context_keys: [background.js, syncToGist, pullFromGist, gistInit, mergeComics, mergeComicMaps, queueGistSync, deletedComics, gistEtag, GIST_INIT, GIST_FILENAME, PULL_ALARM]
audience: [developer, ai]
level: intermediate
status: current
since: "2026-07"
---

# GitHub Gist Sync

All comic data syncs to a private GitHub Gist, making it available across devices
and browser profiles. A Personal Access Token is required.

Each Windows/browser profile is a separate extension install with its own
`chrome.storage.local`. The Gist is the only thing they share, so it is the sole
mechanism that carries reading progress between them. (`chrome.storage.sync` is
not an alternative: it syncs one signed-in profile across devices, not two
different profiles on one machine.)

## Setup

1. Create a GitHub PAT: Settings → Developer settings → Tokens → Fine-grained token, scope: **Gists (read+write)**
2. In the options page: paste the PAT → "Connect" → a Gist is created or found automatically
3. Repeat in every profile that should share the library, using the same PAT.

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
  },
  "deleted": {
    "asura__dropped-series": "2026-07-28T09:12:00.000Z"
  }
}
```

`githubPat`, `gistId`, and `gistEtag` are not included; they are the sync
credentials and cache state themselves.

`buildPayload(settings, comics, deleted)` produces this document, and everything
that writes one calls it: the push, the Gist seed created by `gistInit()`, and the
local export below. One shape, so a downloaded file and the Gist file are
interchangeable.

## Local export / import

The options page can write the same document to a file and read one back, for
anyone who does not want a GitHub account — or who wants a copy on disk before an
experiment.

| Message | Does |
|---|---|
| `EXPORT_DATA` | Returns `{ payload }` straight from `buildPayload()` |
| `IMPORT_DATA { data }` | Merges a parsed file into the library, returns `{ ok, count }` |

Export builds a `Blob`, hands it to a `<a download>` and revokes the object URL.
An extension page can do that unaided, so the feature costs **no permission** — in
particular not `downloads`.

Import is the same merge a pull performs: `mergeComicMaps(data.comics, local,
tombstones)` followed by `adoptMerged()`, which re-merges inside the write lock.
So an import **adds and reconciles, it never replaces** — a comic read further
locally keeps its position, and nothing outside the file is lost. Two consequences
worth stating plainly:

- A tombstone in the file **can** remove a local comic, exactly as one arriving
  over the Gist can. That is what makes a deletion travel, and it is why the
  options page says "merges", not "adds".
- `adoptMerged()` is called with a null etag. The library now holds comics the
  Gist has not seen, so the next pull has to read the remote in full instead of
  short-circuiting on a 304.

A push is queued afterwards, so an import in one profile reaches the others.
Rejected without touching storage: a file that is not JSON, and one whose `comics`
is missing or not an object.

## When sync runs

| Trigger | Direction |
|---------|-----------|
| `chrome.runtime.onStartup`, `onInstalled` | pull |
| `gist-pull` alarm, every 5 min while a PAT + gistId exist | pull |
| Popup opened | pull (fired without blocking the UI) |
| "↓ Sync" button | pull |
| After every UPSERT / REMOVE / REWIND / ACKNOWLEDGE / update check | push |

The pull alarm is deliberately independent of the `autoUpdate` setting. A profile
that stays open all day would otherwise never learn what another profile read:
`onStartup` fires once per browser launch, and switching Windows profiles does not
restart the one you left.

## Merge Strategy

Both directions merge; neither overwrites. `mergeComicMaps()` unions the two
libraries by id, and `mergeComics()` reconciles a comic that exists on both sides
field by field:

| Field | Rule |
|-------|------|
| `lastChapter` | highest of the two |
| `chapterHistory` | union by chapter number, newest `visitedAt` per chapter |
| `lastVisited` | most recent |
| `latestChapter`, `latestChecked` | from whichever side checked most recently |
| `acknowledgedChapter` | highest |
| `status` | from whichever side changed it most recently (`statusChangedAt`) |
| `addedAt` | earliest |
| `rewoundTo`, `rewoundAt` | from whichever side rewound most recently (`rewoundAt`) |
| `rating`, `review`, `genres`, `coverUrl` | from the most recently visited side |

Whole-object "newest wins" is wrong here, which is what an earlier version did:
the profile that *visited* most recently is not necessarily the one that read
*furthest*, so taking its object wholesale discarded the other profile's chapters.

### Push is read-merge-write

`syncToGist()` GETs the Gist, merges local data into it, then PATCHes the result
back — and adopts the merged result locally, so every push doubles as a pull. A
blind PATCH of local data (the earlier behaviour) erased anything another profile
had pushed since this profile last pulled. That was the root cause of "reading in
profile A never shows up in profile B", and it lost data in the Gist rather than
merely failing to display it.

If the pre-write GET fails, the push is **abandoned** rather than sent. Writing a
partial view of the library is how data gets destroyed.

Both directions store their result through `adoptMerged()`, which re-merges
against current storage inside the comics write lock. Each direction spans two
network round trips, and writing back the snapshot taken before them silently
reverted any chapter read in the meantime.

### Deletions

Merging means a deleted comic would be restored from the other profile's copy, so
removals write a tombstone into `deletedComics` (`{ id: isoTimestamp }`), synced
as the payload's `deleted` map. A tombstone suppresses the comic unless its
`lastVisited` is newer than the deletion, in which case the comic was read again
afterwards and counts as re-added. Tombstones are pruned after 30 days, or as soon
as the id no longer resolves to a comic.

### Rewinds

Same problem as deletions, one level down: `chapterHistory` merges as a union and
`lastChapter` as a max, so a rewind that lowered both was handed straight back by
the other side's copy on the next sync. The symptom was that a rewind looked
correct in the popup and was gone after a reload, since `syncToGist()` adopts its
own merge result locally.

`applyRewind()` records the cutoff on the comic (`rewoundTo`, `rewoundAt`) instead
of only applying it. `mergeComics()` takes the most recent of the two cutoffs and
re-applies it *after* the union, dropping the chapters the union put back.

A chapter whose `visitedAt` is newer than `rewoundAt` survives the cutoff — that is
someone reading forward again after the rewind, in either profile, and it moves
`lastChapter` back up. Without that exception the marker would keep deleting real
progress for as long as it stayed on the comic.

Unlike tombstones, rewind markers are not pruned: they are one small field pair on
a comic that already exists, and a stale one is harmless once every remaining
chapter post-dates it.

### Coalesced pushes

`queueGistSync()` is the entry point, not `syncToGist()` directly. A push already
in flight sets a dirty flag and is repeated once when it finishes, so a burst of
writes (auto-track fires on every chapter navigation) collapses into one or two
round trips instead of one per chapter. Every push re-reads storage, so the last
one always reflects the final state.

## Gotchas

- PAT is stored unencrypted in `chrome.storage.local`. Use a fine-grained Gist-scoped token.
- Gist size is limited to ~1 MB (roughly 1000 comics). Overflow shows as a 422 error in the console.
- Sync errors are logged to the console, not surfaced in the UI — except the "↓ Sync" button, which shows "✗ Sync failed".
- The Gist list fetch retrieves max 100 Gists (`?per_page=100`). If the user has more than 100 Gists, the tracker's Gist may be missed.
- Pulls send `If-None-Match` with the stored `gistEtag`; an unchanged Gist costs one 304 and does not count against the rate limit. The etag is cleared on `GIST_INIT`.
- GitHub offers no compare-and-swap on Gists, so read-merge-write still has a
  small race window: two profiles pushing within the same round trip can leave the
  slower one's changes only in its own storage until its next push. The next push
  or pull reconciles, because merging is order-independent and idempotent.
- The merge cannot detect a genuinely conflicting edit to `review` or `rating`
  made in two profiles between syncs. The most recently visited side wins.
- A rewind survives the merge by chapter timestamps, so it can only spare reads
  that left a `chapterHistory` entry. That is every ordinary read — `applyUpsert()`
  logs or re-stamps one for each visited chapter — but a bare `lastChapter` above
  the cutoff with no matching entry (pre-1.5 data, or an update-check result) is
  capped to the cutoff rather than kept.
