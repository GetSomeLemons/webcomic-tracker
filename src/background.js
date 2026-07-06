// Service worker — ephemeral. All state lives in chrome.storage.local.

const GIST_DESCRIPTION = "webcomic-tracker-data";
const GIST_FILENAME = "webcomic-tracker.json";
const ALARM_NAME = "update-check";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureDefaults();
  await scheduleAlarm();
  await updateBadge();
  if (details.reason === "update" || details.reason === "install") {
    const { version } = chrome.runtime.getManifest();
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...(settings ?? {}), installedVersion: version } });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await pullFromGist();
  await scheduleAlarm();
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

async function scheduleAlarm() {
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.alarms.clear(ALARM_NAME);
  if (!settings?.autoUpdate) return;
  const minutes = settings?.updateAlarmMinutes ?? 60;
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
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
    // Content script not injected yet — use scripting API as fallback
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrapePageInline,
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
  syncToGist();
  const label = scraped.chapter != null ? `${scraped.title} Ch ${scraped.chapter}` : scraped.title;
  sendToast(tabId, `Saved: ${label}`);
  return scraped;
}

// Inline scraper injected via scripting API when content script isn't loaded.
// Must be self-contained (no closures, no external references).
function scrapePageInline() {
  const chapterMatch = location.href.match(/asurascans\.com\/(manga|comics)\/([^/]+)\/chapter[/-](\d+)/i);
  const indexMatch = location.href.match(/asurascans\.com\/(manga|comics)\/([^/]+)\/?$/i);
  const match = chapterMatch || indexMatch;
  const slug = match?.[2];
  if (!slug) {
    const title = document.title.replace(/\s*[|–\-].*$/, "").trim() || location.hostname;
    const id = "generic__" + (location.hostname + location.pathname).replace(/[^a-z0-9]/gi, "").slice(0, 24);
    return { id, title, chapter: null, url: location.href, indexUrl: location.href, site: location.hostname };
  }
  const pathType = match[1];
  const chapter = chapterMatch ? parseInt(chapterMatch[3], 10) : null;
  const titleEl = [
    document.querySelector(`.breadcrumb a[href*="/${pathType}/"]`),
    document.querySelector(".entry-title"),
    document.querySelector("h1"),
  ].find((e) => e?.textContent?.trim());
  const rawTitle = titleEl?.textContent.trim() || document.title.replace(/\s+[-–—|·].*$/, "").trim();
  const title = rawTitle.replace(/\s+chapter\s*\d+.*/i, "").trim();
  // AsuraScans rotates a trailing hex suffix on slugs (e.g. "-30e93729") — strip
  // it so the id stays stable across the rotation (see content.js stableSlug).
  const stableSlugPart = slug.replace(/-[0-9a-f]{6,10}$/i, "");
  return {
    id: `asura__${stableSlugPart}`, title, chapter,
    url: location.href, indexUrl: `https://asurascans.com/${pathType}/${slug}/`, site: "asurascans.com",
    ...(!chapterMatch && { coverUrl: document.querySelector('meta[property="og:image"]')?.content ?? null }),
  };
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

async function upsertComic(scraped) {
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
    comics[id].lastChapterUrl = scraped.url;
    comics[id].lastVisited = now;
    // Self-heal the index URL: AsuraScans' slug suffix rotates over time, so
    // any fresh visit should replace a now-stale stored URL with the current one.
    if (scraped.indexUrl) comics[id].url = scraped.indexUrl;
    // Persist user-editable fields when coming from the Save button (not from scraping)
    if (scraped.rating !== undefined) comics[id].rating = scraped.rating;
    if (scraped.review !== undefined) comics[id].review = scraped.review;
    if (scraped.genres !== undefined) comics[id].genres = scraped.genres;
    if (scraped.coverUrl !== undefined) comics[id].coverUrl = scraped.coverUrl ?? null;
  } else {
    comics[id] = {
      id,
      title: scraped.title,
      url: scraped.indexUrl,
      site: scraped.site,
      lastChapter: scraped.chapter,
      lastChapterUrl: scraped.url,
      lastVisited: now,
      chapterHistory: scraped.chapter != null ? [{ chapter: scraped.chapter, visitedAt: now }] : [],
      latestChapter: null,
      latestChecked: null,
      newChapters: null,
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
});

async function runUpdateCheck() {
  const { comics = {} } = await chrome.storage.local.get("comics");
  const toCheck = Object.values(comics).filter((c) => c.site === "asurascans.com");
  const newlyUpdated = [];

  for (const comic of toCheck) {
    const prevLatest = comic.latestChapter ?? 0;
    try {
      // Quick path: fetch + parse (works if site uses server-side rendering)
      let latestChapter = null;
      let coverUrl = null;
      try {
        const html = await fetch(comic.url).then((r) => r.text());
        const doc = new DOMParser().parseFromString(html, "text/html");
        latestChapter = extractLatestChapter(doc);
        coverUrl = doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null;
      } catch (_) {}
      // Fallback: open in a real background tab so JS renders the chapter list
      if (latestChapter === null) {
        const result = await checkComicViaTab(comic);
        latestChapter = result.latestChapter;
        coverUrl = coverUrl ?? result.coverUrl;
      }
      if (latestChapter !== null) {
        comics[comic.id].latestChapter = latestChapter;
        comics[comic.id].latestChecked = new Date().toISOString();
        comics[comic.id].newChapters = Math.max(0, latestChapter - (comic.lastChapter ?? 0));
        if (latestChapter > prevLatest) {
          newlyUpdated.push({ title: comic.title, chapter: latestChapter });
        }
      }
      if (coverUrl) comics[comic.id].coverUrl = coverUrl;
    } catch (e) {
      console.warn("Update check failed for", comic.id, e.message);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  await chrome.storage.local.set({ comics });
  await updateBadge();
}

async function updateBadge() {
  const { comics = {} } = await chrome.storage.local.get("comics");
  const unread = Object.values(comics).filter(
    (c) => c.latestChapter != null && c.latestChapter > (c.acknowledgedChapter ?? c.lastChapter ?? 0)
  ).length;
  chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : "" });
  if (unread > 0) chrome.action.setBadgeBackgroundColor({ color: "#e53935" });
}


// Opens the comic's index URL in a background tab, waits for JS to render the
// chapter list, scrapes the highest chapter number, then closes the tab.
// The tab appears briefly in the tab bar but does not steal focus.
async function checkComicViaTab(comic) {
  const slug = comic.url.match(/\/([^/]+)\/?$/)?.[1] ?? "";
  if (!slug) return { latestChapter: null, coverUrl: null };

  return new Promise((resolve) => {
    let tabId = null;
    let settled = false;

    function done(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
      resolve(result);
    }

    function onUpdated(id, info) {
      if (id !== tabId || info.status !== "complete") return;
      // Give the page time to finish loading chapter list via JS/API
      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId },
          func: (s) => {
            const nums = [...document.querySelectorAll(`a[href*="${s}"]`)]
              .map((a) => { const m = a.href.match(/\/chapter[-/](\d+)/i); return m ? parseInt(m[1], 10) : null; })
              .filter((n) => n !== null);
            const coverUrl = document.querySelector('meta[property="og:image"]')?.content ?? null;
            return { latestChapter: nums.length ? Math.max(...nums) : null, coverUrl };
          },
          args: [slug],
        })
          .then((r) => done(r?.[0]?.result ?? { latestChapter: null, coverUrl: null }))
          .catch(() => done({ latestChapter: null, coverUrl: null }));
      }, 4000);
    }

    const timer = setTimeout(() => done({ latestChapter: null, coverUrl: null }), 30_000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.create({ url: comic.url, active: false }, (tab) => { tabId = tab.id; });
  });
}

