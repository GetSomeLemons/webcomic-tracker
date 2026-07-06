# Webcomic Tracker

A Manifest V3 browser extension for Chrome and Edge that tracks webcomics you're reading — chapters, ratings, genres, and notes — with optional sync across devices via a private GitHub Gist.

## Features

- **Track any page** — save a URL as a comic with one click or `Alt+S`
- **AsuraScans support** — auto-detects title, chapter number, and cover image
- **Chapter history** — log every chapter you read with timestamps
- **Update checks** — manually or automatically poll for new chapters
- **Ratings & genres** — rate 1–10, tag with custom genres, write a review
- **Gist sync** — backs up and syncs your list across devices via a private GitHub Gist
- **Dark mode** — CSS-filter dark mode toggle per-tab or globally
- **Key bindings** — bind keyboard keys to page elements (e.g. `→` for "Next chapter")
- **New chapter badge** — extension icon shows unread chapter count

## Installation

No build step required.

1. Download or clone this repo.
2. Open `edge://extensions` (or `chrome://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `src/` folder.
5. Pin the extension to your toolbar.

## Usage

### Saving a comic

- Navigate to a comic page and press **`Alt+S`**, or
- Open the popup and click **Track**.

On AsuraScans the title and chapter are detected automatically. On any other site the page title and URL are saved.

### Checking for updates

Click **Check for updates** in the popup footer. To check automatically, enable it in **Settings → Update Checks** and set an interval.

### Cloud sync (optional)

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens?type=beta) and create a fine-grained token with **Gists → Read and write** permission.
2. Open the popup → **⚙ Settings** → paste the token → **Connect**.
3. Repeat on other devices with the same token.

Your data is stored in a **private** Gist. The token is stored in browser local storage — use a minimal-scope token.

### Keyboard element binding

Open the popup → **⌨** → **Pick element on page**. Click any element on the page, then press the key to bind. The binding is stored per hostname.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save comics and settings locally |
| `alarms` | Scheduled update checks |
| `activeTab` | Read the current tab's URL and title |
| `scripting` | Inject scraper on pages not yet loaded |
| `tabs` | Open comic/chapter links |
| `api.github.com` | GitHub Gist sync |
| `asurascans.com` | Chapter update checks via background tab |

## Privacy

All data stays in your browser's local storage and optionally in your own private GitHub Gist. No data is sent to any third-party server.

## Architecture

```
src/
  manifest.json   — extension entry point
  background.js   — service worker: storage, sync, update checks, hotkey
  content.js      — injected into pages: scraping, toasts, dark mode, key bindings
  popup.html/js   — browser action popup UI
  popup.css       — popup styles (dark + light theme)
  options.html/js — settings page
  help.html       — user guide
  icons/          — extension icons (16, 32, 64, 128 px)
```

Communication: `popup ↔ background ↔ content script` via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`.

## License

MIT
