# Webcomic Tracker

A Manifest V3 browser extension for Chrome and Edge. Tracks webcomics you're reading: chapters, ratings, genres, and notes. Optionally syncs across devices via a private GitHub Gist.

## Features

- **Track any page**: save a URL with one click or `Alt+S`
- **AsuraScans support**: auto-detects title, chapter number, and cover image
- **Chapter history**: logs every chapter you read with timestamps
- **Update checks**: poll for new chapters manually or on a schedule
- **Ratings and genres**: rate 1-10, tag with custom genres, write a review
- **Gist sync**: backs up your list to a private GitHub Gist, syncs across devices
- **Dark mode**: CSS-filter toggle per tab or globally
- **Key bindings**: bind keyboard keys to page elements (e.g. `]` for "Next chapter")
- **Badge**: extension icon shows unread chapter count

## Installation

No build step.

1. Download or clone this repo.
2. Open `edge://extensions` (or `chrome://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `src/` folder.
5. Pin the extension to your toolbar.

## Usage

### Saving a comic

Press `Alt+S` on any comic page, or open the popup and click **Track**.

On AsuraScans the title and chapter are detected automatically. On other sites the page title and URL are saved.

### Checking for updates

Click **Check for updates** in the popup footer. For automatic checks, go to **Settings → Update Checks** and set an interval.

### Cloud sync (optional)

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens?type=beta) and create a fine-grained token with **Gists: Read and write** permission.
2. Open the popup → **⚙ Settings** → paste the token → **Connect**.
3. Repeat on other devices with the same token.

Data goes to a **private** Gist you own. The token stays in browser local storage; use a minimal-scope token.

### Keyboard element binding

Open the popup → **⌨** → **Pick element on page**. Click the element you want, then press the key to bind. Bindings are stored per hostname.

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

Data stays in your browser's local storage and optionally in a private GitHub Gist you own. Nothing goes to a third-party server.

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
