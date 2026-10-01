# Issue #118 — skärmdumpar

Lokalt läge (firebase-config ersatt med platshållaren vid servering, inte i
repot), påhittad testklass `TEST-118`, planering "Läsförståelse" i dag.
Egen headless Chromium med `--use-fake-device-for-media-stream` och
`--use-file-for-fake-audio-capture` (en ton med fast styrka per zon:
nivå ≈ 0,28 / 0,52 / 0,79 på mätarens skala). Gränsen är 60 % i alla.
Elevskärmen i ett eget fönster, 1920 × 1080; lärarfönstret 1440 × 900.

## Ljudnivåskylten

- `skylt-bricka-alla-nivaer.png` — brickan i lektionens rubrikrad på
  elevskärmen, nivå 0–4: färgprick, siffra och namn.
- `skylt-stor-alla-nivaer.png` — stort på Morgonskärmen (L), nivå 0–4: rund
  färgskylt med en egen SVG-symbol per nivå (Tyst = "sch"-finger, Viska =
  prickad våg, sedan en, två och tre ljudvågor).
- `lektion-elev-skylt-2-prata-lagt.png`, `morgon-elev-skylt-0-tyst.jpeg` —
  hela elevskärmen.

## Ljudmätaren

- `matare-bricka-gron-gul-rod.png` — brickan bredvid skylten, grön, gul och
  röd. Raden är trång, så mätaren är här en liten stående stapel och
  skylten visar "● 2" (namnet "Prata lågt" ryms inte bredvid mätaren).
  Röd = över gränsen i mer än 3 s: brickan blir lugnt röd.
- `matare-stor-gron-gul-rod.png` — halvcirkelmätaren på Morgonskärmen,
  grön, gul och röd (rött glas efter 3 s över gränsen). Inget ljud.
- `lektion-elev-matare-rod.png`, `lektion-larare-matare-rod.png`,
  `morgon-elev-matare-rod.jpeg`, `morgon-larare-matare-rod.jpeg` — hela
  fönstren. Mikrofonen körs bara i lärarfönstret; elevskärmen får talet via
  sync-bussen. Vid byte Lektion → Morgon stängdes mikrofonen (status "off")
  och startades om med Starta.
- `morgon-elev-skylt-och-matare-gul.jpeg`, `lektion-elev-skylt-och-matare-gul.png`
  — skylt och mätare tillsammans.

## Mikrofonen nekad

Chromium utan `--use-fake-ui-for-media-stream` och med mikrofonen nekad för
sidan (`Browser.setPermission`).

- `lektion-larare-mikrofon-nekad.png` — inställningarna: "Mikrofonen är
  blockerad för den här sidan. Tillåt mikrofonen i webbläsaren (ikonen i
  adressfältet) och tryck Starta igen." + dataskyddstexten. Brickan säger
  "Nekad".
- `morgon-larare-mikrofon-nekad.jpeg` — kort text ovanpå halvcirkeln (tar
  ingen plats, så widgeten skymmer inte kortet).
- `lektion-elev-mikrofon-nekad-visar-inget.png` — elevskärmen visar bara
  skylten, ingen mätare.

## Lärarens kontroller och storlek S

- `lektion-larare-brickor-knappar.png` — i lärarens förhandsvisning:
  ‹ 1 › på skylten och Stoppa på mätaren, som lager vid hover/fokus (tar
  ingen bredd; finns aldrig på elevskärmen).
- `morgon-larare-storlek-s-av.jpeg`, `morgon-elev-storlek-s.jpeg` — skylt och
  mätare i storlek S; 0–4-knapparna och Starta har en minsta läsbar storlek.
