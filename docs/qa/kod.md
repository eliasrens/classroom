# QA 5 — Kod & drift (issue #96)

Granskning av koden, testsviterna, dokumentationen och driften.
Enbart lågriskändringar är genomförda (CI, bevisligen död kod,
uppenbara dokumentationsfel); allt övrigt är förslag i tabellen nedan.

## Vad som granskades

- **Koden:** alla 101 JS-filer (~25 800 rader) i `js/` och `docs/`.
  Fyra systematiska genomgångar:
  - **XSS/säkerhet** — alla 115 HTML-sänkor (112 `innerHTML` +
    3 `insertAdjacentHTML`; ingen `outerHTML`/`document.write`) spårade
    till sina datakällor, inklusive elevskärmens utskicksvägar,
    utskrift/export och rapportfiler från kollegor. `firestore.rules`
    lästes rad för rad.
  - **Minnesläckor** — varje läges mount/unmount mot kontraktet i
    `docs/MODULKONTRAKT.md`: lyssnare, timers, observers,
    prenumerationer, dialoger.
  - **Död kod, duplicering, mönster, felhantering** — oanvända
    filer/exporter (med grep-bevis), delbar logik, inkonsekvenser
    mellan lägen, tomma catch-block och ohanterade promise-fel.
  - **Dokumentationen** — `README.md`, `DATAMODELL.md`, `docs/SYNC.md`,
    `docs/DATASKYDD.md`, `docs/TESTRUTIN.md`, `docs/AUTH.md`,
    `docs/DRIFTSATTNING.md` mot koden som den ser ut i dag.
- **Testsviterna:** alla 16 `docs/test-*.mjs` kördes (två gånger:
  före och efter ändringarna) och lästes igenom för täckning och
  stabilitet.

Ingen UI-ändring ingår i det här ärendet — inga skärmdumpar behövs
(inget som syns på skärmen har ändrats, varken lärar- eller elevvy).

## Genomfört (lågrisk)

### Automatiska tester i GitHub (CI)

`.github/workflows/test.yml` (ny): kör vid varje push och vid PR mot
`main`, på Node 22 (kravet var Node 20+), utan hemligheter:

1. `node --check` på alla 101 spårade JS-filer (syntaxvakt).
2. Alla `docs/test-*.mjs` — sviterna är rena Node-tester med attrapper
   i stället för Firestore/webbläsare, så de kan köras var som helst.

**Verifierad grön** på GitHub: körning 36307358386 (första försöket),
~1 minut.

### Död kod borttagen (med grep-bevis)

| Borttaget | Bevis |
|---|---|
| `js/modes/placeholder.js` (hela filen) | `grep -rn "placeholder.js\|createPlaceholderMode" js docs index.html` → 0 träffar utanför filen. Registret (`js/modes/registry.js`) importerar exakt de 9 riktiga lägena. CSS-klassen `.mode-placeholder` är **inte** död (15 filer använder den som tomläge) och är kvar. |
| `iconNames`-exporten (`js/lib/icons.js`) | `grep -rn iconNames js docs index.html` → bara definitionen. |
| Re-exporten `UNSPLASH_IDS`/`unsplashUrl` i `js/lib/morning.js` | Alla konsumenter (bg-picker, test-backgrounds) importerar direkt från `js/lib/backgrounds.js`; ingen importerar dem via morning.js. |

Beteendet är oförändrat: alla 16 testsviter gröna före och efter.

### Föråldrade kommentarer och dokumentationsfel rättade

