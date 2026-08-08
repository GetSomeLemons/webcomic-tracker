// Service worker — ephemeral. All state lives in chrome.storage.local.

// stableSlug / parseComicUrl / indexUrl / chapterUrl — shared with the content
// script and the popup so all three build comic links the same way.
importScripts("urls.js");

const GIST_DESCRIPTION = "webcomic-tracker-data";
const GIST_FILENAME = "webcomic-tracker.json";
const ALARM_NAME = "update-check";
const PULL_ALARM = "gist-pull";

// Pull runs on its own schedule, independent of autoUpdate: a second browser
// profile must converge on its own, without the user clicking "Sync".
const PULL_INTERVAL_MINUTES = 5;
const CHECK_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 10_000;
// Comics checked more recently than this are skipped by a scheduled run.
const FRESH_MS = 6 * 60 * 60 * 1000;
// Each tab fallback costs seconds and flashes a real tab, so cap it per run.
const TAB_FALLBACK_MAX = 3;
const TAB_POLL_ATTEMPTS = 20;
const TAB_POLL_INTERVAL_MS = 400;
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// A comic is either actively tracked or dropped — read some of, but not enough
// to keep up with. Dropped comics stay in the library with their history intact;
// they are just excluded from update checks and the unread badge. Comics stored
// before this existed have no status field, hence the fallback everywhere.
const STATUS_TRACKED = "tracked";
const STATUS_DROPPED = "dropped";

const isDropped = (comic) => comic?.status === STATUS_DROPPED;

// ---------------------------------------------------------------------------
// Comics write lock
// ---------------------------------------------------------------------------

// Every write to the `comics` key funnels through one chain. The whole library
// lives under a single key, so two overlapping read-modify-write cycles silently
// drop one side's changes — easy to hit now that update checks run in parallel,
// or when the user reads a chapter mid-check.
//
// This is transient coordination, not state of record: the service worker may be
// terminated at any time and losing the chain costs nothing. Declared here so
// nothing below can reference it before initialization.
let writeChain = Promise.resolve();

function withComicsLock(fn) {
  const result = writeChain.then(fn);
  writeChain = result.catch(() => {}); // one failure must not break the chain
  return result;
}

// Two one-time-per-load migrations, both idempotent and a cheap no-op once done.
// They run every time the (ephemeral) service worker wakes, which also catches
// old-shape comics arriving from another profile's Gist push.
//
// 1. Comics saved before the stable-id fix are keyed by the full slug, suffix
//    included, so fresh lookups by the new id miss them and silently stop
//    updating. Re-key any leftover old-style entry.
// 2. Comics saved before 1.5 store whole URLs, which rot on the next slug
//    rotation. Split them into urlRoot + slug — see splitAddress.
function migrateComics() {
  return withComicsLock(applyComicMigration);
}

async function applyComicMigration() {
  const { comics = {} } = await chrome.storage.local.get("comics");
  let changed = false;
  const next = {};
  // The only pre-table ids in the wild are AsuraScans', hence the one lookup.
  const asura = siteFor("asurascans.com");
  for (const [id, stored] of Object.entries(comics)) {
    const comic = splitAddress(stored);
    if (comic !== stored) changed = true;
    const newId = id.startsWith("asura__") ? comicId(asura, id.slice(7)) : id;
    if (newId === id) {
      if (!next[id]) next[id] = comic;
      continue;
    }
    changed = true;
    next[newId] = next[newId] ? mergeComics(next[newId], { ...comic, id: newId }) : { ...comic, id: newId };
  }
  if (changed) await chrome.storage.local.set({ comics: next });
}

