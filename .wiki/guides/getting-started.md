---
id: guides-getting-started
title: Getting Started
category: guides
tags: [setup, extension, chrome, edge]
related: [architecture-extension-overview]
context_keys: [manifest.json, src/]
audience: [developer, ai]
level: beginner
status: draft
since: "2026-07"
---

# Getting Started

## Vaatimukset

- Chrome tai Edge (selain Developer mode päällä)
- Kehitys tapahtuu `viking-claude-code`-kontin sisällä (VS Code dev container)

## Laajennuksen lataaminen

Ei build-askelta. Extensio ladataan suoraan `src/`-kansiosta.

1. Avaa `edge://extensions` (tai `chrome://extensions`)
2. Ota "Developer mode" käyttöön
3. "Load unpacked" → valitse `/workspace/src/`
4. Muutosten jälkeen paina laajennuskortin reload-kuvaketta

## GitHub Gist -synkronointi (valinnainen)

1. Luo GitHub Personal Access Token, scopes: `gist`
2. Avaa extensio → hammasratas (⚙) → asetukset
3. Liitä PAT → "Yhdistä" → Gist-URL ilmestyy onnistuessa

## Kehitysympäristö (kontti)

VS Code dev container käynnistyy automaattisesti kun avaat kansion VS Codessa ja valitset "Reopen in Container".

Ilman dev containeria (PowerShell):
```powershell
wslc run -it --rm -v "$($PWD.Path):/workspace" ghcr.io/getsomelemons/viking-claude-code:latest claude
```