- `js/modes/oversikt/idag.js` — kommentar hänvisade till den borttagna
  knappen "Visa för eleverna" (#39); nu elevskärmspanelens
  "Visa på elevskärm" (#88).
- `js/modes/lektion.js` (filhuvudet) — påstod att Bra jobbat-namnen
  läses ur delade `settings/morningScreen → praise`; sedan #32/#78
  ligger de i **lokala** `classes/{id}/praise/board` (koden gör rätt,
  bara kommentaren var fel).
- `DATAMODELL.md` — fyra rättningar: kartans `state` saknade
  `presented` (#88; elevskärmen läser `presented`, inte `cur`);
  `show.praise` pekade på delade morningScreen i stället för lokala
  praise/board (stred mot både koden och `firestore.rules`);
  "Visa för eleverna" → "Visa på elevskärm"; settings-exemplet
  `"schedule"` (finns inte, har aldrig funnits) → riktiga exempel.
- `docs/DATASKYDD.md` — "visningsläge" struket ur listan över
  klassinställningar i molnet (initial-läget togs bort i #60;
  `js/lib/names.js` städar aktivt bort rester).
- `docs/AUTH.md` — "byggs i Läge 5-objektet" → `firestore.rules`
  (reglerna finns sedan länge); nekad-listan kompletterad med
  `praiseArchive` och `reports` (reglerna nekar båda uttryckligen).
- `README.md` — `docs/`-trädet kompletterat med SYNC, DATASKYDD,
  TESTRUTIN, BAKGRUNDER och testsviterna.

## Fynd som inte är rättade (förslag)

| Allvar | Typ | Beskrivning | Förslag | Insats |
|---|---|---|---|---|
| Medel | Kod | **Färgvärden från delade Firestore-dokument in i `style`-attribut utan validering.** `js/modes/lektion.js:290` (`--subj:${st.color}` — når även elevskärmen), `js/modes/oversikt/idag.js:194`, `js/modes/lotta/stage.js:356,397,404`, `js/modes/elever/reports.js:660`. Hex valideras bara vid inmatning, inte vid rendering — ett manipulerat värde kan bryta sig ur attributet. Ingen väg dit via appens eget UI; kräver Firestore-skrivning från en inloggad lärares konto. `js/modes/elever/report-view.js:32` (`safeColor`) gör redan rätt. | En delad `safeColor()` (hex-vitlista) vid varje färg→style-sänka. | liten |
| Medel | Kod | **`data.watch` släpper aldrig Firestore-lyssnaren.** `js/data/firestore-sync.js:125` har ingen `unwatch`; avprenumerationen i `js/data/datalayer.js:459` tar bara bort callbacken. Lyssnare + senaste dokumentmängd per besökt path lever för alltid — begränsat (per klass × ~10 samlingar, inte per lägesbyte) men på en dator som står uppe hela dagen med flera klasser fortsätter trafik/minne för samlingar ingen tittar på. Kan vara avsiktligt (offline-first-spegel). | Fatta ett medvetet beslut: antingen en kommentar som säger att det är avsiktligt, eller `unwatch` med referensräkning. | medel |
| Medel | UX | **`prompt()`/`alert()` lever kvar på sex ställen** medan Morgonskärmen (#87) uttryckligen fick inline-redigering: `js/modes/lektion.js:881–883` (två kedjade prompts: ämnesnamn + rå hex-färg), `js/modes/elever/register.js:117`, `js/ui/class-picker.js:48`, `js/modes/oversikt/idag.js:72`, `js/modes/oversikt/installningar.js:101`. | Ersätt med appens dialogmönster (som #87); lektionens ämnesfärg med färgväljare i stället för hex-text. | medel |
| Medel | Kod | **test-outbox "externa konflikter" är instabilt** (~1 av 9–15 körningar): oseedad `Math.random` styr både op-mix och konfliktinjektion, retries använder riktig backoff (300 ms → 30 s) och testet väntar mot en fast 20 s-deadline — en otursstreck av konflikter spränger deadlinen utan att något är fel. Enda kända flakigheten; kan ge falska röda i CI. | Seeda PRNG:n (skriv ut seedet vid fel; scenarierna körs redan i egna barnprocesser) och gör deadlinen till en funktion av antalet injicerade konflikter. | liten |
| Medel | Kod | **Sparfel som inte syns eller inte fångas.** `js/ui/my-subjects-dialog.js:115` sväljer sparfel med bara `console.warn` (dialogen står kvar tyst). Ohanterade promise-avvisningar i handlers: `js/ui/class-picker.js:58`, `js/modes/oversikt/idag.js:211`, `js/modes/elever/roster.js:97` (klistra in-importen), `js/modes/lektion.js:1199,1269,1325`, `js/modes/morgon.js:274`. Datalagret är lokalt-först och kastar sällan, men localStorage-kvot kan slå till. | Felrad/toast enligt mönstret i `js/ui/class-actions.js:255` ("Kunde inte spara: …"). | liten |
| Låg | Kod | **HTML-escapning definierad 13 gånger**, och två varianter (`js/modes/oversikt/shared.js:3`, `js/modes/lektion.js:91`) escapar inte apostrof — ofarligt i dag (alla attribut citeras med `"`), men inkonsekvent säkerhetsnivå. Kanonisk: `js/modes/elever/shared.js:195`. | En delad `js/lib/escape.js`; ta bort de 12 kopiorna. | liten |
| Låg | Kod | **Rå-HTML-kontrakt som vilar på anroparens disciplin:** `js/ui/collapsible.js:39` (`title`/`lead`/`body` = "färdig HTML"), `openPrintView({html})`. Alla dagens anropare escapar rätt, men nästa glömmer tyst. Dessutom en konkret miss: `js/modes/morgon.js:723` interpolerar `label` oescapad i `aria-label` (i dag bara betrodda värden, men fasta uppgifters label läses ur delat Firestore-dokument). | `escapeAttr(label)` i morgon.js; låt `collapsibleHTML` escapa `title` som standard med `titleHtml` som opt-out. | liten |
| Låg | Kod | **Duplicerad logik:** skapa klass-flödet identiskt i `js/ui/class-picker.js:47` och `js/modes/oversikt/idag.js:71`; WCAG-kontrast två gånger med olika tröskel (`js/lib/color.js:19` 0.04045 vs `js/modes/karta/palette.js:105` 0.03928); `fmtDay` ×3 med tre format; mm:ss ×2; modalskelett handrullat i 7 komponenter; fullskärmsväxling ×2. | Flytta skapa klass till `js/data/classes.js`; låt palette.js använda color.js; en delad dialog-hjälpare vid nästa dialog som byggs. | medel |
| Låg | Kod | **Oanvänd API-yta:** hela timer-tillstånds-API:t i `js/lib/timer.js` (bara `createTicker` importeras; trafikljus har egna tidsstämplar + `fmtMMSS` med golv i stället för tak) — men `docs/SYNC.md` föreskriver API:t, så borttagning kräver dokändring; därför förslag, inte gjort. Därtill ~35 exporterade namn utan importörer (bara `export`-nyckelordet är dött). | Besluta: använd timer-API:t i trafikljus eller ta bort det + uppdatera SYNC.md. Droppa `export` på interna namn vid tillfälle. | liten |
| Låg | UX | **Tre bekräftelsestilar för radering:** inbyggd `confirm()` (klassåtgärder, elevkort, inställningar), inline-bekräftelseknapp (karta, lotta) — och **ingen alls** i Morgonskärmen (`js/modes/morgon.js:270`: en uppgift försvinner på ett klick; går att återskapa via "Återställ" men inte uppenbart). | Välj inline-mönstret överallt; ge morgonuppgifter samma skydd. | liten |
| Låg | Kod | **Kvarvarande "Läge 1–5"-vokabulär** i DATAMODELL.md (rad 41, 44, 63, 83, 259, 280, 290) och kodkommentarer, trots att menyn sedan #52 är Rutiner/Verktyg/Lärare. Ofarligt som förkortning men förvirrande för nya läsare. | Byt till läges-id ("morgon", "lektion", …) vid nästa dokrevision. | liten |
| Låg | Kod | **`docs/stress-flikbyten.js` är föråldrat:** konsolskript från #25 som bara känner de 5 ursprungliga lägena (kortkommandon 1–5), refereras ingenstans. | Uppdatera lägeslistan eller ta bort filen. | liten |
| Låg | Kod | **Testtäckningsluckor (Node-testbara utan webbläsare):** `js/lib/timer.js` (rena funktioner), `js/lib/trafikljus-stats.js`, `js/lib/teacher-filter.js`, `js/data/classes.js` (deterministisk klass-id — dokumenterad invariant utan test), `js/data/cloud-cleanup.js` ("Radera all data"-ordningen som TESTRUTIN kallar säkerhetskritisk), `js/lib/morning.js` split/merge av moln- vs lokaldata (relevant efter #78/#87), `presentedPlanOf` i lektion. Kärnan (store, router, sync) testas bara i webbläsare. | Prioritera cloud-cleanup, classes.js och morning.js split/merge — de vaktar dataskyddsgränsen. | medel |
| Låg | Kod | **Småputs i lägen:** `js/modes/karta/scene.js:459` — pekarlyssnare på `window` under pågående drag städas inte av `destroy()` (självläkande, max en uppsättning); modaldialoger öppnade från ett läge (klassåtgärder, Mina ämnen) överlever lägesbyte eftersom läget inte lägger stängningen i sin städlista (elever-läget gör rätt: `js/modes/elever.js:231`). | Ta bort drag-lyssnarna i `destroy()`; lägg dialogstängning i lägenas städlistor. | liten |
| Låg | Dataskydd | **Känd, accepterad risk:** framtidsdaterade dokument vinner LWW-konflikter (klockskev). Dokumenterat beslut sedan tidigare (skyddet `serverNow()` + TESTRUTIN-reglerna minskar risken). Ingen ny åtgärd föreslås här — nämns för fullständighet. | — | — |

## Det som fungerar bra

Viktigt för läraren att veta: kodkvaliteten är **ovanligt god** för en
app som vuxit så fort.

- **Ingen XSS hittades.** Alla 115 HTML-sänkor granskade: varje
  användarinmatad text (elevnamn, uppgifter, noteringar, klassåtgärder,
  bubblor, listor, planeringsfält, rapportinnehåll) escapas eller sätts
  med `textContent` — även på elevskärmen och i utskrift/export.
  Rapportpipelinen behandlar en kollegas fil som opålitlig data och
  vitlistar till och med färgvärden (`safeColor`). Fynden ovan är
  försvar-på-djupet, inte hål.
- **Inga ackumulerande minnesläckor.** Alla 9 lägen följer
  mount/unmount-kontraktet disciplinerat: städning registreras *innan*
  något startas och töms i `unmount` (timers, observers, watchers,
  fönsterlyssnare). Routern överlever hängande lägen (3 s-gränsen).
- **`firestore.rules` håller.** Deny-by-default, fältvalidering med
  `hasOnly` (elev-id/text kan inte ens skrivas in i noteStats av
  misstag), elevdata helt blockerad i molnet, ägarregler för
  klassåtgärder. Kommentarerna i regelfilen förklarar varför.
- **Alla 16 testsviter gröna** — rena Node-tester utan nätverk, med
  riktiga datalager-instanser mot attrapper. Flera testar mot
  dokumenterade invarianter (WCAG-kontrast, statistisk likformighet i
  lottningen, kryptering av rapportfiler utan klartextnamn).
- **Dokumentationen är ovanligt välskött** — felen som hittades var
  få och små i förhållande till mängden dokumentation, och
  veckomatematiken är korrekt centraliserad i `js/lib/week.js` utan
  drift mellan kopior.
- **Nu med CI:** varje push och PR mot `main` kör hela testsviten och
  syntaxkontroll automatiskt i GitHub.
