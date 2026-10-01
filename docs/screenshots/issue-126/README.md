# Issue #126 — Klassråd: utskrift

Lokalt läge, testklassen heter "4B" men finns bara i webbläsarens
localStorage (inget når Firestore). Påhittade elever och anteckningar.
PDF:erna är riktiga `Page.printToPDF` (Chrome 153, `preferCSSPageSize`)
från lärarvyn, sidorna renderade till PNG med pdf.js.

## PDF:er

| Fil | Vad | Sidor | PDF-titel (= filnamn) |
|---|---|---|---|
| `protokoll-langt.pdf` | Klassrådet 17 sep ur arkivet, långa anteckningar. Punkt 4 är längre än en hel sida och fortsätter med "(forts.)" | 4 | Klassråd 4B v.38 2026-09-17 |
| `tom-mall.pdf` | Tom mall (standardmallen), 5 linjer per punkt, linjer för datum, vecka, ordförande, sekreterare | 3 | Klassråd 4B tom mall |
| `protokoll-forra-klassradet.pdf` | Klassrådet 1 okt (det öppna). Under punkt 2 "Från förra klassrådet" med avbockade och ej avbockade rader | 2 | Klassråd 4B v.40 2026-10-01 |
| `ctrl-p-ljust.pdf` | Samma protokoll i ljust tema, via Ctrl+P utan panelen | 2 | Klassråd 4B v.40 2026-10-01 |

`*-sidaN.png` är sidorna. `protokoll-forra-klassradet-sida*.png` (mörkt
tema, via panelen) och `ctrl-p-ljust-sida*.png` (ljust tema, Ctrl+P) är
pixelidentiska: utskriften ser likadan ut i båda temana.

Alla sidor är 595 × 842 pt (A4). Kontrollerat i webbläsaren: inget ark
flödar över i den nedre marginalen, och ingen punkt delas utom den som är
längre än ett helt ark.

## Panelen

`panel-protokoll-{dark,light}-{1920,1280}.png`: "Skriv ut" öppen, Protokoll
(ifyllt) för 17 sep, förhandsvisningen av A4-sidorna, antal sidor och
filnamnet. `panel-mall-*.png`: samma med Tom mall vald.