// Replaces the stored `url` / `lastChapterUrl` pair with urlRoot + slug. Both
// URLs pointed at the slug of the day: the index one was rewritten on every
// visit, the chapter one never was, which is why "open where I left off" landed
// on a dead link. Chapter links are derived from the history from now on.
// Generic (unsupported-site) comics keep `url` — they have no slug to rotate.
function splitAddress(comic) {
  if (!("url" in comic) && !("lastChapterUrl" in comic)) return comic; // already split
  const parsed = comic.slug ? null : parseComicUrl(comic.url);
  if (!parsed && !comic.slug) return comic; // generic site: `url` is the address
  // Only the address of record is adopted; the rest of the parse (chapter,
  // and a null chapterSep that would clobber a good one) stays out.
  const address = parsed && { site: parsed.site, urlRoot: parsed.urlRoot, slug: parsed.slug };
  const chapterSep = comic.chapterSep ?? parsed?.chapterSep
    ?? comic.lastChapterUrl?.match(/\/chapter([/-])\d+/)?.[1];
  const { url, lastChapterUrl, ...rest } = comic;
  return { ...rest, ...address, ...(chapterSep && { chapterSep }) };
}

// Field-level merge of two copies of the same comic. Used both when two
// old-style ids collapse onto one stable id, and on every Gist sync, where the
// two copies are two browser profiles that each read some chapters.
//
// Whole-object "newest wins" is not enough here: the profile that visited most
// recently is not necessarily the one that read the furthest, so progress
// fields are reconciled individually and only free-text fields follow the
// most recent visit.
function mergeComics(a, b) {
  const newer = (a.lastVisited ?? "") >= (b.lastVisited ?? "") ? a : b;
  const byChapter = new Map();
  for (const h of [...(a.chapterHistory ?? []), ...(b.chapterHistory ?? [])]) {
    const existing = byChapter.get(h.chapter);
    if (!existing || h.visitedAt > existing.visitedAt) byChapter.set(h.chapter, h);
  }
  // Update-check results belong to whichever copy checked last, regardless of
  // who read last — a stale null would otherwise wipe a known latest chapter.
  const checked = (a.latestChecked ?? "") >= (b.latestChecked ?? "") ? a : b;
  // Dropping is a deliberate act that does not touch lastVisited, so status
  // follows its own timestamp. Otherwise reading one chapter in another profile
  // would silently undo a drop.
  const statusSide = (a.statusChangedAt ?? "") >= (b.statusChangedAt ?? "") ? a : b;
  return {
    ...a, ...b, ...newer,
    lastChapter: Math.max(a.lastChapter ?? 0, b.lastChapter ?? 0),
    lastVisited: newer.lastVisited,
    chapterHistory: [...byChapter.values()].sort((x, y) => x.chapter - y.chapter),
    latestChapter: checked.latestChapter ?? a.latestChapter ?? b.latestChapter ?? null,
    latestChecked: checked.latestChecked ?? null,
    acknowledgedChapter: Math.max(a.acknowledgedChapter ?? 0, b.acknowledgedChapter ?? 0) || null,
    status: statusSide.status ?? a.status ?? b.status ?? STATUS_TRACKED,
    statusChangedAt: statusSide.statusChangedAt ?? null,
    coverUrl: newer.coverUrl ?? a.coverUrl ?? b.coverUrl ?? null,
    addedAt: [a.addedAt, b.addedAt].filter(Boolean).sort()[0] ?? null,
  };
}

migrateComics().catch((e) => console.warn("Comic migration failed:", e.message));

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureDefaults();
  await scheduleAlarms();
  await updateBadge();
  if (details.reason === "update" || details.reason === "install") {
    const { version } = chrome.runtime.getManifest();
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...(settings ?? {}), installedVersion: version } });
  }
  await pullFromGist();
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarms();
  await pullFromGist();
  await updateBadge();
});

async function ensureDefaults() {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) {
    await chrome.storage.local.set({
      settings: {
        githubPat: "",
        gistId: null,
        darkModeGlobal: false,
        autoUpdate: false,
        updateAlarmMinutes: 60,
      },
      comics: {},
      darkTabs: {},
      elementBindings: {},
    });
  }
}

async function scheduleAlarms() {
  const { settings } = await chrome.storage.local.get("settings");

  await chrome.alarms.clear(ALARM_NAME);
  if (settings?.autoUpdate) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings?.updateAlarmMinutes ?? 60 });
  }

  // Sync is not tied to autoUpdate. Without a periodic pull, a profile that
  // stays open never learns what another profile read (onStartup fires once per
  // browser launch, and switching Windows profiles rarely restarts the other).
  await chrome.alarms.clear(PULL_ALARM);
  if (settings?.githubPat && settings?.gistId) {
    chrome.alarms.create(PULL_ALARM, { periodInMinutes: PULL_INTERVAL_MINUTES });
  }
}

