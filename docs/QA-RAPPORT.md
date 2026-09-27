# QA-rapport — kvalitetsgenomgång av hela appen (epic #92)

Genomförd 2026-09-27. Hela appen har testats systematiskt i fem delgenomgångar,
i lärarvy och elevvy, i mörkt och ljust tema, på skärmbredder från 1920 ned
till 420 px, med utskrifter verifierade som riktiga PDF:er och med delning
testad mot riktiga Firestore med två separata lärarkonton. All testning
skedde med påhittade testklasser — **ingen riktig klass (4A–4D) och ingen
riktig lärardata har rörts**.

Detaljrapporterna med skärmdumpar finns i `docs/qa/`:

| Del | Rapport | Omfattning |
|---|---|---|
| QA 1 | [`rutiner.md`](qa/rutiner.md) | Morgonskärmen och Lektionsplaneringen |
| QA 2 | [`verktyg.md`](qa/verktyg.md) | Trafikljus, Skrivtavla, Tankekarta, Lottning, Veckans övergångar, utskrifter |
| QA 3 | [`lararsidor.md`](qa/lararsidor.md) | Elevlista (inkl. krypterade rapporter), Översikt, Mina ämnen, Byt lösenord |
| QA 4 | [`tvargaende.md`](qa/tvargaende.md) | Meny/📌, elevskärm & synk, delning mellan två lärare, dataskydd i molnet, tillgänglighet, prestanda |
| QA 5 | [`kod.md`](qa/kod.md) | Kodgranskning, testsviternas hälsa, automatiska tester (CI), dokumentation |

## Sammanfattning

**Appen är i mycket gott skick.** Alla huvudflöden fungerar som utlovat,
inklusive de senaste funktionerna (redigering direkt i panelen, en enda
"Visa på elevskärm", skarpa lappar i lottningen). Dataskyddet håller i
praktiken, inte bara på pappret: en revision av själva molndatabasen visade
att **inga elevnamn, noteringstexter eller elev-id finns någonstans i
molnet**, och alla sju försök att bryta mot reglerna nekades korrekt.
Tillgängligheten mäter nu 100/100 (Lighthouse) på alla sex mätta sidor.

Under genomgången **rättades nio buggar** (alla små, alla med
före/efter-skärmdumpar i respektive rapport):

1. Panelens "Eleverna ser: Starten – …" uppdaterades inte vid dagbyte (Morgonskärmen).
2. En hållen elevtangent skapade en notering per tangentupprepning (Elevlista).
3. Elevkortets uttag/insatsformulär stod kvar när man bytte elev — fel elevs data kunde kopieras (Elevlista).
4. Sifferkortkommandon bytte läge bakom rapport-, utskrifts- och lösenordsdialogerna (globalt).
5. Mina ämnen tappade egna ämnen från andra klasser vid sparning (Mina ämnen).
6. "Mer än hälften gröna!" visades vid exakt hälften (Veckans övergångar, elevskärmen).
7. "Visas för eleverna"-knappen: vit text på grönt nådde inte WCAG AA-kontrast (elevskärmspanelen).
8. Trafikljusets gränstext på ovald typ låg under AA-kontrastgränsen.
9. Lektionssökens inskrivna text ärvde ikongrått — för låg kontrast.

Dessutom: **automatiska tester i GitHub är nu på plats** (alla 16 testsviter
plus syntaxkontroll av alla 101 JS-filer körs vid varje push och PR mot
main, verifierat grönt, ~1 minut per körning), bevisligen död kod är
borttagen och elva dokumentationsfel/föråldrade kommentarer är rättade.
Alla 16 testsviter var gröna efter samtliga ändringar.

## Betyg per område

| Område | Betyg | Kommentar |
|---|---|---|
| Rutiner (Morgon + Lektion) | ★★★★★ | Känns färdiga. En liten bugg rättad; kvarvarande fynd är putsnivå. |
| Verktyg (5 st + utskrifter) | ★★★★★ | Alla flöden, tangentbord, reduced-motion och PDF-utskrifter (A4/A3, exakta mått) korrekta. En faktafelsbugg på elevskärmen rättad. |
| Lärarsidor | ★★★★☆ | Rapportflödet är genomtänkt och elevdata lämnar aldrig datorn — men här fanns flest buggar (4 rättade, bl.a. fel elevs uttag). |
| Tvärgående (synk, delning, dataskydd, tillgänglighet, prestanda) | ★★★★★ | Tvålärardelning i realtid fungerar, dataskyddsrevisionen ren, Lighthouse 100/100, ingen minnesläcka på 50 lägesbyten. |
| Kod & drift | ★★★★★ | Ovanligt god kodkvalitet: ingen XSS av 115 granskade sänkor, disciplinerad städning i alla lägen, välskött dokumentation — och nu CI. |

