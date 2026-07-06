// Injected into all pages.
// Handles: comic scraping, toast notifications, element pick mode, key bindings.

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

const ASURA_CHAPTER_RE = /asurascans\.com\/(manga|comics)\/([^/]+)\/chapter[/-](\d+)/i;
const ASURA_INDEX_RE = /asurascans\.com\/(manga|comics)\/([^/]+)\/?$/i;

// AsuraScans appends a rotating hex suffix to slugs (e.g. "-30e93729") that
// changes periodically, presumably to break saved links/scrapers. Strip it so
// the same comic keeps one stable storage id across the rotation.
function stableSlug(slug) {
  return slug.replace(/-[0-9a-f]{6,10}$/i, "");
}

function scrapeAsura() {
  const chapterMatch = location.href.match(ASURA_CHAPTER_RE);
  const indexMatch = location.href.match(ASURA_INDEX_RE);
  if (!chapterMatch && !indexMatch) return null;
  const match = chapterMatch || indexMatch;
  const pathType = match[1];
  const slug = match[2];
  const chapter = chapterMatch ? parseInt(chapterMatch[3], 10) : null;
  const titleEl = [
    document.querySelector(`.breadcrumb a[href*='/${pathType}/']`),
    document.querySelector(".entry-title"),
    document.querySelector("h1"),
  ].find((e) => e?.textContent?.trim());
  const rawTitle = titleEl?.textContent.trim() || document.title.replace(/\s+[-–—|·].*$/, "").trim();
  const title = rawTitle.replace(/\s+chapter\s*\d+.*/i, "").trim();
  return {
    id: `asura__${stableSlug(slug)}`, title, slug, chapter,
    url: location.href, indexUrl: `https://asurascans.com/${pathType}/${slug}/`, site: "asurascans.com",
    // Only grab cover from the index page; chapter pages may have a different og:image
    ...(!chapterMatch && { coverUrl: document.querySelector('meta[property="og:image"]')?.content ?? null }),
  };
}

function scrapeGeneric() {
  const title = document.title.replace(/\s*[|–\-].*$/, "").trim() || location.hostname;
  const id = "generic__" + (location.hostname + location.pathname).replace(/[^a-z0-9]/gi, "").slice(0, 24);
  return { id, title, chapter: null, url: location.href, indexUrl: location.href, site: location.hostname };
}

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------

const DARK_STYLE_ID = "wct-dark-style";
const DARK_CSS = `
html.wct-dark { filter: invert(1) hue-rotate(180deg); }
html.wct-dark img, html.wct-dark video, html.wct-dark canvas, html.wct-dark picture {
  filter: invert(1) hue-rotate(180deg);
}`;