// ---------------------------------------------------------------------------
// Save current tab (used by hotkey command and SAVE_CURRENT message)
// ---------------------------------------------------------------------------

async function saveCurrentTab(tabId) {
  let scraped = null;

  // Try content script first (already injected)
  try {
    scraped = await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_COMIC" });
  } catch (_) {
    // Content script not injected yet — inject the scraper's own files rather
    // than keeping a second, self-contained copy of it here.
    try {
      // Tolerated: if the files already sit in this tab's isolated world the
      // `const SITES` redeclaration throws — and scrapeComic is already there.
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["urls.js", "scrape.js"],
      }).catch(() => {});
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => scrapeComic(),
      });
      scraped = results[0]?.result ?? null;
    } catch (e2) {
      console.warn("executeScript failed (restricted page?):", e2.message);
      sendToast(tabId, "Cannot save on this page.");
      return null;
    }
  }

  if (!scraped) {
    sendToast(tabId, "Nothing to save here.");
    return null;
  }

  await upsertComic(scraped);
  queueGistSync();
  const label = scraped.chapter != null ? `${scraped.title} Ch ${scraped.chapter}` : scraped.title;
  // Saving does not un-drop anything — say so, or the comic looks like it went
  // missing when it does not reappear under Tracked.
  const { comics = {} } = await chrome.storage.local.get("comics");
  sendToast(tabId, `Saved: ${label}${isDropped(comics[scraped.id]) ? " · still dropped" : ""}`);
  return scraped;
}

function sendToast(tabId, msg) {
  chrome.tabs.sendMessage(tabId, { type: "SHOW_TOAST", msg }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Hotkey command
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-comic") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await saveCurrentTab(tab.id);
  } catch (e) {
    console.warn("save-comic failed:", e.message);
  }
});

// ---------------------------------------------------------------------------
// Comic storage
// ---------------------------------------------------------------------------

// Serialized against every other comic write — see withComicsLock. Without it a
// page visit landing mid-update-check overwrites that check's results, or loses
// its own chapter to them.
function upsertComic(scraped) {
  return withComicsLock(() => applyUpsert(scraped));
}

async function applyUpsert(scraped) {
  const { comics = {} } = await chrome.storage.local.get("comics");
  const id = scraped.id;
  const now = new Date().toISOString();
  if (comics[id]) {
    comics[id].title = scraped.title;
    if (scraped.chapter != null) {
      const hist = comics[id].chapterHistory ?? [];
      const entry = hist.find((h) => h.chapter === scraped.chapter);
      if (entry) {
        entry.visitedAt = now;
      } else {
        hist.push({ chapter: scraped.chapter, visitedAt: now });
        hist.sort((a, b) => a.chapter - b.chapter);
      }
      if (hist.length > 30) hist.splice(0, hist.length - 30);
      comics[id].chapterHistory = hist;
      // Always track the highest chapter visited, not just the most recent
      comics[id].lastChapter = Math.max(comics[id].lastChapter ?? 0, scraped.chapter);
    }
    comics[id].lastVisited = now;
    // Self-heal the address: on sites whose slug suffix rotates, any fresh visit
    // replaces a now-stale slug with the current one. One write — every index
    // and chapter link is derived from it.
    if (scraped.slug) Object.assign(comics[id], { urlRoot: scraped.urlRoot, slug: scraped.slug });
    else if (scraped.indexUrl) comics[id].url = scraped.indexUrl;
    if (scraped.chapterSep) comics[id].chapterSep = scraped.chapterSep;
    // Persist user-editable fields when coming from the Save button (not from scraping)
    if (scraped.rating !== undefined) comics[id].rating = scraped.rating;
    if (scraped.review !== undefined) comics[id].review = scraped.review;
    if (scraped.genres !== undefined) comics[id].genres = scraped.genres;
    if (scraped.coverUrl !== undefined) comics[id].coverUrl = scraped.coverUrl ?? null;
  } else {
    comics[id] = {
      id,
      title: scraped.title,
      // Supported-site comics are addressed by urlRoot + slug; anything else
      // keeps the page URL, having no slug to split off.
      ...(scraped.slug ? { urlRoot: scraped.urlRoot, slug: scraped.slug } : { url: scraped.indexUrl }),
      ...(scraped.chapterSep && { chapterSep: scraped.chapterSep }),
      site: scraped.site,
      lastChapter: scraped.chapter,
      lastVisited: now,
      chapterHistory: scraped.chapter != null ? [{ chapter: scraped.chapter, visitedAt: now }] : [],
      latestChapter: null,
      latestChecked: null,
      status: STATUS_TRACKED,
      statusChangedAt: now,
      rating: null,
      review: "",
      genres: [],
      coverUrl: scraped.coverUrl ?? null,
      addedAt: now,
    };
  }
  await chrome.storage.local.set({ comics });
}

