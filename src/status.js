// Reading statuses. Loaded by the service worker (importScripts), the content
// script and the popup, so all three name the same set of values.
//
// Same shape as the SITES table in urls.js and for the same reason: the worker
// validates against it, the popup builds its tabs and its detail selector from
// it, and the content script reads a label and an accent colour off it. One row
// per status, and nothing else in the extension writes a status string.

// Order is display order: the tab strip and the detail selector both follow it,
// active first. `id` is what lands in a comic's `status` field — never change one
// for a status already in the wild, since stored comics carry the string.
const STATUSES = [
    { id: "tracked",   label: "Tracked",   icon: "✓", accent: "#4a9eff" },
    { id: "hold",      label: "On hold",   icon: "⏸", accent: "#e0a33e" },
    { id: "plan",      label: "Plan",      icon: "\u{1f516}", accent: "#9a7ae0" },
    { id: "completed", label: "Completed", icon: "\u{1f3c1}", accent: "#4caf50" },
    { id: "dropped",   label: "Dropped",   icon: "⏹", accent: "#ff6b6b" },
];

// Comics saved before statuses existed have no `status` field, and a status
// arriving from another profile may be one this version does not know. Both read
// as tracked, so there is nothing to migrate in either direction.
const STATUS_TRACKED = "tracked";

// Only tracked comics are actively followed: update checks and the unread badge
// serve them and nothing else. The other four are parked — history intact, no
// requests, no badge.
const isTracked = (comic) => (comic?.status ?? STATUS_TRACKED) === STATUS_TRACKED;

const statusMeta = (comic) =>
    STATUSES.find((s) => s.id === (comic?.status ?? STATUS_TRACKED)) ?? STATUSES[0];
