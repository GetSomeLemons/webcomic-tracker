---
id: architecture-extension-overview
title: Extension Architecture Overview
category: architecture
tags: [mv3, architecture, service-worker, content-script, storage]
related: [features-dark-mode, features-gist-sync]
context_keys: [manifest.json, background.js, content.js, popup.js, options.js]
audience: [developer, ai]
level: intermediate
status: draft
since: "2026-07"
---

# Extension Architecture Overview

Webcomic Tracker on Manifest V3 -selainlaajennus (Chrome/Edge). Se tallentaa webcomiceja lukulistalle pikanäppäimellä, pitää kirjaa luvuista ja arvioista, tarkistaa uusia lukuja automaattisesti ja synkkaa datan yksityiseen GitHub Gistiin.

## File Roles

| Tiedosto | Rooli |
|----------|-------|
| `manifest.json` | Permissionit, commands (Alt+S), content_scripts, host_permissions |
| `background.js` | Service worker: onCommand, alarms, Gist sync, message hub |
| `content.js` | Injektoitu sivuille: asurascans-scraper, dark mode, toast, key bindings |
| `popup.js` | Popup-UI: sarjalista, genre-suodatus, detail-paneeli |
| `options.js` | Asetussivu: GitHub PAT, sync-init, update-intervalli |

## Message Protocol

Kaikki viestit: `{ type: string, ...payload }`.

| Lähettäjä | Vastaanottaja | Tyyppi | Vastaus |
|-----------|--------------|--------|---------|
| background | content | `SCRAPE_COMIC` | `{ title, slug, chapter, url } \| null` |
| popup | background | `GET_ALL_COMICS` | `{ comics }` |
| popup | background | `UPSERT_COMIC` | `{ ok }` |
| popup | background | `REMOVE_COMIC` | `{ ok }` |
| popup | background | `CHECK_UPDATES` | `{ done }` |
| options | background | `GIST_INIT` | `{ ok, gistId, error? }` |
| options | background | `SAVE_SETTINGS` | `{ ok }` |
| popup | content (tab) | `TOGGLE_DARK` | `{ darkNow }` |

## Data Model (`chrome.storage.local`)

```js
{
  settings: {
    githubPat: "ghp_...",      // ei synkätä Gistiin
    gistId: null,
    darkModeGlobal: false,
    autoUpdate: false,         // oletuksena pois; manuaali CHECK_UPDATES toimii aina
    updateAlarmMinutes: 60
  },
  comics: {
    "asura__<slug>": {
      id, title,
      url,                     // manga index URL
      lastChapter: 187,        // käyttäjän viimeksi lukema luku
      lastChapterUrl,
      lastVisited,             // ISO timestamp
      latestChapter: 192,      // update-checkistä
      latestChecked,
      newChapters: 5,          // latestChapter - lastChapter
      rating: null,            // 1–10
      review: "",
      genres: [],
      addedAt
    }
  },
  darkTabs: { "<tabId>": true }  // puhdistetaan tabs.onRemoved-tapahtumassa
}
```

## Flow: Hotkey Save (Alt+S)

```
Alt+S
  → background.js onCommand("save-comic")
  → chrome.tabs.query(active) → sendMessage(SCRAPE_COMIC)
  → content.js scrapeAsura() → { title, slug, chapter, url }
  → background.js upsertComic() → chrome.storage.local
  → syncToGist()
```

## Flow: Update Check

```
chrome.alarms "update-check" (60 min, vain jos settings.autoUpdate === true)
  → background.js runUpdateCheck()
  → fetch(asura manga index) per asura-comic
  → DOMParser → latestChapter
  → comic.newChapters = latestChapter - lastChapter
  → chrome.storage.local

Manuaali: popup "Check for updates" → CHECK_UPDATES (toimii aina)
```

## Gotchas

- Service worker on ephemeraalinen — ei module-level staatea, kaikki async-operaatiot itsensä sisältäviä
- `content_scripts` `<all_urls>` ei vaadi broad host_permissionia (vain injection, ei fetchiä)
- PAT tallennetaan plaintextinä `chrome.storage.local`:ssa — suositus: fine-grained Gist-scoped PAT
- AsuraScans-DOM-selektorit voivat muuttua — käytetään selector-arrayta, ensimmäinen toimiva voittaa