// ---------------------------------------------------------------------------
// Update check
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runUpdateCheck();
  if (alarm.name === PULL_ALARM) pullFromGist();
});

// Runs N workers over a shared cursor. Bounded concurrency keeps the request
// rate polite without paying a fixed sleep per comic.
async function mapLimit(items, limit, fn) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) await fn(items[cursor++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Writes one comic's fields, re-reading inside the lock so it merges with
// whatever else has been written since the caller last looked.
function patchComic(id, fields) {
  return withComicsLock(async () => {
    const { comics = {} } = await chrome.storage.local.get("comics");
    if (!comics[id]) return;
    Object.assign(comics[id], fields);
    await chrome.storage.local.set({ comics });
  });
}

// Progress is kept in storage, not held in the worker, so the popup can render
// it after being closed and reopened — and it survives the worker being killed.
function setCheckProgress(progress) {
  return progress
    ? chrome.storage.local.set({ checkProgress: progress })
    : chrome.storage.local.remove("checkProgress");
}

async function runUpdateCheck({ force = false } = {}) {
  const { comics = {} } = await chrome.storage.local.get("comics");
  const now = Date.now();
  const toCheck = Object.values(comics).filter((c) => {
    // A known site and a split address. The `slug` condition keeps old generic__
    // entries out even once their host becomes supported: their stored `url` may
    // be a chapter page, which would make the check read the wrong number.
    // ponytail: one Alt+S on the page converts such an entry properly; write a
    // migration only if there turn out to be many.
    if (!siteFor(c.site) || !c.slug || !indexUrl(c)) return false;
    if (isDropped(c)) return false; // the whole point of dropping
    if (force || !c.latestChecked) return true;
    return now - new Date(c.latestChecked).getTime() > FRESH_MS;
  });

  if (!toCheck.length) {
    await setCheckProgress(null);
    return { checked: 0 };
  }

  let done = 0;
  const needsTab = [];
  const bump = () => setCheckProgress({ running: true, done: ++done, total: toCheck.length });
  await setCheckProgress({ running: true, done: 0, total: toCheck.length });

  // Pass 1: plain fetch, in parallel. Enough for any index page that ships its
  // chapter list in the markup, which is the normal case.
  await mapLimit(toCheck, CHECK_CONCURRENCY, async (comic) => {
    const result = await fetchLatestChapter(indexUrl(comic));
    if (result.latestChapter === null) needsTab.push(comic);
    else await applyCheckResult(comic.id, result);
    await bump();
  });

  // Pass 2: whatever pass 1 could not read gets a real rendered page. These stay
  // serialized — each one opens a visible tab.
  for (const comic of needsTab.slice(0, TAB_FALLBACK_MAX)) {
    try {
      await applyCheckResult(comic.id, await checkComicViaTab(comic));
    } catch (e) {
      console.warn("Tab check failed for", comic.id, e.message);
    }
    await bump();
  }
  const skipped = Math.max(0, needsTab.length - TAB_FALLBACK_MAX);
  if (skipped) console.warn(`${skipped} comic(s) unreadable this run; will retry next check.`);

  await setCheckProgress(null);
  await updateBadge();
  queueGistSync();
  return { checked: toCheck.length - skipped, skipped };
}

async function applyCheckResult(id, { latestChapter, coverUrl, address }) {
  const fields = {};
  if (latestChapter !== null) {
    fields.latestChapter = latestChapter;
    fields.latestChecked = new Date().toISOString();
  }
  if (coverUrl) fields.coverUrl = coverUrl;
  // The check already has the current page in hand, so this is the natural place
  // to notice a rotated slug — the user should not have to visit the site for
  // their stored links to start working again.
  // `address` carries the whole parse; only the two address-of-record fields
  // belong on the comic. Copying the rest would overwrite chapterSep with null.
  if (ownsAddress(id, address)) Object.assign(fields, { urlRoot: address.urlRoot, slug: address.slug });
  if (!Object.keys(fields).length) return;
  // A failed write costs one comic's result, not the rest of the run.
  await patchComic(id, fields).catch((e) => console.warn("Could not store result for", id, e.message));
}

async function fetchLatestChapter(url) {
  const empty = { latestChapter: null, coverUrl: null, address: null };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return empty;
    const html = await res.text();
    return {
      latestChapter: extractLatestChapter(html),
      coverUrl: html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] ?? null,
      // A stale slug redirects to the current one, so the response URL carries
      // the fresh address; the canonical link covers a server that serves the
      // page under the old slug instead of redirecting.
      address: parseComicUrl(res.url) ?? parseComicUrl(canonicalUrl(html)),
    };
  } catch (_) {
    return empty;
  }
}

