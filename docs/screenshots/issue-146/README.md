# Issue #146: Lektionsordning i stunden — bocka av steg + timer på pågående steg

Lokalt läge (Firebase-konfigurationen ersatt med platshållaren av en lokal
testserver, inget moln) med den påhittade klassen `TEST-146`. Planeringen:
Matematik, Vad/Hur/Varför, Lektionsordning med 4 steg ("Genomgång/Samling",
"Mini-whiteboards", "Mattebok s.44-45", "Avslut"), När du är klar "S. 62-63".
Ingen falsk klocka: lektionstiden lades runt den riktiga tiden, och lägena
(timer igång, Klart) sattes med riktiga tidsstämplar. "Före" är `1b2ccf5`
(main före #146), serverad från samma origin så att planeringen är densamma.

Elevskärmen i 1280×720 och 1920×1080; lärarvyn i 1280×800 (mörkt och ljust
tema — tavlans papper är vitt i alla teman, bara panelen skiljer).

| Bild | Vad |
|---|---|
| `1-fore-elev-{1280,1920}-inget-markerat` / `1-efter-…` | Inget steg markerat. **Pixelidentiska** (råa PNG-pixlar jämförda, båda storlekarna). |
| `2-elev-…-steg3-utan-timer` | Steg 1–2 bockade, steg 3 med ram + ton, ingen timer. |
| `3-elev-…-steg3-timer`, `3-larare-{morkt,ljust}-1280-…` | Steg 3 med timern (20 min) högerställd i ramen. Sidopanelen: Pågår, +1 min, Stoppa timer. |
| `4-elev-…-klart-puls-{ljus,mork}` | Klart: brickan i ämnets färg, pulsens två lägen (opacitet 1 och 0,5 — fångade med animationen stoppad i respektive läge). |
| `5-elev-…-slojd-…` | Samma i ett ljust ämne (Slöjd): ramen i `--subj-deep` så att den syns, Klart i ämnesfärgen med mörk text. |
| `6-elev-…-lang-text-timer` | Lång stegtext + timer: texten bryts till vänster om brickan, ramen omsluter allt. |
| `7-elev-…-efter-rasten-och-steg` | Efter rasten synlig samtidigt som steg 1 pågår med timer. Ryms inte stegets längsta ord bredvid brickan flyttar brickan ned på en egen rad (högerställd, i ramen) i stället för att ordet bryts. |

## Uppmätt i webbläsaren (elevskärmen 1280×720)

- Radhöjder och radernas läge är exakt lika utan markering, med bockar och
  med ram (4 steg: `31.80` px per rad i alla lägen).
- Simulerade Segoe UI-mått (`@font-face` med `ascent-override: 108%;
  descent-override: 25%` på DejaVu Sans, som i #144), tät tavla (9 steg +
  Efter rasten): `--lb-scale` 0.79 och `--lb-steps-scale` 0.67 både utan
  markering och med 4 bockar + ram — radhöjderna identiska.
- Med timer på en lång rad: 0.78 / 0.70 (raden blir högre, tavlan anpassas
  som vanligt). Stoppa timer → tillbaka till 0.79 / 0.67.
- Timerbrickan överlappar aldrig texten och ligger inuti raden (mätt).
- Klart pulserar 1 → 0,5 → 1 på 1,8 s (uppmätt opacitet över en period).
- Scenariot: Nästa steg ×3, 20 min, +1 min efter Klart → 1:00 och räknar,
  Nästa steg → steg 3 bockat, timern borta, steg 4 markerat; elevskärmen
  följer via datalagret.
- Utgånget läge (igår): elevskärmen visar dagens tavla och skriver
  ingenting; lärarvyn nollställer de tre fälten en gång (`updatedAt`
  oförändrat efteråt).
