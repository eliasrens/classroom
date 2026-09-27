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

**Åtgärd** (`css/modes/morgon.css`): Listan, elevlistan under Bra jobbat och
panelens scrollbehållare har kolumnen `minmax(0, 1fr)`. Etiketten trunkeras
med ellips och visar hela texten som tooltip (`title`). Väljaren, pennorna
och plusknapparna krymper aldrig. Inmatningsfälten har `min-width: 0`.
Scrollbehållaren har `overflow-x: hidden` som skyddsnät. Panelens bredd och
fällbara sektioner är oförändrade.

Uppmätt med alla fyra sektioner utfällda, en lång egen uppgift och en lång
fritext i Bra jobbat. "Utanför" är antalet element vars högerkant ligger
utanför `clientWidth`:

| Viewport | scrollWidth | clientWidth | Utanför | Väljarens högerkant (px) |
|---|---|---|---|---|
| 1920×1080 | 336 | 336 | 0 | 304 |
| 1366×768 | 314 | 314 | 0 | 282 |
| 1280×720 | 314 | 314 | 0 | 282 |
| Före, 1280×720 | 314* | 314 | 15+ | 522 |

\* Före klipptes raderna i stället för att ge scroll, så `scrollWidth` visade
inte felet. Stresstest efter åtgärden, med rotstorlek 20 px och en
bredare väljare (monospace, extra padding), gav också 0 element utanför.

Veckodagsväljaren gick att byta från Fredag till Måndag. Elevskärmen
(`#/elev/morgon`) visade sedan "Starten – Måndag"
(`efter-elevskarm-starten-mandag.png`).

- `fore-1280-panel.png`: FÖRE. Väljaren är utanför och raderna är klippta.
- `efter-1920-panel.png`, `efter-1366-panel.png`, `efter-1280-panel.png`: EFTER