## Topp 10 föreslagna justeringar

Inget av detta är akut. Sorterat efter nytta; "Insats" är uppskattad
arbetsmängd (liten ≈ under en timme, medel ≈ någon halvdag).

| # | Förslag | Varför | Insats | Källa |
|---|---|---|---|---|
| 1 | En delad `safeColor()` (hex-vitlista) vid varje ställe där färgvärden från delade molndokument sätts i `style`/`data`-attribut | Enda kvarvarande säkerhetsfyndet (försvar-på-djupet, inget hål: kräver manipulerad Firestore-skrivning från inloggat lärarkonto). Rättar alla sänkor på en gång. | liten | QA 5 + QA 3 |
| 2 | Seeda slumpen i test-outbox och gör deadlinen konfliktberoende | Enda kända test-flakigheten (~1 av 9–15 körningar) — kan ge falska röda i den nya CI:n. | liten | QA 5 |
| 3 | Visa sparfel för läraren (felrad/toast enligt mönstret i klassåtgärder) | I dag kan en sparning misslyckas tyst (t.ex. full localStorage) — dialogen står bara kvar. | liten | QA 5 |
| 4 | Ersätt kvarvarande `prompt()`/`alert()` på sex ställen med appens dialogmönster | Ser omodernt ut bredvid #87-redigeringen; lektionens egna ämnesfärg kräver i dag rå hex-text. | medel | QA 5 |
| 5 | Fatta beslut om Firestore-lyssnare som aldrig släpps (`data.watch` utan `unwatch`) | Lyssnare per besökt klass/samling lever hela dagen — begränsat men odokumenterat; antingen en förklarande kommentar eller referensräknad `unwatch`. | medel | QA 5 |
| 6 | Diskret varning när lektionstavlan slagit i minsta skalan (45 %) | Extremt långa texter klipps i dag utan att något säger "allt ryms inte". | liten | QA 1 |
| 7 | Samma lösenordsgräns överallt (8 tecken) | Första lokala lösenordet får vara 4 tecken men Byt lösenord kräver 8 — en lärare med kort lösenord fastnar. | liten | QA 3 |
| 8 | Ge morgonuppgifter samma raderingsskydd som övriga vyer och enhetlig bekräftelsestil | En uppgift försvinner i dag på ett klick; appen har tre olika bekräftelsemönster. | liten | QA 5 |
| 9 | `--color-ok`/`--color-danger` som **text**: inför text-varianter likt `--color-ok-bg` | Samma mönster som den rättade kontrastbuggen; några omätta ställen ligger nära AA-gränsen. | liten | QA 4 |
| 10 | En delad `escapeHtml` i `js/lib/escape.js` (ersätter 13 kopior, varav 2 utan apostrof-escapning) | Ofarligt i dag men inkonsekvent säkerhetsnivå; en kanonisk kopia är lätt att hålla rätt. | liten | QA 5 |

Övriga förslag med lägre prioritet finns i den fullständiga listan nedan
och i respektive delrapport (bl.a. testtäckningsluckor för
dataskyddsgränsen, bundling av de 84 ES-modulerna för snabbare kallstart
på långsamma nät, och föråldrade `docs/stress-flikbyten.js`).

## Fullständig fyndlista (ej rättade)

Alla detaljer, förslag och kodreferenser står i respektive delrapport.