function extractLatestChapter(doc) {
  // Try Next.js SSR data blob first (present even without JS execution)
  const nextData = doc.getElementById("__NEXT_DATA__");
  if (nextData) {
    try {
      const json = JSON.parse(nextData.textContent);
      const pp = json?.props?.pageProps;
      const candidates = [pp?.chapters, pp?.data?.chapters, pp?.comic?.chapters, pp?.post?.chapters];
      for (const list of candidates) {
        if (!Array.isArray(list) || !list.length) continue;
        const nums = list
          .map((c) => c.chapter_number ?? c.number ?? c.chapter ?? parseInt(c.slug ?? "", 10) ?? 0)
          .filter((n) => n > 0);
        if (nums.length) return Math.max(...nums);
      }
    } catch (_) {}
  }

  // CSS-selector fallback for traditional WordPress manga themes
  const selectors = ["ul.clstyle li:first-child .chapternum", ".eph-num a", "a[href*='/chapter-']", "a[href*='/chapter/']"];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const href = el.href || el.getAttribute("href") || "";
    const text = el.textContent || "";
    const m = href.match(/chapter[-/](\d+)/i) || text.match(/chapter[\s\-]?(\d+)/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
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

async function syncToGist() {
  const { settings, comics = {} } = await chrome.storage.local.get(["settings", "comics"]);
  if (!settings?.githubPat || !settings?.gistId) return;
  const payload = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { darkModeGlobal: settings.darkModeGlobal, updateAlarmMinutes: settings.updateAlarmMinutes },
    comics,
  });
  try {
    const res = await fetch(`https://api.github.com/gists/${settings.gistId}`, {
      method: "PATCH",
      headers: await gistHeaders(settings.githubPat),
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content: payload } } }),
    });
    if (!res.ok) console.warn("Gist sync failed:", res.status, await res.text());
  } catch (e) {
    console.warn("Gist sync error:", e.message);
  }
}

