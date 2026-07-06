// Popup UI — list, genre filter, detail/edit panel, dark toggle, key bindings

let allComics = {};
let currentId = null;
let activeTab = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await applyTheme();
  await loadComics();
  bindEvents();
  updateLastChecked();
  checkTabRestriction();
  await checkSyncStatus();
  await showVersion();
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

async function applyTheme() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const theme = settings.popupTheme ?? "dark";
  if (theme === "light") document.body.setAttribute("data-theme", "light");
  document.getElementById("btn-theme").textContent = theme === "light" ? "🌙" : "☀";
}

async function toggleTheme() {
  const current = document.body.getAttribute("data-theme") === "light" ? "light" : "dark";
  const next = current === "light" ? "dark" : "light";
  if (next === "dark") {
    document.body.removeAttribute("data-theme");
  } else {
    document.body.setAttribute("data-theme", "light");
  }
  document.getElementById("btn-theme").textContent = next === "light" ? "🌙" : "☀";
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...settings, popupTheme: next } });
}

// ---------------------------------------------------------------------------
// Debug panel
// ---------------------------------------------------------------------------

function toggleDebugPanel() {
  const panel = document.getElementById("debug-panel");
  const wasVisible = panel.classList.toggle("visible");
  if (wasVisible) populateDebug();
}

async function populateDebug() {
  const row = (id, text, cls = "") => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `debug-val ${cls}`.trim();
  };

  const url = activeTab?.url ?? "";
  const isWeb = url.startsWith("http");
  row("dbg-tab", url || "(no tab)", isWeb ? "debug-ok" : "debug-err");

  // Background service worker
  try {
    const pong = await chrome.runtime.sendMessage({ type: "PING" });
    row("dbg-bg", pong?.pong ? "✓ running" : "✗ bad response", pong?.pong ? "debug-ok" : "debug-err");
  } catch (e) {
    row("dbg-bg", `✗ ${e.message}`, "debug-err");
  }

  // Content script
  if (isWeb && activeTab?.id) {
    try {
      const pong = await chrome.tabs.sendMessage(activeTab.id, { type: "PING" });
      row("dbg-cs", pong?.pong ? "✓ injected" : "✗ no pong", pong?.pong ? "debug-ok" : "debug-err");
    } catch (_) {
      row("dbg-cs", "✗ not injected — reload the page", "debug-err");
    }
  } else {
    row("dbg-cs", "n/a — not a web page", "debug-err");
  }

  // Keyboard shortcut
  const commands = await chrome.commands.getAll();
  const cmd = commands.find((c) => c.name === "save-comic");
  const shortcut = cmd?.shortcut ?? "";
  row("dbg-shortcut", shortcut ? `✓ ${shortcut}` : "✗ not set — click 'Fix shortcut ↗'", shortcut ? "debug-ok" : "debug-err");

  // Storage summary + sync
  try {
    const info = await chrome.runtime.sendMessage({ type: "DEBUG_INFO" });
    row("dbg-comics", `${info.comicsCount}`);
    row("dbg-sync",
      info.hasGistPat
        ? `✓ PAT set${info.gistId ? `, gist: ${info.gistId.slice(0, 8)}…` : ", no gist yet"}`
        : "✗ no PAT — set up in Settings",
      info.hasGistPat ? "debug-ok" : "debug-err"
    );
  } catch (e) {
    row("dbg-comics", `error: ${e.message}`, "debug-err");
    row("dbg-sync", "–");
  }
}

function checkTabRestriction() {
  const url = activeTab?.url ?? "";
  if (!url.startsWith("http")) {
    document.getElementById("notice-restricted").style.display = "";
    const btn = document.getElementById("btn-track");
    btn.disabled = true;
    btn.title = "Open a web page first";
  }
}

async function checkSyncStatus() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  if (!settings.githubPat) {
    document.getElementById("notice-sync").style.display = "";
  }
}

async function showVersion() {
  const { version } = chrome.runtime.getManifest();
  const { lastSeenVersion } = await chrome.storage.local.get("lastSeenVersion");
  const badge = document.getElementById("version-badge");
  if (!lastSeenVersion || lastSeenVersion !== version) {
    badge.textContent = lastSeenVersion ? `v${version} ✦ updated` : `v${version}`;
    badge.className = "version-badge updated";
    await chrome.storage.local.set({ lastSeenVersion: version });
  } else {
    badge.textContent = `v${version}`;
    badge.className = "version-badge";
  }
}

async function loadComics() {
  const { comics } = await chrome.runtime.sendMessage({ type: "GET_ALL_COMICS" });
  allComics = comics ?? {};
  renderList();
  renderGenreFilter();
  updateGenreDatalist();
  renderUpdatesNotice();
}

