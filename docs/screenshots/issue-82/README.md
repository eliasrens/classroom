# Issue #82 — Lektionsplanering: städad verktygsrad, flikar, bredare sida, tavlan under statusraden

Headless Chrome, lokalt läge (apiKey `FYLL_I…`), påhittad klass 3A med nio
planeringar utspridda på för tre veckor sedan, förra veckan, denna vecka
(21–27 sep 2026), nästa vecka och om två veckor. "Bråk intro" (mån denna
vecka) är den som visas för eleverna.

## Vad som ändrades

- **Verktygsraden:** rad 1 är "+ Ny planering" + en ⋯-meny (Kopiera, Ta bort,
  Välj flera — samma menykomponent som toppmenyn, `js/ui/menu-button.js`,
  med tangentbord och ARIA). Rad 2 är sök + ämnesfilter som förut.
- **Flikar:** Denna vecka · Kommande · Arkiv (segmenterad kontroll) under sök
  och filter. Kommande visar närmaste vecka först; Arkiv senaste överst,
  infällt från början. Sök/filter gäller inom fliken; träffar i andra flikar
  visas som en diskret rad ("1 träff i Arkiv") som byter flik vid klick.
  "Gå dit" och val av planering i annan flik byter flik. Vald flik sparas
  per dator (`classroom:ui:lektion:planTab`).
- **Bredare sida:** lärarvyn sätter `.view--wide` (css/app.css) — samma
  sidopadding, ingen maxbredd. Andra lärarsidor behåller ramen från #61.
- **Tavlan direkt under statusraden:** topp-ankrad med `--space-3` avstånd.
  När den öppna planeringen inte är den som visas för eleverna får
  förhandsvisningen en streckad ram + etiketten "Förhandsvisning".
  Statusradens logik från #39 är oförändrad, liksom elevvyn.

## Uppmätt (1920×1080)

|  | Före | Efter |
|---|---|---|
| Avstånd statusrad → tavla | 213 px | 12 px |
| Vänsterkolumnens x-position | 273 px | 20 px |
| Tavlans bredd | 980 px | 1445 px |

fitBoard: `data-scale = 1.00`, ingen scroll (varken tavla eller sida).

## Skärmdumpar

- `fore-1920-lararvy.png` / `fore-1366-lararvy.png` — FÖRE (main): fyra
  knappar på två rader, alla veckor i en lista, smal sidram, tavlan
  lodrätt centrerad långt under statusraden
- `efter-1920-lararvy.png` / `efter-1366-lararvy.png` — EFTER: städad
  verktygsrad, flikar, full bredd, tavlan direkt under statusraden
  (öppnad planering = den som visas → ingen förhandsmarkering)
- `efter-1920-forhandsvisning.png` — annan planering öppen: streckad ram +
  etiketten "Förhandsvisning", statusraden med "Visa för eleverna" och
  "Eleverna ser: … Gå dit"
- `efter-1920-menyn.png` — ⋯-menyn öppen (Kopiera, Ta bort, Välj flera)
- `efter-1920-kommande.png` — fliken Kommande efter kopiering (fliken bytte
  automatiskt till kopians vecka)
- `efter-1920-arkiv-sok.png` — sökning "bråk" i Arkiv med träffraden
  "1 träff i Denna vecka · 1 träff i Kommande"
- `efter-1366-elevvy.png` — elevvyn (#/elev/lektion), oförändrad
