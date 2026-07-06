---
id: features-dark-mode
title: Dark Mode
category: features
tags: [dark-mode, css, content-script]
related: [architecture-extension-overview]
context_keys: [dark.js, TOGGLE_DARK, QUERY_DARK, wct-dark]
audience: [developer, ai]
level: beginner
status: draft
since: "2026-07"
---

# Dark Mode

CSS-filter-pohjainen yötila joka injektoidaan sivuille `dark.js`-content scriptillä. Toggletaan popupista tai asetetaan globaaliksi asetuksissa.

## How It Works

Injektoidaan `<style id="wct-dark-style">` ja lisätään `wct-dark`-luokka `<html>`-elementtiin:

```css
html.wct-dark { filter: invert(1) hue-rotate(180deg); }
html.wct-dark img,
html.wct-dark video,
html.wct-dark canvas,
html.wct-dark picture { filter: invert(1) hue-rotate(180deg); }
```

Kaksoisinversio (`invert(1) hue-rotate(180deg)`) muussa elementeissä palauttaa kuvat normaaliksi. `hue-rotate(180deg)` korjaa värit niin ettei pelkästä invertistä syntyvä värisiirtymä jää näkyviin.

## State

- **Global dark mode**: `settings.darkModeGlobal` (chrome.storage.local) — tarkistetaan joka sivulatauksen alussa
- **Per-tab toggle**: ephemeral — nollautuu sivun uudelleenlatauksessa tai navigoitaessa pois

## Messages

| Tyyppi | Suunta | Kuvaus |
|--------|--------|--------|
| `TOGGLE_DARK` | popup → content (tab) | Vaihda dark mode päälle/pois, vastaa `{ darkNow }` |
| `QUERY_DARK` | popup → content (tab) | Kysy nykyinen tila, vastaa `{ darkNow }` |

## Gotchas

- Toimii ~95% sivuista; taustakuvat inline `style`-attribuutissa voivat jäädä invertoiduiksi
- SPA-navigaatio (ilman sivulatausta) ei uudelleenajaa content scriptiä — dark state säilyy DOM:ssa
- `chrome://`-sivuilla content scriptit eivät toimi → popup dark toggle heittää virheen (siepattuna try/catch:issa)
- // ponytail: ei MutationObserveria dynaamisille kuville, lisää tarvittaessa