function renderUpdatesNotice() {
  const unread = Object.values(allComics).filter(
    (c) => c.latestChapter != null && c.latestChapter > (c.acknowledgedChapter ?? c.lastChapter ?? 0)
  );
  const section = document.getElementById("notice-updates");
  const list = document.getElementById("updates-list");
  if (!unread.length) { section.style.display = "none"; return; }

  section.style.display = "";
  list.innerHTML = unread.map((c) => `
    <div class="update-row">
      <span class="update-title">${esc(c.title)}</span>
      <span class="update-chapter">→ Ch ${c.latestChapter}</span>
      <button class="btn-ack" data-id="${c.id}">OK</button>
    </div>`).join("");

  list.querySelectorAll(".btn-ack").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "ACKNOWLEDGE_COMIC", id: btn.dataset.id });
      await loadComics();
    });
  });
}

// ---------------------------------------------------------------------------
// List rendering
// ---------------------------------------------------------------------------

function renderList() {
  const search = document.getElementById("search").value.toLowerCase();
  const genre = document.getElementById("genre-filter").value;
  const list = document.getElementById("comic-list");

  let comics = Object.values(allComics);
  if (search) comics = comics.filter((c) => c.title.toLowerCase().includes(search));
  if (genre) comics = comics.filter((c) => c.genres?.includes(genre));
  comics.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));

  if (!comics.length) {
    list.innerHTML = `<div class="empty">${search || genre ? "No matches." : "No comics saved yet.<br>Press Alt+S or Track on a comic page."}</div>`;
    return;
  }

  list.innerHTML = comics.map((c) => {
    const rating = c.rating ? `★${c.rating}` : "★";
    const lastCh = c.lastChapter != null ? `Ch ${c.lastChapter}` : "";
    const newChBadge = c.latestChapter != null && c.latestChapter > (c.lastChapter ?? 0)
      ? ` <span class="badge-new">&#8594; ${c.latestChapter}</span>` : "";
    const age = c.lastVisited ? timeAgo(c.lastVisited) : "";
    const thumb = c.coverUrl ? `<img class="comic-thumb" src="${esc(c.coverUrl)}" alt="">` : "";
    return `
      <div class="comic-row" data-id="${c.id}">
        ${thumb}
        <div class="comic-row-body">
          <div class="comic-row-top">
            <span class="comic-title">${esc(c.title)}</span>
            <span class="comic-meta">${rating}&nbsp;${lastCh}${newChBadge}</span>
          </div>
          <div class="comic-row-sub">${esc(c.site ?? "")}${age ? ` · ${age}` : ""}</div>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".comic-row").forEach((el) => {
    el.addEventListener("click", () => showDetail(el.dataset.id));
  });
}

function renderGenreFilter() {
  const sel = document.getElementById("genre-filter");
  const current = sel.value;
  const genres = [...new Set(Object.values(allComics).flatMap((c) => c.genres ?? []))].sort();
  sel.innerHTML = `<option value="">All genres</option>` +
    genres.map((g) => `<option value="${esc(g)}"${g === current ? " selected" : ""}>${esc(toTitleCase(g))}</option>`).join("");
}

function updateGenreDatalist() {
  const dl = document.getElementById("genre-datalist");
  if (!dl) return;
  const genres = [...new Set(Object.values(allComics).flatMap((c) => c.genres ?? []))].sort();
  dl.innerHTML = genres.map((g) => `<option value="${esc(toTitleCase(g))}"></option>`).join("");
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function showDetail(id) {
  currentId = id;
  const c = allComics[id];
  document.getElementById("view-list").style.display = "none";
  document.getElementById("view-detail").classList.add("visible");
  const titleEl = document.getElementById("detail-title");
  titleEl.textContent = c.title;
  titleEl.onclick = () => chrome.tabs.create({ url: c.url });
  document.getElementById("detail-site").textContent = `${c.site ?? ""} · Added ${formatDate(c.addedAt)}`;
  const coverEl = document.getElementById("detail-cover");
  if (c.coverUrl) { coverEl.src = c.coverUrl; coverEl.style.display = ""; }
  else coverEl.style.display = "none";
  renderRating(c.rating);
  renderGenreTags(c.genres ?? []);
  document.getElementById("review-text").value = c.review ?? "";
  renderChapterHistory(c);
}

function renderChapterHistory(c) {
  const hist = (c.chapterHistory?.length > 0
    ? c.chapterHistory
    : (c.lastChapter != null ? [{ chapter: c.lastChapter, visitedAt: c.lastVisited }] : [])
  ).slice().reverse();

  const histEl = document.getElementById("chapter-history");
  if (hist.length) {
    histEl.innerHTML = `<div class="chapter-grid">` +
      hist.map((h, i) => {
        const url = i === 0 && c.lastChapterUrl ? c.lastChapterUrl : null;
        return `<div class="chapter-grid-cell${url ? " chapter-grid-cell--link" : ""}"${url ? ` data-url="${esc(url)}"` : ""}>Ch&nbsp;${h.chapter}<span class="chapter-date">${formatDateMD(h.visitedAt)}</span></div>`;
      }).join("") +
      `</div>`;
    histEl.querySelectorAll(".chapter-grid-cell--link").forEach((el) => {
      el.addEventListener("click", () => chrome.tabs.create({ url: el.dataset.url }));
    });
  } else {
    histEl.innerHTML = `<div style="font-size:11px;color:var(--text-muted)">No chapters saved yet</div>`;
  }

  const latestRow = document.getElementById("latest-chapter-row");
  const latestSpan = document.getElementById("chapter-latest");
  const btnOpen = document.getElementById("btn-open-latest");

  if (c.latestChapter) {
    latestRow.style.display = "";
    const isNew = c.lastChapter != null && c.latestChapter > c.lastChapter;
    latestSpan.textContent = `Ch ${c.latestChapter}${isNew ? "" : " ✓"}`;
    if (isNew) {
      btnOpen.style.display = "";
      btnOpen.onclick = () => {
        const m = c.lastChapterUrl?.match(/\/chapter([/-])\d+/);
        const sep = m?.[1] ?? "/";
        const base = c.lastChapterUrl?.replace(/\/chapter[/-]\d+.*$/, "") ?? c.url.replace(/\/$/, "");
        chrome.tabs.create({ url: `${base}/chapter${sep}${c.latestChapter}/` });
      };
    } else {
      btnOpen.style.display = "none";
    }
  } else {
    latestRow.style.display = "none";
  }
}

function hideDetail() {
  currentId = null;
  document.getElementById("view-detail").classList.remove("visible");
  document.getElementById("view-list").style.display = "";
}

function renderRating(current) {
  const row = document.getElementById("rating-row");
  row.innerHTML = Array.from({ length: 10 }, (_, i) => {
    const v = i + 1;
    return `<button class="rating-btn${current === v ? " active" : ""}" data-v="${v}">${v}</button>`;
  }).join("");
  row.querySelectorAll(".rating-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = parseInt(btn.dataset.v, 10);
      allComics[currentId].rating = allComics[currentId].rating === v ? null : v;
      renderRating(allComics[currentId].rating);
    });
  });
}

function renderGenreTags(genres) {
  const row = document.getElementById("genre-tags");
  row.innerHTML = genres.map((g) =>
    `<span class="genre-tag">${esc(toTitleCase(g))}<button class="genre-remove" data-g="${esc(g)}">×</button></span>`
  ).join("");
  row.querySelectorAll(".genre-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      allComics[currentId].genres = allComics[currentId].genres.filter((g) => g !== btn.dataset.g);
      renderGenreTags(allComics[currentId].genres);
    });
  });
}

function addGenre() {
  const input = document.getElementById("genre-input");
  const val = toTitleCase(input.value.trim());
  if (!val || allComics[currentId].genres?.some((g) => toTitleCase(g) === val)) { input.value = ""; return; }
  allComics[currentId].genres = [...(allComics[currentId].genres ?? []), val];
  renderGenreTags(allComics[currentId].genres);
  updateGenreDatalist();
  input.value = "";
}

// ---------------------------------------------------------------------------
// Key bindings view
// ---------------------------------------------------------------------------

async function showBindingsView() {
  const hostname = activeTab ? new URL(activeTab.url).hostname : "";
  document.getElementById("bindings-host").textContent = hostname || "this site";
  document.getElementById("view-list").style.display = "none";
  document.getElementById("view-bindings").style.display = "";
  await renderBindingsList(hostname);
}

function hideBindingsView() {
  document.getElementById("view-bindings").style.display = "none";
  document.getElementById("view-list").style.display = "";
}

async function renderBindingsList(hostname) {
  const { elementBindings = {} } = await chrome.storage.local.get("elementBindings");
  const bindings = elementBindings[hostname] ?? [];
  const list = document.getElementById("bindings-list");
  if (!bindings.length) {
    list.innerHTML = `<div class="bindings-empty">No key bindings for ${esc(hostname)}.<br>Click "Pick element" to add one.</div>`;
    return;
  }
  list.innerHTML = bindings.map((b, i) =>
    `<div class="binding-row" data-index="${i}">
      <span class="binding-key">${esc(b.key)}</span>
      <span class="binding-label" title="${esc(b.selector)}">${esc(b.label)}</span>
      <button class="binding-del" data-hostname="${esc(hostname)}" data-key="${esc(b.key)}" title="Remove">×</button>
    </div>`
  ).join("");
  list.querySelectorAll(".binding-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteBinding(btn.dataset.hostname, btn.dataset.key);
      await renderBindingsList(hostname);
    });
  });
}

async function deleteBinding(hostname, key) {
  const { elementBindings = {} } = await chrome.storage.local.get("elementBindings");
  if (elementBindings[hostname]) {
    elementBindings[hostname] = elementBindings[hostname].filter((b) => b.key !== key);
  }
  await chrome.storage.local.set({ elementBindings });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function bindEvents() {
  document.getElementById("btn-theme").addEventListener("click", toggleTheme);
  document.getElementById("btn-debug").addEventListener("click", toggleDebugPanel);
  document.getElementById("btn-back").addEventListener("click", hideDetail);
  document.getElementById("btn-bindings-back").addEventListener("click", hideBindingsView);
  document.getElementById("btn-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  document.getElementById("btn-track").addEventListener("click", async () => {
    const btn = document.getElementById("btn-track");
    btn.textContent = "…";
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: "SAVE_CURRENT" });
      if (res?.ok) {
        btn.textContent = "✓";
        await loadComics();
      } else {
        btn.textContent = "✗";
      }
    } catch (e) {
      btn.textContent = "✗";
    }
    setTimeout(() => { btn.textContent = "Track"; btn.disabled = false; }, 1500);
  });

  document.getElementById("btn-setup-sync").addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.getElementById("btn-rewind").addEventListener("click", async () => {
    const val = document.getElementById("rewind-input").value.trim();
    const ch = val === "" ? null : parseInt(val, 10);
    if (val !== "" && (isNaN(ch) || ch < 0)) return;
    if (!confirm(`Reset "${allComics[currentId].title}" to Ch ${ch ?? "start"}? This clears all chapter history.`)) return;
    await chrome.runtime.sendMessage({ type: "REWIND_COMIC", id: currentId, chapter: ch });
    document.getElementById("rewind-input").value = "";
    await loadComics();
    showDetail(currentId);
  });

  document.getElementById("btn-ack-all").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "ACKNOWLEDGE_ALL" });
    await loadComics();
  });

  document.getElementById("btn-dark").addEventListener("click", async () => {
    if (!activeTab?.id) return;
    try { await chrome.tabs.sendMessage(activeTab.id, { type: "TOGGLE_DARK" }); } catch (_) {}
  });

  document.getElementById("btn-bindings").addEventListener("click", showBindingsView);

  document.getElementById("btn-pick").addEventListener("click", async () => {
    if (!activeTab?.id) return;
    try { await chrome.tabs.sendMessage(activeTab.id, { type: "START_PICK" }); } catch (_) {}
    window.close();
  });

  document.getElementById("search").addEventListener("input", renderList);
  document.getElementById("genre-filter").addEventListener("change", renderList);

  document.getElementById("btn-check").addEventListener("click", async () => {
    const btn = document.getElementById("btn-check");
    btn.textContent = "Checking…";
    await chrome.runtime.sendMessage({ type: "CHECK_UPDATES" });
    await loadComics();
    updateLastChecked();
    btn.textContent = "Check for updates";
  });

  document.getElementById("btn-save").addEventListener("click", async () => {
    const c = allComics[currentId];
    c.review = document.getElementById("review-text").value;
    await chrome.runtime.sendMessage({ type: "UPSERT_COMIC", comic: c });
    await loadComics();
    hideDetail();
  });

  document.getElementById("btn-remove").addEventListener("click", async () => {
    if (!confirm(`Remove "${allComics[currentId].title}"?`)) return;
    await chrome.runtime.sendMessage({ type: "REMOVE_COMIC", id: currentId });
    await loadComics();
    hideDetail();
  });

  document.getElementById("btn-add-genre").addEventListener("click", addGenre);
  document.getElementById("genre-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addGenre();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateLastChecked() {
  const latest = Object.values(allComics).reduce((m, c) =>
    (!c.latestChecked ? m : !m ? c.latestChecked : c.latestChecked > m ? c.latestChecked : m), null);
  document.getElementById("last-checked").textContent = latest ? `Last: ${timeAgo(latest)}` : "";
}

function timeAgo(iso) {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatDate(iso) {
  if (!iso) return "?";
  return new Date(iso).toLocaleDateString();
}

function formatDateMD(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function toTitleCase(str) {
  return String(str ?? "").replace(/\b\w/g, (c) => c.toUpperCase());
}

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