async function pullFromGist() {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings?.githubPat || !settings?.gistId) return;
  try {
    const res = await fetch(`https://api.github.com/gists/${settings.gistId}`, {
      headers: await gistHeaders(settings.githubPat),
    });
    if (!res.ok) return;
    const gist = await res.json();
    const content = gist.files?.[GIST_FILENAME]?.content;
    if (!content) return;
    const remote = JSON.parse(content);
    const { comics: localComics = {} } = await chrome.storage.local.get("comics");
    const merged = { ...remote.comics };
    for (const [id, local] of Object.entries(localComics)) {
      if (!merged[id] || local.lastVisited > (merged[id].lastVisited ?? "")) {
        merged[id] = local;
      }
    }
    await chrome.storage.local.set({ comics: merged });
  } catch (e) {
    console.warn("Gist pull error:", e.message);
  }
}

async function gistInit(pat) {
  const headers = await gistHeaders(pat);
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
      syncToGist();
      return { ok: true };
    }
    case "REMOVE_COMIC": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      delete comics[msg.id];
      await chrome.storage.local.set({ comics });
      syncToGist();
      return { ok: true };
    }
    case "CHECK_UPDATES": {
      await runUpdateCheck();
      return { done: true };
    }
    case "GIST_INIT": {
      const { settings } = await chrome.storage.local.get("settings");
      const gistId = await gistInit(msg.pat);
      await chrome.storage.local.set({ settings: { ...settings, githubPat: msg.pat, gistId } });
      await pullFromGist();
      return { ok: true, gistId };
    }
    case "SAVE_SETTINGS": {
      const { settings } = await chrome.storage.local.get("settings");
      const next = { ...settings, ...msg.settings };
      await chrome.storage.local.set({ settings: next });
      if (msg.settings.updateAlarmMinutes !== undefined) await scheduleAlarm();
      return { ok: true };
    }
    case "AUTO_TRACK": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      if (!comics[msg.scraped.id]) return { ok: false };
      await upsertComic(msg.scraped);
      syncToGist();
      return { ok: true };
    }
    case "UPDATE_LATEST_CHAPTER": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      if (!comics[msg.id]) return { ok: false };
      if (msg.latestChapter != null) {
        comics[msg.id].latestChapter = msg.latestChapter;
        comics[msg.id].latestChecked = new Date().toISOString();
        comics[msg.id].newChapters = Math.max(0, msg.latestChapter - (comics[msg.id].lastChapter ?? 0));
      }
      if (msg.coverUrl) comics[msg.id].coverUrl = msg.coverUrl;
      if (msg.url) comics[msg.id].url = msg.url;
      await chrome.storage.local.set({ comics });
      await updateBadge();
      return { ok: true };
    }
    case "REWIND_COMIC": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      if (!comics[msg.id]) return { ok: false };
      const ch = msg.chapter ?? null;
      comics[msg.id].lastChapter = ch;
      comics[msg.id].chapterHistory = ch != null ? [{ chapter: ch, visitedAt: new Date().toISOString() }] : [];
      comics[msg.id].lastChapterUrl = null;
      await chrome.storage.local.set({ comics });
      await updateBadge();
      syncToGist();
      return { ok: true };
    }
    case "ACKNOWLEDGE_COMIC": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      if (!comics[msg.id]) return { ok: false };
      comics[msg.id].acknowledgedChapter = comics[msg.id].latestChapter;
      await chrome.storage.local.set({ comics });
      await updateBadge();
      return { ok: true };
    }
    case "ACKNOWLEDGE_ALL": {
      const { comics = {} } = await chrome.storage.local.get("comics");
      for (const c of Object.values(comics)) {
        if (c.latestChapter != null) c.acknowledgedChapter = c.latestChapter;
      }
      await chrome.storage.local.set({ comics });
      await updateBadge();
      return { ok: true };
    }
    case "PULL_FROM_GIST":
      await pullFromGist();
      return { ok: true };
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
