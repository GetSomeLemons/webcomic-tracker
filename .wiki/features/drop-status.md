---
id: features-drop-status
title: Drop / Tracked Status
category: features
tags: [status, drop, popup, toast, badge]
related: [features-gist-sync, features-popup-detail, architecture-extension-overview]
context_keys: [background.js, popup.js, content.js, SET_STATUS, STATUS_TRACKED, STATUS_DROPPED, isDropped, showStatusToast, statusChangedAt, renderTabs]
audience: [developer, ai]
level: intermediate
status: current
since: "2026-07"
---

# Drop / Tracked Status

A comic is either **tracked** or **dropped**. Dropping is for a series you read
some of but do not care enough about to keep up with: the entry and its whole
reading history stay in the library, it just stops demanding attention.

Comics saved before this feature existed have no `status` field. Missing is read
as tracked everywhere (`isDropped()` in `background.js`, mirrored in `popup.js`),
so no migration is needed.

## What dropping changes

| | Tracked | Dropped |
|---|---|---|
| Appears under | "Tracked" tab | "Dropped" tab |
| Included in update checks | yes | **no** — skipped in `runUpdateCheck()` |
| Counts toward the toolbar badge | yes | **no** |
| Listed under "New chapters" in the popup | yes | no |
| Chapter history recorded while reading | yes | yes |
| Row styling | normal | `comic-row--dropped`, muted title and faded cover |

Skipping dropped comics in the update check is the point of the feature, and it
also makes checks cheaper the more you drop.

## Changing status

`SET_STATUS { id, status }` is the **only** thing that changes status. It stamps
`statusChangedAt`, refreshes the badge, and pushes to the Gist.

Reading a dropped series does not revive it — picking up a chapter to see whether
it got better should not silently re-subscribe you. Neither does Alt+S / "Track",
which reports `Saved: … · still dropped` so the comic does not look like it went
missing when it fails to reappear under Tracked. Restoring is done from the detail
panel, where the button reads "Drop" or "Restore" depending on current status.

## Cross-profile merge

`mergeComics()` resolves status by `statusChangedAt`, not by `lastVisited`. This
matters because dropping does not touch `lastVisited`: if status followed the most
recent visit, reading one chapter in profile B would silently undo a drop made in
profile A. A comic with no `statusChangedAt` never overrides one that has it.

## Status toast

`showStatusToast()` in `content.js` announces a comic's status when its **index
page** opens, so it is obvious whether you already follow it — and especially
whether you deliberately dropped it — before sinking time in.

| Situation | Toast |
|---|---|
| Tracked, caught up | `✓ Tracked · read up to Ch 187` |
| Tracked, behind | `✓ Tracked · read up to Ch 187 · 5 new` |
| Saved, nothing read | `✓ Tracked · nothing read yet` |
| Dropped | `⏹ Dropped · read up to Ch 42` |

Untracked comics produce no toast. Chapter pages produce no toast either — firing
on every chapter would be noise while reading.

`showToast(msg, accent)` takes an optional colour for the left edge: the accent
blue for tracked, the danger red for dropped, so the two are distinguishable
without reading the text.

The "N new" count is computed from the chapter links on the page being viewed
(`latestChapterFromIndexDom()`), not from stored data, because the index check
writing that stored value runs concurrently and may not have landed yet.

## Gotchas

- `onNavigate()` runs `autoTrack()`, `checkIndexForUpdates()`, and
  `showStatusToast()` together, on load and on every AsuraScans client-side
  navigation. Before this existed the index check only ran on full page loads, so
  SPA navigation to an index page silently skipped it.
- The popup's storage listener does not reload the list while the detail panel is
  open, so the Drop button reloads explicitly and re-opens the panel.
- Dropping switches the popup to the tab the comic moved to. Without that the
  comic appears to vanish.
- Genre filter and search persist across the two tabs.
