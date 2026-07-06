---
id: features-gist-sync
title: GitHub Gist Sync
category: features
tags: [sync, github, gist, cloud]
related: [architecture-extension-overview]
context_keys: [background.js, syncToGist, pullFromGist, gistInit, GIST_INIT, GIST_FILENAME]
audience: [developer, ai]
level: intermediate
status: draft
since: "2026-07"
---

# GitHub Gist Sync

Kaikki webcomic-data synkronoidaan yksityiseen GitHub Gistiin jotta se on saatavilla eri laitteilta ja selainprofiileilta. Synkkaukseen tarvitaan Personal Access Token.

## Setup (käyttäjän näkökulmasta)

1. Luo GitHub PAT: Settings → Developer settings → Tokens → Fine-grained token, scope: **Gists (read+write)**
2. Options-sivulla: liitä PAT → "Connect" → Gist luodaan tai löydetään automaattisesti

## Gist Payload

Gistissä on yksi tiedosto `webcomic-tracker.json`:

```json
{
  "version": 1,
  "exportedAt": "2026-07-01T12:00:00.000Z",
  "settings": {
    "darkModeGlobal": false,
    "updateAlarmMinutes": 60
  },
  "comics": {
    "asura__solo-leveling": { ... }
  }
}
```

`githubPat` ja `gistId` **eivät** sisälly payloadiin — ne ovat synkkauksen tunnistetietoja itse.

## Functions (background.js)

| Funktio | Milloin kutsutaan | Kuvaus |
|---------|------------------|--------|
| `gistInit(pat)` | options: GIST_INIT | Etsii olemassaolevan Gistin tai luo uuden, palauttaa gistId |
| `syncToGist()` | jokaisen UPSERT/REMOVE jälkeen | PATCH → ylikirjoittaa Gistin paikallisella datalla |
| `pullFromGist()` | chrome.runtime.onStartup | GET → merge remote data paikalliseen |

## Merge Strategy

`pullFromGist()` käyttää timestamp-pohjaista yhdistämistä:
- Remote voittaa (uudet sarjat otetaan mukaan)
- Lokaali voittaa jos `lastVisited` on uudempi kuin remote (käyttäjä on lukenut tällä laitteella)

## Gotchas

- PAT tallennetaan salaamattomana `chrome.storage.local`:ssa — suositellaan fine-grained PAT pelkästään Gist-scopella
- Gist-koko rajoittuu ~1 MB:iin (n. 1000 sarjaa); ylitys näkyy 422-virheenä consolessa
- Kaikki sync-operaatiot ovat fire-and-forget: virheet lokitetaan consoleen, eivät näy käyttäjälle (v1)
- Gist-haku hakee max 100 Gistia (`?per_page=100`) — jos käyttäjällä on yli 100 Gistia, voi ohittaa trackerin