function canonicalUrl(html) {
  return html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1]
    ?? html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i)?.[1]
    ?? null;
}

async function updateBadge() {
  const { comics = {} } = await chrome.storage.local.get("comics");
  const unread = Object.values(comics).filter(
    (c) => !isDropped(c) && c.latestChapter != null && c.latestChapter > (c.acknowledgedChapter ?? c.lastChapter ?? 0)
  ).length;
  chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : "" });
  if (unread > 0) chrome.action.setBadgeBackgroundColor({ color: "#e53935" });
}


// Opens the comic's index URL in a background tab, waits for JS to render the
// chapter list, scrapes the highest chapter number, then closes the tab.
// The tab appears briefly in the tab bar but does not steal focus.
async function checkComicViaTab(comic) {
  const slug = comic.slug ?? parseComicUrl(comic.url)?.slug;
  if (!slug) return { latestChapter: null, coverUrl: null, address: null };
  // Match chapter links on the suffix-free part of the slug: if the tab was
  // redirected to a rotated slug, the stored one no longer appears in any href.
  const linkSlug = stableSlug(siteFor(comic.site), slug);

  return new Promise((resolve) => {
    let tabId = null;
    let settled = false;
    let lastPageUrl = null;

    function done(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
      // Where the tab actually ended up, which is the current address whenever
      // the stored slug has rotated out from under us.
      resolve({ ...result, address: parseComicUrl(result.pageUrl) });
    }

    async function onUpdated(id, info) {
      if (id !== tabId || info.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      // Poll rather than wait a flat 4s: the chapter list normally renders in
      // well under a second, and that fixed wait dominated the whole run.
      for (let attempt = 0; attempt < TAB_POLL_ATTEMPTS && !settled; attempt++) {
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          func: (s) => {
            const nums = [...document.querySelectorAll(`a[href*="${s}"]`)]
              .map((a) => { const m = a.href.match(/\/chapter[-/](\d+)/i); return m ? parseInt(m[1], 10) : null; })
              .filter((n) => n !== null);
            const coverUrl = document.querySelector('meta[property="og:image"]')?.content ?? null;
            return { latestChapter: nums.length ? Math.max(...nums) : null, coverUrl, pageUrl: location.href };
          },
          args: [linkSlug],
        }).then((r) => r?.[0]?.result ?? null).catch(() => null);

        if (result?.latestChapter != null) return done(result);
        // Keep the URL even when nothing was read: a rotated slug is worth
        // storing on its own, so the next run fetches the right page.
        if (result?.pageUrl) lastPageUrl = result.pageUrl;
        await new Promise((r) => setTimeout(r, TAB_POLL_INTERVAL_MS));
      }
      done({ latestChapter: null, coverUrl: null, pageUrl: lastPageUrl });
    }

    const timer = setTimeout(() => done({ latestChapter: null, coverUrl: null, pageUrl: lastPageUrl }), 20_000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.create({ url: indexUrl(comic), active: false }, (tab) => { tabId = tab.id; });
  });
}

