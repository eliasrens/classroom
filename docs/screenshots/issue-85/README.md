# Issue #85 — Delämnen i SO/NO-färg + morgonpanelens veckodagsväljare

Headless Chrome, lokalt läge (apiKey `FYLL_I…`), påhittad klass 3A med åtta
elever.

## 1. Delämnenas färger

`re`, `hi`, `ge`, `sh` har nu exakt samma färg som `so`, och `bi`, `ke`, `fy`
samma som `no`. I `js/lib/color.js` hämtar delämnena färgen ur `SO_COLOR` /
`NO_COLOR`, och i `css/tokens.css` refererar `--subject-hi` m.fl. till
`var(--subject-so)` / `var(--subject-no)`. Därmed är `--subj-deep` och
textfärgen också desamma. `docs/test-subjects.mjs` kontrollerar färg, textfärg,
`--subj-deep` och CSS-referensen.

Uppmätt i appen: `--subject-re/hi/ge/sh = #e2bc3f` (som SO) och
`--subject-bi/ke/fy = #2f6b4f` (som NO). Planeringslistans prickar och tavlans
rubrikband för Historia och Biologi har samma färg som SO respektive NO.

- `efter-1920-lektion-historia.png`: Historia-planering, gul som SO
- `efter-1920-lektion-biologi.png`: Biologi-planering, mörkgrön som NO

| Ämne | Färg | Textfärg | Kvot | Etikett (--subj-deep) | Kvot mot vitt |
|---|---|---|---|---|---|
| SO, Religionskunskap, Historia, Geografi, Samhällskunskap | #e2bc3f | #1f2430 | 8.50 | #887126 | 4.73 |
| NO, Biologi, Kemi, Fysik (och Teknik) | #2f6b4f | #ffffff | 6.29 | #2f6b4f | 6.29 |

## 2. Morgonskärmens lärarpanel: veckodagsväljaren

**Orsak:** `.morgon__tasklist` var ett grid med auto-kolumn. Uppgiftsetiketten
har `white-space: nowrap`, så en enda lång uppgift ("Läs i läseboken och skriv
…") gjorde kolumnen, och därmed alla rader, bredare än panelen. Startens
veckodagsväljare hamnade då utanför panelens kant (`fore-1280-panel.png`).

**Åtgärd** (`js/modes/morgon.js`, `css/modes/morgon.css`):

- **Veckodagen väljs med dag-chips** (Mån · Tis · Ons · Tor · Fre) på en egen
  rad under "Starten", i stället för en select. Det är ett klick per byte,
  alla dagar syns, och vald dag är markerad med accentfärgen. De fem chipsen
  delar radens bredd lika, så de får alltid plats. Tekniskt är det en
  radiogroup med riktiga radioknappar (piltangenter och skärmläsare fungerar,
  aria-label "Måndag" …). Jag valde detta framför en smalare select eller
  en bredare panel eftersom det är enklast för läraren och inte kräver
  någon breddning.
- **Uppgiftslistan följer panelens bredd:** listan, elevlistan under Bra
  jobbat och panelens scrollbehållare har kolumnen `minmax(0, 1fr)`. Långa
  uppgiftsnamn kortas med ellips och visar hela texten som tooltip. Pennorna
  och plusknapparna krymper aldrig, och inmatningsfälten har
  `min-width: 0`. `overflow-x: hidden` är ett skyddsnät.
- Panelens bredd och de fällbara sektionerna är oförändrade.

Uppmätt med alla fyra sektioner utfällda, en lång egen uppgift och en lång
fritext i Bra jobbat. "Utanför" är antalet element vars högerkant ligger
utanför `clientWidth`:

| Viewport | scrollWidth | clientWidth | Utanför | Dag-chips (x) |
|---|---|---|---|---|
| 1920×1080 | 336 | 336 | 0 | 24–312 |
| 1366×768 | 314 | 314 | 0 | 24–290 |
| 1280×720 | 314 | 314 | 0 | 24–290 |
| Före, 1280×720 | 314* | 314 | 15+ | select högerkant 522 |

\* Före klipptes raderna i stället för att ge scroll, så `scrollWidth` visade
inte felet. Med rotstorlek 20 px låg fortfarande 0 element utanför, och
ingen chip-text trunkerades.

Klick på "Fre" gav "Starten – Fredag" på elevskärmen (`#/elev/morgon`).
Klick på "Mån" gav sedan "Starten – Måndag"
(`efter-elevskarm-starten-fredag.png`, `efter-elevskarm-starten-mandag.png`).

- `fore-1280-panel.png`: FÖRE. Väljaren är utanför och raderna är klippta.
- `efter-1920-panel.png`, `efter-1366-panel.png`, `efter-1280-panel.png`: EFTER, med dag-chips
