# Issue #153: Lektionsordning — planerade minuter per steg (smal Min-kolumn)

Lokalt läge (Firebase-konfigurationen ersatt med platshållaren av en lokal
testserver, inget moln) med den påhittade klassen `TEST-153`. Planeringen:
Matematik, Vad/Hur/Varför, Lektionsordning med 4 steg ("Genomgång/Samling",
"Mini-whiteboards", "Mattebok s.44-45", "Avslut"), När du är klar, Du
behöver och Mål; lektionen 80 min. Ingen falsk klocka. "Före" är main
`28476fb`, serverad från samma origin (samma planering i localStorage).

Elevskärmen i 1280×720 och 1920×1080; lärarvyn i 1280×800 och 1920×1080,
mörkt och ljust tema (tavlans papper är vitt i alla teman, bara panelen
skiljer). Elevskärmen och förhandsvisningen ritas av samma kod (boardHTML).

| Bild | Vad |
|---|---|
| `1-fore-elev-{1280,1920}-utan-minuter` / `1-efter-…` | Planering utan minuter. **Byte-identiska PNG-filer** i båda storlekarna. |
| `2-elev-{1280,1920}-10-15-20-5` | 10 / 15 / 20 / 5 utan stegning. Rubriken MIN på samma rad som LEKTIONSORDNING. |
| `3-elev-{1280,1920}-steg3-timer` | Steg 3 pågår med timerbricka, steg 1–2 avklarade — minuterna dämpade utan överstrykning. Ramen och brickan ligger i stegets cell, minuten utanför. I 1280 bryts "Mattebok s.44-45" bredvid brickan (som före #153, se #146 Finding 1); minuten står på första raden. |
| `4-elev-{1280,1920}-avslut-utan-minuter` | Avslut utan minuter: tom cell, kolumnen kvar. |
| `5-elev-{1280,1920}-lang-stegtext-bryts` | Lång stegtext som bryts (pågående, med timer): minuten på stegets första rad, ramen omsluter steget. |
| `6-elev-{1280,1920}-efter-rasten-och-min` | Efter rasten ovanför både stegen och Min-kolumnen. |
| `7-larare-{morkt,ljust}-{1280,1920}-panelen` | Panelen: "Minuter per steg", summan "Planerat: 50 min av lektionens 80" och "Starta 20 min" först bland snabbknapparna. |

## Uppmätt i webbläsaren (elevskärmen)

- Fyra korta steg: `--lb-scale` 0.966 och ingen/`1.00` `--lb-steps-scale`
  med och utan minuter, både 1280 och 1920; stegens radlägen identiska.
  Bredden räcker med liten marginal i 1280 med DejaVu Sans (stegraden
  439 px, "Genomgång/Samling" behöver 438 px) — därför har Min-kolumnen fått
  fältets högerluft (0.8em → 0.2em) och rubriken MIN gör inte kolumnen
  bredare. Ett smalare typsnitt (Segoe UI) ger mer marginal.
- Lång stegtext (bild 5): `--lb-scale` samma med och utan minuter (0.863 i
  1920); bara `--lb-steps-scale` sjunker (0.93–0.96). Minutcellens överkant
  = stegradens överkant på varje rad; inget överlapp (stegraderna slutar
  10 px före kolumnen).
- Scenariot i lärarvyn: minuter skrivna i panelen, "Para ihop" infogad som
  rad 2 i textfältet → 10, tom, 15, 20, 5; Avslut tömd → tom cell; 91 → felet
  vid fältet, inget sparat; Nästa steg ×4 → "Starta 20 min" startar 20:00.
