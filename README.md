# edge-extension

Manifest V3 selainlaajennus (Chrome / Edge), joka kehitetään
`viking-claude-code`-kontin sisällä. Kontissa on Claude Code, työkalut ja
organisaation skillit valmiina; tämä repo tuo lisäksi projektikohtaiset skillit
ja preferenssit.

## Avaaminen kontissa

### Tapa A — VS Code dev container (suositus)
Hoitaa mountit puolestasi, ei tarvitse miettiä polkusyntaksia.
1. Varmista VS Codessa: asetukset → **Docker Path** → `wslc`.
2. Avaa tämä kansio VS Codessa.
3. "Reopen in Container". Kun valmis, avaa terminaali ja aja `claude`.

### Tapa B — suoraan wslc:llä (PowerShell)
Projektikansiossa:
```powershell
wslc run -it --rm -v "$($PWD.Path):/workspace" ghcr.io/getsomelemons/viking-claude-code:latest claude
```
Jos mount valittaa Windows-polusta, käytä WSL-tyylistä polkua, esim.
`-v /mnt/c/Temp/edge-extension:/workspace`.

## Laajennuksen lataaminen selaimeen
1. `edge://extensions` (tai `chrome://extensions`).
2. Ota "Developer mode" käyttöön.
3. "Load unpacked" → valitse `src/`-kansio.
4. Muutosten jälkeen paina laajennuskortin reload-kuvaketta.

## Skillit ja preferenssit
- `CLAUDE.md` — projektin ohjeet ja konventiot, latautuu automaattisesti.
- `.claude/skills/` — projektikohtaiset skillit (ks. kansion README).
- `.claude/settings.json` — projektin Claude Code -asetukset.

Kun jokin projektiskill osoittautuu yleishyödylliseksi, siirrä se
`viking-claude-code`-repon `skills/`-kansioon, rebuild + push, niin se on
jatkossa joka projektissa.
