---
id: features-drop-status
title: Reading Status
category: features
tags: [status, drop, popup, toast, badge]
related: [features-gist-sync, features-popup-detail, architecture-extension-overview]
context_keys: [status.js, background.js, popup.js, content.js, SET_STATUS, STATUSES, STATUS_TRACKED, isTracked, statusMeta, showStatusToast, statusChangedAt, renderTabs]
audience: [developer, ai]
level: intermediate
status: current
since: "2026-07"
---

# Reading Status

Every comic carries one status. **Tracked** is the active state; the other four
park a series without losing it — the entry and its whole reading history stay in
the library, it just stops demanding attention.

| Status | `id` | For |
|---|---|---|
| Tracked | `tracked` | Actively following |
| On hold | `hold` | Paused, intending to resume |
| Plan | `plan` | Saved to start later |
| Completed | `completed` | Finished — caught up or the series ended |
| Dropped | `dropped` | Read some of, not keeping up |

The table lives in `status.js`, loaded by all three contexts the same way
`urls.js` is. Nothing else in the extension writes a status string, so a sixth
status is a sixth row plus nothing: the tabs, the detail selector, the toast and
the worker's validation are all generic over it.

Comics saved before statuses existed have no `status` field, and a status pushed
by a newer version arrives as a string this one may not know. `statusMeta()`
resolves both to tracked, so there is nothing to migrate in either direction.

## What parking changes

The rule is binary — `isTracked()`, not a per-status matrix. Only tracked comics
are actively followed; the other four behave identically.

| | Tracked | Parked (the other four) |
|---|---|---|
| Appears under | its own tab | its own tab |
| Included in update checks | yes | **no** — skipped in `runUpdateCheck()` |
| Counts toward the toolbar badge | yes | **no** |
| Listed under "New chapters" in the popup | yes | no |
| Chapter history recorded while reading | yes | yes |
| Row styling | normal | `comic-row--parked`, muted title and faded cover |

Skipping parked comics in the update check is the point of the feature, and it
also makes checks cheaper the more you park.

## Changing status

`SET_STATUS { id, status }` is the **only** thing that changes status. It stamps
`statusChangedAt`, refreshes the badge, and pushes to the Gist. A status not found
in `STATUSES` falls back to `tracked` rather than being stored — an unknown value
would park a comic in a tab no version can show.

Reading a parked series does not revive it — picking up a chapter to see whether
it got better should not silently re-subscribe you. Neither does Alt+S / "Track",
which reports `Saved: … · still on hold` (or dropped, completed, …) so the comic
does not look like it went missing when it fails to reappear under Tracked.
Status is changed from the selector in the detail panel.

## Cross-profile merge

`mergeComics()` resolves status by `statusChangedAt`, not by `lastVisited`. This
matters because parking does not touch `lastVisited`: if status followed the most
recent visit, reading one chapter in profile B would silently undo a drop made in
profile A. A comic with no `statusChangedAt` never overrides one that has it.

The merge compares timestamps and copies a string, so it never needed to know the
set of values — adding statuses required no sync change at all.

## Status toast

`showStatusToast()` in `content.js` announces a comic's status when its **index
page** opens, so it is obvious whether you already follow it — and especially
whether you deliberately parked it — before sinking time in.

| Situation | Toast |
|---|---|
| Tracked, caught up | `✓ Tracked · read up to Ch 187` |
| Tracked, behind | `✓ Tracked · read up to Ch 187 · 5 new` |
| Saved, nothing read | `✓ Tracked · nothing read yet` |
| Parked | `⏸ On hold · read up to Ch 42` |

The icon and the toast's left-edge accent both come from the comic's `STATUSES`
row, so the state is readable without reading the text. Only tracked comics get
the `· N new` suffix: a parked series is not something you are behind on.

Untracked comics produce no toast. Chapter pages produce no toast either — firing
on every chapter would be noise while reading.

The "N new" count is computed from the chapter links on the page being viewed
(`latestChapterFromIndexDom()`), not from stored data, because the index check
writing that stored value runs concurrently and may not have landed yet.

## Gotchas

- The popup body is `420px` partly to fit five tabs on one row; it was `380px`
  when there were two. `.tabs` still scrolls sideways (`overflow-x: auto`,
  scrollbar hidden) with `.tab` at `flex: 0 0 auto`, as a safety net for long
  labels and three-digit counts. Going back to `flex: 1` truncates the longer
  labels instead.
- `renderTabs()` rebuilds its buttons on every call, so the click listeners are
  bound there and not in `bindEvents()` — a one-time binding would be lost on the
  first re-render.
- `onNavigate()` runs `autoTrack()`, `checkIndexForUpdates()`, and
  `showStatusToast()` together, on load and on every client-side navigation.
  Before this existed the index check only ran on full page loads, so SPA
  navigation to an index page silently skipped it.
- The popup's storage listener does not reload the list while the detail panel is
  open, so the status selector reloads explicitly and re-opens the panel.
- Changing status switches the popup to the tab the comic moved to. Without that
  the comic appears to vanish.
- Genre filter, search and sort persist across the tabs.