function applyDark(enable) {
  if (enable && !document.getElementById(DARK_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = DARK_STYLE_ID;
    style.textContent = DARK_CSS;
    document.head.appendChild(style);
  }
  document.documentElement.classList.toggle("wct-dark", enable);
}

// Restore global dark mode on page load
chrome.storage.local.get("settings", ({ settings }) => {
  if (settings?.darkModeGlobal) applyDark(true);
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function showToast(msg) {
  const existing = document.getElementById("wct-toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "wct-toast";
  el.textContent = msg;
  Object.assign(el.style, {
    position: "fixed", bottom: "20px", right: "20px", zIndex: "2147483647",
    background: "#323232", color: "#fff", padding: "10px 16px", borderRadius: "6px",
    fontSize: "13px", fontFamily: "system-ui, sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,.4)",
    transition: "opacity 0.3s", opacity: "1",
  });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 2500);
}

// ---------------------------------------------------------------------------
// Element pick mode — DevTools-style overlay
// ---------------------------------------------------------------------------

let pickActive = false;
let hovered = null;

function enterPickMode() {
  if (pickActive) return;
  pickActive = true;
  injectPickOverlay();
  showPickBanner("🎯 Click an element to bind a key · Esc = cancel");
  document.addEventListener("mouseover", onPickHover, true);
  document.addEventListener("click", onPick, true);
  document.addEventListener("keydown", onPickEscape, true);
}

function exitPickMode() {
  pickActive = false;
  removePickOverlay();
  removePickBanner();
  hovered = null;
  document.removeEventListener("mouseover", onPickHover, true);
  document.removeEventListener("click", onPick, true);
  document.removeEventListener("keydown", onPickEscape, true);
}

function injectPickOverlay() {
  // Dark overlay covering everything — pointer-events:none so clicks reach the page
  const overlay = document.createElement("div");
  overlay.id = "wct-pick-overlay";
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", background: "rgba(0,0,0,0.55)",
    zIndex: "2147483644", pointerEvents: "none",
  });
  // Highlight box for hovered element — sits above the overlay
  const box = document.createElement("div");
  box.id = "wct-pick-box";
  Object.assign(box.style, {
    position: "fixed", zIndex: "2147483645",
    background: "rgba(26,115,232,0.2)", outline: "2px solid #1a73e8",
    pointerEvents: "none", display: "none", transition: "all 0.05s",
  });
  document.body.append(overlay, box);
}

function removePickOverlay() {
  document.getElementById("wct-pick-overlay")?.remove();
  document.getElementById("wct-pick-box")?.remove();
}

function onPickHover(e) {
  hovered = e.target;
  const box = document.getElementById("wct-pick-box");
  if (!box) return;
  const r = hovered.getBoundingClientRect();
  Object.assign(box.style, {
    display: "block",
    top: r.top + "px", left: r.left + "px",
    width: r.width + "px", height: r.height + "px",
  });
}

function onPick(e) {
  e.preventDefault();
  e.stopPropagation();
  const el = hovered || e.target;
  // Remove overlay but keep banner for key-capture phase
  removePickOverlay();
  document.removeEventListener("mouseover", onPickHover, true);
  document.removeEventListener("click", onPick, true);

  const selector = generateSelector(el);
  const label = (el.textContent.trim().slice(0, 40) || el.tagName.toLowerCase());
  showPickBanner(`"${label}" — press a key to bind it · Esc = cancel`);

  document.addEventListener("keydown", (e2) => {
    e2.preventDefault();
    e2.stopPropagation();
    if (e2.key === "Escape") { exitPickMode(); return; }
    const key = keyStr(e2);
    saveBinding(location.hostname, { key, selector, label });
    exitPickMode();
    showToast(`Bound: ${key} → "${label}"`);
  }, { once: true, capture: true });
}

function onPickEscape(e) {
  if (e.key === "Escape") { e.stopPropagation(); exitPickMode(); }
}

function generateSelector(el) {
  if (el.id) return `#${el.id}`;
  const path = [];
  let cur = el;
  for (let i = 0; i < 6 && cur && cur !== document.body; i++) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) { path.unshift(`#${cur.id}`); break; }
    const cls = [...cur.classList].filter((c) => /^[a-z]/i.test(c)).slice(0, 2).join(".");
    if (cls) seg += `.${cls}`;
    path.unshift(seg);
    cur = cur.parentElement;
    try { if (document.querySelector(path.join(" > ")) === el) break; } catch (_) {}
  }
  return path.join(" > ");
}

function keyStr(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key === " " ? "Space" : e.key);
  return parts.join("+");
}

// ---------------------------------------------------------------------------
// Pick mode banner
// ---------------------------------------------------------------------------

function showPickBanner(text) {
  let el = document.getElementById("wct-pick-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "wct-pick-banner";
    Object.assign(el.style, {
      position: "fixed", top: "0", left: "0", right: "0", zIndex: "2147483647",
      background: "#1a73e8", color: "#fff", padding: "10px 16px",
      fontSize: "13px", fontFamily: "system-ui, sans-serif",
      boxShadow: "0 2px 6px rgba(0,0,0,.3)", textAlign: "center",
    });
    document.body.appendChild(el);
  }
  el.textContent = text;
}

function removePickBanner() {
  document.getElementById("wct-pick-banner")?.remove();
}

// ---------------------------------------------------------------------------
// Binding storage (direct chrome.storage.local access)
// ---------------------------------------------------------------------------

async function saveBinding(hostname, binding) {
  const { elementBindings = {} } = await chrome.storage.local.get("elementBindings");
  const list = (elementBindings[hostname] ?? []).filter((b) => b.key !== binding.key);
  list.push(binding);
  elementBindings[hostname] = list;
  await chrome.storage.local.set({ elementBindings });
}

