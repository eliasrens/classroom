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
| `3-elev-{1280,1920}-matte-nedrakning`, `3-larare-{ljust,morkt}-1280-nedrakning` | Steg 3 med timern som ifylld bricka i ämnesfärgen (rättelse från läraren: syns på projektorn), på stegtextens första rad. Sidopanelen: Pågår, +1 min, Stoppa timer. |
| `4-elev-1280-matte-klart-puls-{ljus,mork}`, `4-elev-1920-matte-klart` | Klart: hela brickan pulserar, pulsens två lägen (opacitet 1 och 0,5, fångade med animationen stoppad). |
| `5-elev-1280-slojd-nedrakning`, `5-elev-1920-slojd-klart` | Ett ljust ämne (Slöjd): brickan i ämnets färg med mörk text, ramen i `--subj-deep`. |
| `6-elev-{1280,1920}-lang-text-nedrakning` | Lång stegtext + timer: texten bryts till vänster om brickan, ramen omsluter allt, inget överlapp (mätt). |

**Känd begränsning (finding 1):** "Mattebok s.44-45" får inte plats på en
rad bredvid brickan i 1280 eller 1920. Mätt på elevskärmen 1280×720: raden
484 px; texten behöver 326 px, brickan 220 px, bubbla + två mellanrum 84 px
= 630 px. Proportionerna är desamma i 1920 (allt skalar med tavlans
bredd). Texten tar ändå all ledig plats och bryts bara för att den inte
ryms; i en bredare mittenkolumn (t.ex. utan Vad/Hur/Varför) står den på en rad.

## Uppmätt i webbläsaren (elevskärmen 1280×720)

- Radhöjder och radernas läge är exakt lika utan markering, med bockar och
  med ram (4 steg: `31.80` px per rad i alla lägen). Med timer är det
  pågående steget lika högt som andra steg med lika många textrader
  (47.61 per rad, 95.22 för två rader i elevskärmen).
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