// Parses the raw markup as text. A service worker has no DOM, so DOMParser is
// unavailable here — using it is what made every comic fall through to the slow
// tab fallback. The rendered-page path (checkComicViaTab) still uses selectors,
// because injected scripts do run in a document.
function extractLatestChapter(html) {
  // Next.js ships the chapter list in an SSR data blob, no JS execution needed.
  const blob = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (blob) {
    try {
      const pp = JSON.parse(blob)?.props?.pageProps;
      for (const list of [pp?.chapters, pp?.data?.chapters, pp?.comic?.chapters, pp?.post?.chapters]) {
        if (!Array.isArray(list) || !list.length) continue;
        const nums = list
          .map((c) => parseInt(c.chapter_number ?? c.number ?? c.chapter ?? c.slug, 10))
          .filter((n) => n > 0);
        if (nums.length) return Math.max(...nums);
      }
    } catch (_) {}
  }

  // Fallback: highest chapter number linked anywhere on the page. Scoped to href
  // attributes so prose like "chapter 5 was great" cannot inflate the result.
  const nums = [...html.matchAll(/href="[^"]*chapter[-/](\d+)/gi)].map((m) => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : null;
}

// ---------------------------------------------------------------------------
// GitHub Gist sync
// ---------------------------------------------------------------------------

function gistHeaders(pat) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

// Merges two whole libraries. Every id present on either side survives unless a
// tombstone says it was deleted after the last time anyone read it.
function mergeComicMaps(remote, local, tombstones = {}) {
  const out = {};
  for (const id of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    const comic = remote[id] && local[id]
      ? mergeComics(remote[id], local[id])
      : (remote[id] ?? local[id]);
    // A comic read again after being deleted is treated as re-added.
    if (tombstones[id] && !((comic.lastVisited ?? "") > tombstones[id])) continue;
    out[id] = comic;
  }
  return out;
}

function pruneTombstones(tombstones, comics) {
  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString();
  return Object.fromEntries(
    Object.entries(tombstones).filter(([id, at]) => at > cutoff && !comics[id])
  );
}

async function fetchGist(settings, etag) {
  const res = await fetch(`https://api.github.com/gists/${settings.gistId}`, {
    headers: { ...gistHeaders(settings.githubPat), ...(etag && { "If-None-Match": etag }) },
  });
  if (res.status === 304) return { unchanged: true };
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const gist = await res.json();
  const content = gist.files?.[GIST_FILENAME]?.content;
  return { etag: res.headers.get("etag"), data: content ? JSON.parse(content) : null };
}

// Pushes are coalesced. This is a transient optimization, not state of record:
// if the worker dies mid-push the next push or scheduled pull reconciles, since
// every push re-reads storage and re-merges the remote.
let pushInFlight = null;
let pushDirty = false;

function queueGistSync() {
  if (pushInFlight) {
    pushDirty = true;
    return pushInFlight;
  }
  pushInFlight = (async () => {
    try {
      do {
        pushDirty = false;
        await syncToGist();
      } while (pushDirty);
    } finally {
      pushInFlight = null;
    }
  })();
  return pushInFlight;
}

// Stores a merge result, re-merging against current storage inside the lock.
// Both sync directions span two network round trips, and a chapter read in that
// window would otherwise be overwritten by the pre-request snapshot. Merging is
// idempotent and order-independent, so folding it in again is free.
async function adoptMerged(mergedComics, tombstones, etag) {
  let count = 0;
  await withComicsLock(async () => {
    const { comics: current = {}, settings: currentSettings = {} } =
      await chrome.storage.local.get(["comics", "settings"]);
    const comics = mergeComicMaps(mergedComics, current, tombstones);
    count = Object.keys(comics).length;
    await chrome.storage.local.set({
      comics,
      deletedComics: tombstones,
      settings: { ...currentSettings, gistEtag: etag ?? null },
    });
  });
  return count;
}