| Allvar | Område | Fynd | Källa |
|---|---|---|---|
| Medel | Kod | Färgvärden från delade molndokument in i `style`-attribut utan validering (6+ sänkor, inkl. `data-phase` i Veckor) | QA 5, QA 3 |
| Medel | Kod | `data.watch` släpper aldrig Firestore-lyssnaren (ingen `unwatch`) | QA 5 |
| Medel | UX | `prompt()`/`alert()` kvar på sex ställen | QA 5 |
| Medel | Kod | test-outbox "externa konflikter" är instabilt (oseedad slump + fast deadline) | QA 5 |
| Medel | Kod | Sparfel syns inte för läraren (tyst `console.warn`, ohanterade promise-avvisningar i 7 handlers) | QA 5 |
| Medel | UX | Lektionstavlan klipper extremtext utan varning vid minsta skalan (45 %) | QA 1 |
| Låg | UX | Bra jobbat-tavlan kan skymmas av flytande Elevskärm-panelen i lärarvyn | QA 1 |
| Låg | Bugg | Okänt ämnes-id ger tom ämnesväljare (tavlan faller korrekt tillbaka) | QA 1 |
| Låg | Tillgänglighet | ~29 formfält utan `id`/`name` (autofyll/verktyg känner inte igen dem) | QA 1 |
| Låg | UX | Datum/tid-fält följer webbläsarens språk, inte svenskan | QA 1 |
| Låg | UX | Lokalt läge visar "okänd lärare" för egna poster | QA 3 |
| Låg | UX | Första lokala lösenordet: 4-teckensgräns mot Byt lösenords 8 | QA 3 |
| Låg | UX | "Lektionsplanering" radbryts mitt i ordet på Översikt › Idag vid 1920 | QA 3 |
| Låg | Kod | HTML-escapning definierad 13 gånger, två varianter utan apostrof | QA 5 |
| Låg | Kod | Rå-HTML-kontrakt (collapsible, print) vilar på anroparens disciplin; en oescapad `aria-label` i morgon.js | QA 5 |
| Låg | Kod | Duplicerad logik: skapa klass ×2, WCAG-kontrast ×2 (olika tröskel), datumformat ×3, modalskelett ×7 | QA 5 |
| Låg | Kod | Oanvänt timer-tillstånds-API (SYNC.md föreskriver det) + ~35 döda `export` | QA 5 |
| Låg | UX | Tre olika bekräftelsestilar för radering; morgonuppgifter raderas utan skydd | QA 5 |
| Låg | Dok | "Läge 1–5"-vokabulär kvar i DATAMODELL.md och kommentarer | QA 5 |
| Låg | Kod | `docs/stress-flikbyten.js` föråldrat sedan #52 (falska röda) | QA 5, QA 4 |
| Låg | Kod | Testtäckningsluckor: cloud-cleanup, classes.js, morning.js split/merge m.fl. vaktar dataskyddsgränsen utan test | QA 5 |
| Låg | Kod | Småputs: drag-lyssnare städas inte i kartans `destroy()`; dialoger överlever lägesbyte i två lägen | QA 5 |
| Låg | Tillgänglighet | `--color-ok`/`--color-danger` som text nära AA-gränsen på omätta ställen | QA 4 |
| Låg | Dok | En rad i AUTH.md om elevskärmsspärrens räckvidd (`#/elev/…`, inte lärar-URL:er) | QA 4 |
| Låg | Prestanda | 84 separata ES-moduler vid kallstart — bundling skulle halvera kallstarten på långsamma nät | QA 4 |
| Info | Dataskydd | Krypterade rapportfilens huvud visar klass-/lärarnamn i klartext (avsiktligt, dokumenteras) | QA 3 |
| Info | Dataskydd | Känd accepterad risk: framtidsdaterade dokument vinner LWW-konflikter (klockskyddet minskar risken) | QA 5 |

## Det som fungerar särskilt bra

- **Dataskyddet håller på riktigt.** Molndatabasens rot innehåller exakt
  `classes` och `teachers`; en programmatisk genomsökning av all läsbar
  data hittade inga elevnamn, texter eller elev-id, och sju
  regelöverträdelseförsök nekades. Elevdata routas konsekvent till
  `classroom:local:*` och lämnar aldrig datorn.
- **"Visa på elevskärm" (#88) håller vad den lovar** i alla lägen: guld/grön
  knapp, förhandsram, realtidsbyte, och när det visade tas bort blir
  elevskärmen tom — aldrig ett tyst byte.
- **Delning mellan två lärare fungerar i realtid** — klasslista, pass,
  anonyma räkningar, klassåtgärder med svar — medan planeringar, Mina ämnen
  och 📌-menyn förblir privata, och offline-kön töms korrekt.
- **Utskrifterna är exakta**: A4/A3 med rätt millimetermått, egen marginal
  oberoende av utskriftsdialogens val, hela rader, linjerat sista ark och
  filnamn utan elevnamn.
- **Tillgänglighet**: 100/100 på alla sex mätta sidor, komplett
  tangentbordsnavigering (WAI-ARIA-meny, kortkommandon, Esc överallt) och
  `prefers-reduced-motion` respekteras.
- **Kodkvaliteten är ovanligt god**: ingen XSS, inga ackumulerande
  minnesläckor, deny-by-default-regler med fältvalidering, 16 gröna
  testsviter — och nu körs allt automatiskt i GitHub vid varje push.
