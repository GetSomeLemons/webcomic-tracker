// Options page — GitHub PAT + Gist init, update interval, global dark mode

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