// Read-merge-write. A blind PATCH of the local library was erasing whatever
// another profile had pushed since this profile last pulled — the reason reading
// in profile A never showed up in profile B.
async function syncToGist() {
  const { settings, comics = {}, deletedComics = {} } =
    await chrome.storage.local.get(["settings", "comics", "deletedComics"]);
  if (!settings?.githubPat || !settings?.gistId) return;

  try {
    let remote = null;
    try {
      remote = (await fetchGist(settings)).data;
    } catch (e) {
      // Never overwrite a Gist we failed to read; a partial view is how data is lost.
      console.warn("Gist read-before-write failed, skipping push:", e.message);
      return;
    }

    const tombstones = { ...(remote?.deleted ?? {}), ...deletedComics };
    const mergedComics = mergeComicMaps(remote?.comics ?? {}, comics, tombstones);
    const prunedTombs = pruneTombstones(tombstones, mergedComics);

    const res = await fetch(`https://api.github.com/gists/${settings.gistId}`, {
      method: "PATCH",
      headers: gistHeaders(settings.githubPat),
      body: JSON.stringify({
        files: {
          [GIST_FILENAME]: {
            content: JSON.stringify({
              version: 1,
              exportedAt: new Date().toISOString(),
              settings: { darkModeGlobal: settings.darkModeGlobal, updateAlarmMinutes: settings.updateAlarmMinutes },
              comics: mergedComics,
              deleted: prunedTombs,
            }),
          },
        },
      }),
    });
    if (!res.ok) {
      console.warn("Gist sync failed:", res.status, await res.text());
      return;
    }
    // The push already merged the remote, so adopt the result locally too —
    // every push doubles as a pull.
    await adoptMerged(mergedComics, prunedTombs, res.headers.get("etag"));
    await updateBadge();
  } catch (e) {
    console.warn("Gist sync error:", e.message);
  }
}

async function pullFromGist() {
  const { settings, comics = {}, deletedComics = {} } =
    await chrome.storage.local.get(["settings", "comics", "deletedComics"]);
  if (!settings?.githubPat || !settings?.gistId) return { ok: false, error: "sync not configured" };

  try {
    // Conditional request: an unchanged Gist costs one 304 and no rate limit.
    const { unchanged, etag, data } = await fetchGist(settings, settings.gistEtag);
    if (unchanged) return { ok: true, unchanged: true };
    if (!data) return { ok: false, error: "empty gist" };

    const tombstones = { ...(data.deleted ?? {}), ...deletedComics };
    const mergedComics = mergeComicMaps(data.comics ?? {}, comics, tombstones);
    const count = await adoptMerged(mergedComics, pruneTombstones(tombstones, mergedComics), etag);
    await updateBadge();
    return { ok: true, count };
  } catch (e) {
    console.warn("Gist pull error:", e.message);
    return { ok: false, error: e.message };
  }
}

async function gistInit(pat) {
  const headers = gistHeaders(pat);
  const listRes = await fetch("https://api.github.com/gists?per_page=100", { headers });
  if (!listRes.ok) throw new Error(`GitHub API error: ${listRes.status}`);
  const list = await listRes.json();
  const existing = list.find((g) => g.description === GIST_DESCRIPTION && g.files?.[GIST_FILENAME]);
  if (existing) return existing.id;
  const { comics = {} } = await chrome.storage.local.get("comics");
  const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings: {}, comics });
  const createRes = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers,
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILENAME]: { content: payload } },
    }),
  });
  if (!createRes.ok) throw new Error(`Gist create failed: ${createRes.status}`);
  return (await createRes.json()).id;
}