// ---------------------------------------------------------------------------
// Key binding listener
// ---------------------------------------------------------------------------

async function setupKeyBindings() {
  const { elementBindings = {} } = await chrome.storage.local.get("elementBindings");
  const bindings = elementBindings[location.hostname] ?? [];
  if (!bindings.length) return;
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const key = keyStr(e);
    const binding = bindings.find((b) => b.key === key);
    if (!binding) return;
    const target = document.querySelector(binding.selector);
    if (target) {
      e.preventDefault();
      target.click();
    }
  });
}

setupKeyBindings();

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCRAPE_COMIC") {
    sendResponse(scrapeAsura() ?? scrapeGeneric());
  } else if (msg.type === "SHOW_TOAST") {
    showToast(msg.msg);
    sendResponse({ ok: true });
  } else if (msg.type === "TOGGLE_DARK") {
    const isDark = !document.documentElement.classList.contains("wct-dark");
    applyDark(isDark);
    sendResponse({ darkNow: isDark });
  } else if (msg.type === "QUERY_DARK") {
    sendResponse({ darkNow: document.documentElement.classList.contains("wct-dark") });
  } else if (msg.type === "START_PICK") {
    enterPickMode();
    sendResponse({ ok: true });
  } else if (msg.type === "PING") {
    sendResponse({ pong: true });
  }
});

// Auto-track: when navigating to a chapter page, update known comics silently
async function autoTrack() {
  const scraped = scrapeAsura();
  if (!scraped || scraped.chapter == null) return;
  const { comics = {} } = await chrome.storage.local.get("comics");
  if (!comics[scraped.id]) return;
  const hist = comics[scraped.id].chapterHistory ?? [];
  const existing = hist.find((h) => h.chapter === scraped.chapter);
  if (existing) {
    if (Date.now() - new Date(existing.visitedAt).getTime() < 60_000) return;
  }
  chrome.runtime.sendMessage({ type: "AUTO_TRACK", scraped }).catch(() => {});
}

autoTrack();

// Re-run autoTrack on SPA navigation (Next.js / pushState) — content script
// only executes on full page loads, but AsuraScans uses client-side routing.
let _lastTrackedUrl = location.href;
const _navObserver = new MutationObserver(() => {
  if (location.href === _lastTrackedUrl) return;
  _lastTrackedUrl = location.href;
  autoTrack();
});
_navObserver.observe(document.body, { childList: true, subtree: true });

// Index-page update check: when user visits a tracked comic's index page,
// read the latest chapter from the already-rendered DOM (bypasses JS-rendering
// issue that affects background fetch) and store it.
(async function checkIndexForUpdates() {
  const indexMatch = location.href.match(ASURA_INDEX_RE);
  if (!indexMatch) return;
  const slug = indexMatch[2];
  const id = `asura__${stableSlug(slug)}`;
  const { comics = {} } = await chrome.storage.local.get("comics");
  if (!comics[id]) return;

  const nums = [...document.querySelectorAll(`a[href*="${slug}"]`)]
    .map((a) => { const m = a.href.match(/\/chapter[-/](\d+)/i); return m ? parseInt(m[1], 10) : null; })
    .filter((n) => n !== null);
  const latestChapter = nums.length ? Math.max(...nums) : null;
  const coverUrl = document.querySelector('meta[property="og:image"]')?.content ?? null;
  // Rebuild the index URL from the *current* slug so a rotated suffix self-heals
  // the stored bookmark the next time the user visits, instead of staying stale.
  const freshUrl = `https://asurascans.com/${indexMatch[1]}/${slug}/`;

  const chapterUnchanged = latestChapter === null || latestChapter === comics[id].latestChapter;
  const coverUnchanged = !coverUrl || coverUrl === comics[id].coverUrl;
  const urlUnchanged = freshUrl === comics[id].url;
  if (chapterUnchanged && coverUnchanged && urlUnchanged) return;

  chrome.runtime.sendMessage({ type: "UPDATE_LATEST_CHAPTER", id, latestChapter, coverUrl, url: freshUrl }).catch(() => {});
})();
