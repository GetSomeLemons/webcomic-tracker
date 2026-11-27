// Options page — GitHub PAT + Gist init, update interval, global dark mode,
// local JSON backup

document.addEventListener("DOMContentLoaded", async () => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    if (settings.githubPat) document.getElementById("pat").value = settings.githubPat;
    if (settings.gistId) showGistLink(settings.gistId);
    document.getElementById("auto-update").checked = settings.autoUpdate ?? false;
    document.getElementById("interval").value = settings.updateAlarmMinutes ?? 60;
    document.getElementById("dark-global").checked = settings.darkModeGlobal ?? false;
});

document.getElementById("btn-connect").addEventListener("click", async () => {
    const pat = document.getElementById("pat").value.trim();
    if (!pat) return setStatus("gist-status", "Enter a token first.", "err");
    setStatus("gist-status", "Connecting…", "");
    try {
        const { ok, gistId, error } = await chrome.runtime.sendMessage({ type: "GIST_INIT", pat });
        if (ok) {
            setStatus("gist-status", "Connected!", "ok");
            showGistLink(gistId);
        } else {
            setStatus("gist-status", `Error: ${error}`, "err");
        }
    } catch (e) {
        setStatus("gist-status", `Error: ${e.message}`, "err");
    }
});

document.getElementById("btn-save").addEventListener("click", async () => {
    const settings = {
        autoUpdate: document.getElementById("auto-update").checked,
        updateAlarmMinutes: parseInt(document.getElementById("interval").value, 10) || 60,
        darkModeGlobal: document.getElementById("dark-global").checked,
    };
    const { ok } = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
    setStatus("save-status", ok ? "Saved." : "Error saving.", ok ? "ok" : "err");
    setTimeout(() => setStatus("save-status", "", ""), 2000);
});

// ---------------------------------------------------------------------------
// Local backup
// ---------------------------------------------------------------------------

// A Blob and a download attribute, both available to any extension page — so the
// backup costs no permission at all, in particular not "downloads".
document.getElementById("btn-export").addEventListener("click", async () => {
    const { ok, payload, error } = await chrome.runtime.sendMessage({ type: "EXPORT_DATA" });
    if (!ok) return setStatus("backup-status", `Error: ${error}`, "err");
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `webcomic-tracker-${payload.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("backup-status", `Exported ${Object.keys(payload.comics).length} comics.`, "ok");
});

document.getElementById("btn-import").addEventListener("click", () =>
    document.getElementById("import-file").click());

document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    // Reset first: picking the same file twice in a row fires no change event
    // otherwise, which reads as "the button is broken".
    e.target.value = "";
    if (!file) return;

    let data;
    try {
        data = JSON.parse(await file.text());
    } catch (err) {
        return setStatus("backup-status", "Error: not valid JSON.", "err");
    }
    const count = Object.keys(data?.comics ?? {}).length;
    if (!count) return setStatus("backup-status", "Error: no comics in that file.", "err");
    if (!confirm(`Merge ${count} comics from ${file.name} into your library?`)) return;

    setStatus("backup-status", "Importing…", "");
    const { ok, count: total, error } = await chrome.runtime.sendMessage({ type: "IMPORT_DATA", data });
    setStatus("backup-status", ok ? `Merged. ${total} comics in your library.` : `Error: ${error}`, ok ? "ok" : "err");
});

function showGistLink(gistId) {
    const link = document.getElementById("gist-link");
    link.href = `https://gist.github.com/${gistId}`;
    link.style.display = "inline";
}

function setStatus(id, msg, cls) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = `status ${cls}`;
}