// ---------------------------------------------------------------------------
// Dark tab cleanup
// ---------------------------------------------------------------------------

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { darkTabs = {} } = await chrome.storage.local.get("darkTabs");
  delete darkTabs[tabId];
  await chrome.storage.local.set({ darkTabs });
});

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case "GET_ALL_COMICS": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      return { comics };
    }
    case "SAVE_CURRENT": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: "no active tab" };
      const scraped = await saveCurrentTab(tab.id);
      return { ok: !!scraped, title: scraped?.title };
    }
    case "UPSERT_COMIC": {
      await upsertComic(msg.comic);
      queueGistSync();
      return { ok: true };
    }
    case "REMOVE_COMIC": {
      const { comics = {}, deletedComics = {} } =
        await chrome.storage.local.get(["comics", "deletedComics"]);
      delete comics[msg.id];
      // Record the deletion. Sync merges libraries now, so without a tombstone
      // another profile's copy would just restore it on the next pull.
      deletedComics[msg.id] = new Date().toISOString();
      await chrome.storage.local.set({ comics, deletedComics });
      queueGistSync();
      return { ok: true };
    }
    case "CHECK_UPDATES": {
      // Returns immediately; the popup follows progress via storage.onChanged.
      runUpdateCheck({ force: msg.force ?? false })
        .catch((e) => console.warn("Update check failed:", e.message))
        .finally(() => setCheckProgress(null));
      return { started: true };
    }
    case "GIST_INIT": {
      const { settings } = await chrome.storage.local.get("settings");
      const gistId = await gistInit(msg.pat);
      await chrome.storage.local.set({ settings: { ...settings, githubPat: msg.pat, gistId, gistEtag: null } });
      await pullFromGist();
      await scheduleAlarms();
      return { ok: true, gistId };
    }
    case "SAVE_SETTINGS": {
      const { settings } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: { ...settings, ...msg.settings } });
      await scheduleAlarms();
      return { ok: true };
    }
    case "AUTO_TRACK": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      if (!comics[msg.scraped.id]) return { ok: false };
      await upsertComic(msg.scraped);
      queueGistSync();
      return { ok: true };
    }
    case "UPDATE_LATEST_CHAPTER": {
      await applyCheckResult(msg.id, {
        latestChapter: msg.latestChapter ?? null,
        coverUrl: msg.coverUrl,
        address: msg.address,
      });
      await updateBadge();
      return { ok: true };
    }
    case "REWIND_COMIC": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      if (!comics[msg.id]) return { ok: false };
      const ch = msg.chapter ?? null;
      comics[msg.id].lastChapter = ch;
      comics[msg.id].chapterHistory = ch != null ? [{ chapter: ch, visitedAt: new Date().toISOString() }] : [];
      await chrome.storage.local.set({ comics });
      await updateBadge();
      queueGistSync();
      return { ok: true };
    }
    case "SET_STATUS": {
      const status = msg.status === STATUS_DROPPED ? STATUS_DROPPED : STATUS_TRACKED;
      // Reading a dropped comic does not revive it — only this does. Picking up a
      // chapter to see whether it got better should not silently re-subscribe you.
      await patchComic(msg.id, { status, statusChangedAt: new Date().toISOString() });
      await updateBadge();
      queueGistSync();
      return { ok: true, status };
    }
    case "ACKNOWLEDGE_COMIC": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      if (!comics[msg.id]) return { ok: false };
      await patchComic(msg.id, { acknowledgedChapter: comics[msg.id].latestChapter });
      await updateBadge();
      queueGistSync();
      return { ok: true };
    }
    case "ACKNOWLEDGE_ALL": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      for (const c of Object.values(comics)) {
        if (c.latestChapter != null) c.acknowledgedChapter = c.latestChapter;
      }
      await chrome.storage.local.set({ comics });
      await updateBadge();
      queueGistSync();
      return { ok: true };
    }
    case "PULL_FROM_GIST":
      return await pullFromGist();
    case "PING":
      return { pong: true };
    case "DEBUG_INFO": {
      const { comics = {}, settings = {}, elementBindings = {} } =
        await chrome.storage.local.get(["comics", "settings", "elementBindings"]);
      const { version } = chrome.runtime.getManifest();
      return {
        ok: true,
        version,
        comicsCount: Object.keys(comics).length,
        hasGistPat: !!settings.githubPat,
        gistId: settings.gistId ?? null,
        bindingHostCount: Object.keys(elementBindings).length,
      };
    }
    default:
      return { ok: false, error: "unknown message type" };
  }
}
