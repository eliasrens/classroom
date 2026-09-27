# QA 4: Tvärgående — meny/📌, elevskärm & synk, delning, dataskydd, tillgänglighet, prestanda (issue #95)

Testad 2026-09-27. Två delar:

- **Lokalt läge** (Firebase-apiKey tillfälligt överstyrd, ingen riktig data
  rörd) med den lokala testklassen QA-TEST-95 (26 fiktiva elever): meny,
  elevskärm, tillgänglighet, prestanda, offline.
- **Riktig Firestore** med två hemliga testkonton (”Lärare A” och ”Lärare B” nedan) i två helt
  isolerade webbläsarkontexter och en **molnbaserad testklass QA-TEST-95**
  (fiktiva elever, aldrig 4A–4D): delning, realtidssynk, offline-kö,
  klockskydd och dataskyddsrevision via REST. Testklassen och båda
  lärarnas privata subträd raderades via REST efteråt (alla sidor stängda
  först, enligt `docs/TESTRUTIN.md`) och det verifierades att **inget
  dokument i de riktiga klasserna ändrades under testet** (inga
  `updateTime` i testfönstret, inga framtida `updatedAt`).

## Menyn

- **📌 Fäst/lossa** (Verktyg ▾): nålen fäster/lossar utan att öppna läget,
  listan förblir öppen, `aria-pressed` och nålens `aria-label` växlar
  ("Fäst Lottning i menyn" / "Ta bort … från menyn"). Med noll fästa lägen
  döljs raden + avdelaren och knappen visar aktivt läge ("Verktyg: Morgon").
  ✔
- **Valet följer läraren:** sparas i `teachers/{uid}/settings/menu`
  (verifierat i molnet via REST). Lärare A fäste Lottning — Lärare B:s meny
  påverkades inte, och Lärare B:s konto kan inte ens läsa Lärare A:s dokument
  (PERMISSION_DENIED). ✔
- **Tangentbord** (WAI-ARIA Menu Button): Enter/Mellanslag/↓ öppnar med
  fokus på aktivt val (aria-current="page"), ↑ öppnar på sista, ↓/↑ vandrar
  runt, → eller Tab från raden når nålen, ← tillbaka, **P** fäster/lossar
  direkt, Esc stänger och lämnar fokus på knappen, Tab stänger. Lärare ▾
  likadant (sista posten är åtgärden "Byt lösenord"). ✔
- **Kortkommandon:** 1–9 byter läge i menyordning (6 → Lottning,
  9 → Översikt), E elevskärm, ? öppnar hjälpen. Hjälpen listar grupperna
  Överallt/Trafikljusur/Lottning/Veckans övergångar/Elevlista, siffror är
  avstängda medan hjälpen är öppen, Esc stänger. ✔
- **Responsivt:** 1920 nivå 0 (ikon+namn), 1100 nivå 1 (fästa lägen som
  ikoner), 900 egen rad under topbaren (data-wrap), 420 egen rad + ikonläge
  — ingen horisontell scroll på någon bredd. ✔

## Elevskärmen

- "Öppna elevskärm" öppnar `#/elev/<läge>` i nytt fönster; topbarens
  indikator växlar till "Elevskärm öppen" (presence) och panelen visar
  förhandsvisning + "Eleverna ser: …". ✔
- **"Visa på elevskärm" (#88):** guld (#c79a4e, mörk text) när läraren
  tittar på något annat än det utskickade; klick skickar ut exakt det
  läraren ser och elevskärmen byter i realtid (verifierat i separat
  fönster, utan omladdning); knappen blir grön "Visas för eleverna". I
  lärarlägen (Översikt/Elevlista) är knappen inaktiverad med hinten "Det
  här läget kan inte visas för eleverna". ✔
- **Spärren:** `#/elev/elever`, `#/elev/oversikt`, `#/elev/oversikt/veckor`,
  `#/elev/statistik` (alias) och `#/elev/xyz` — alla faller tillbaka till
  Morgonskärmen i elevtema; inga elevnamn eller lärarpaneler i DOM:en. ✔
  (Obs: skriver man en **lärar**-adress som `#/elever` i elevskärmsfönstret
  blir fönstret en vanlig lärarvy — det är samma inloggade webbläsare och
  avsiktligt utanför spärren, som gäller elevvyn `#/elev/…`.)
- **Omladdning** av elevskärmen: kommer tillbaka till det utskickade läget
  utan inloggningsformulär. ✔
- **Helskärm här** (enskärmsläge): växlar till elevvyn (helskärm när
  webbläsaren tillåter), Esc tar läraren tillbaka till läget hen stod i —
  fungerar även när helskärmen inte gick igång. ✔

## Delning mellan två lärare (riktig Firestore, QA-testklass)

Lärare A och Lärare B i två isolerade kontexter, båda i molnklassen QA-TEST-95:

- **Klasslistan:** klassen Lärare A skapade dök upp hos Lärare B utan
  omladdning. ✔
- **Trafikljuspass:** Lärare A sparade två pass — Lärare B:s statistik gick
  1 → 2 pass i realtid medan hen stod kvar i läget; lärarfiltret visar
  lärarens namn. Passen syntes också i Översikt › Veckor hos Lärare B
  (4 poster: noteringar, pass, klassåtgärder). ✔
- **Anonyma noteringsräkningar:** Lärare A lade in lokala elever och
  registrerade en Prat-notering. Molndokumentet fick **bara**
  `kind/typeId/positive/createdBy/createdByName/lesson/tider` — inget
  elev-id, ingen text (kontrollerat i datalagrets kö och via REST).
  Lärare B såg "1 noteringar" i veckosammanfattningen i realtid; inga
  elevnamn någonstans hos Lärare B. ✔
- **Klassåtgärder:** Lärare A delade en åtgärd ("Bättre"), Lärare B såg den i
  realtid och svarade "Testade också" — svaret dök upp hos Lärare A i realtid.
  Lärare A:s konto får inte radera Lärare B:s svar (PERMISSION_DENIED, verifierat
  via REST). ✔
- **Privat per lärare:** Lärare A:s planering syntes aldrig hos Lärare B
  (lessonPlans under `teachers/{uid}/…`), Mina ämnen likaså
  (`teachers/{uid}/settings/subjects`), 📌-menyn per lärare (ovan). ✔
- **Offline → online:** Lärare A sattes offline (nätverksemulering) —
  synkstatusen visade "Offline — synkar senare", en ändring på
  morgonskärmen hamnade i kön (`classroom:outbox:*`). Online igen: kön
  tömdes inom sekunder, statusen blev "Synkad" och Lärare B fick ändringen. ✔
- **Klockskyddet (#31):** klockan kalibrerades mot servern (offset < 1 s),
  varningen i topbaren förblev dold, och efter hela testet fanns **inga
  framtida `updatedAt`** i något dokument. (Varningsbannern finns i DOM:en
  men är korrekt `hidden` tills avvikelsen är > 2 min.) ✔
- **Städning:** klassdokumentet raderades först, därefter
  `classActions`/`classActionReplies`/`noteStats`/`sessions`/`settings`
  samt båda lärarnas `teachers/{uid}/classes/qa-test-95/{lessonPlans,settings}`
  med respektive konto. Verifierat efteråt: bara de fyra riktiga klasserna
  kvar, inga qa-test-95-dokument någonstans. ✔

## Dataskydd i molnet (revision via REST + ägarverktyg)

**Databasens rot innehåller exakt två samlingar:** `classes` och `teachers`
(uppräknat med ägarbehörighet, inte bara antaget).

Vad som faktiskt lagras (fältnamn ur verklig data, alla klasser):

| Plats | Fält | Innehåll |
|---|---|---|
| `classes/{id}` | id, name, createdAt, updatedAt | bara klassnamnet |
| `classes/{id}/sessions` | id, kind, type, result, startedAt, endedAt, lesson, createdBy, createdByName, createdAt, updatedAt | trafikljuspass |
| `classes/{id}/noteStats` | id, kind, typeId, positive, lesson, createdBy, createdByName, createdAt, updatedAt | anonyma streck — **inga elev-id, inga texter** |
| `classes/{id}/settings` | id, value, createdAt, updatedAt | morningScreen (hälsning/att-göra), trafikljus(State), vecka, lektion, elevlista (bara notistypkonfig) — **ingen praise/weekOf** |
| `classes/{id}/classActions`(+Replies) | id, text, outcome, category, lesson, createdBy(Name), createdAt, updatedAt | lärartext om klassen (namnspärren testas i test-class-actions) |
| `teachers/{uid}/meta/clock` | at, localAt | klockmätning |
| `teachers/{uid}/settings/{menu,subjects}` | pinned / mine | 📌-val, Mina ämnen |
| `teachers/{uid}/classes/{cid}/lessonPlans` | id, name, date, start, end, subjectId, fields, show, ownerUid, … | privata planeringar |
| `teachers/{uid}/classes/{cid}/settings/lektion` | value | vad elevskärmen visar |

**Inga elevnamn, notistexter eller studentId finns någonstans** —
genomsökt programmatiskt i alla läsbara dokument i alla klasser.

Reglerna nekar (alla verifierade med riktiga anrop):

1. skrivning till `classes/{id}/students` — DENIED
2. `noteStats` med `studentId`-fält — DENIED (fältvalidering)
3. `noteStats` med `text`-fält — DENIED
4. oautentiserad läsning av `classes` — DENIED
5. läsning av `classes/{id}/notes` (även inloggad lärare) — DENIED,
   likaså `students`, `praiseArchive`, `reports`
6. läsa en annan lärares `teachers/{uid}/…` — DENIED
7. radera en annan lärares klassåtgärdssvar — DENIED

## Tillgänglighet

Lighthouse (desktop, mörkt lärartema) — **efter** de rättade buggarna:

| Sida | Tillgänglighet | Bästa praxis |
|---|---|---|
| Morgonskärm (lärare) | 100 | 100 |
| Lektionsplanering | 100 (före: 96) | 100 |
| Trafikljusur | 100 (före: 96) | 100 |
| Elevlista | 100 | 100 |
| Översikt › Veckor | 100 | 100 |
| Elevskärm (`#/elev/morgon`) | 100 | 100 |

Dessutom: fokusmarkering finns globalt (`:focus-visible` i base.css, egna
inset-ringar i menyn), all tangentbordsnavigering ovan, `aria-label` på
ikonknappar (nålen, elevskärm, hjälp, tema, logga ut), aria-live på
synkstatus och "Eleverna ser", sr-only-etikett på klassväljaren. Guld på
mörk botten (`--hue-accent` med mörk text #17130a) mäter 7,2:1. Grå text
(`--color-ink-soft` #969ea9 på ytorna) mäter 4,4–5,5:1. Ämnesfärger som
text på tavlans vita papper mörkas automatiskt (js/lib/color.js, testas i
test-subjects — grönt).

## Prestanda

Lighthouse-MCP-verktyget exponerar ingen performance-kategori, så
prestandan mättes med Navigation Timing/paint-mätningar i samma headless
Chrome (lokal server — nätverkstiderna är optimistiska, relationerna
gäller):

- **Kall start** (`#/morgon`, lärare): first paint 112 ms, FCP 440 ms,
  DOMContentLoaded 398 ms. 105 requests, ~2,0 MB överfört.
- **JS:** 84 omodifierade ES-moduler, ~861 kB okomprimerat — inga fel,
  inga 404.
- **Bilder:** bakgrunderna hämtas från Unsplash med `w=1920` (~400–490 kB
  st) för tavlan och `w=320` (~25 kB) för panelens miniatyr — rimliga
  storlekar, ingen övermäta bild hittad.
- **Stresstest 50 lägesbyten** (alla nio lägen i cykel): JS-heap
  23,5 → 23,8 MB (ingen läcka), exakt en `.view__slot` i DOM:en efteråt,
  inga konsolfel. Snabba byten känns momentana (~monteringen är klar långt
  under stegets 120 ms-paus).
- **Konsol:** enda meddelandet över hela QA:n är DevTools-hinten "A form
  field element should have an id or name attribute" (autofyll-hint för
  4–5 fält, t.ex. sökfälten) — inget fel.

## Offline och dålig uppkoppling

- Utan Firebase-konfiguration startar appen helt lokalt; topbaren visar
  **"Lokalt läge"**. ✔
- Med Firebase men utan nät: **"Offline — synkar senare"**, skrivningar
  köas och överlever; när nätet kommer tillbaka töms kön och statusen blir
  **"Synkad"**. ✔ (Även "Synkar …" syntes flyktigt under kötömningen.)

## Rättade buggar (3 st — alla WCAG AA-kontrast, inga layout- eller flödesändringar)

### 1. "Visas för eleverna"-knappen: vit text på grönt nådde bara 3,2:1

**Vad:** När det läraren tittar på visas för eleverna blir knappen grön
(`--color-ok` #5d9c76) med vit text — kontrast 3,23:1, WCAG AA kräver
4,5:1. Lighthouse flaggade den på varje sida med elevskärmspanelen.

**Fix:** ny token `--color-ok-bg: #47805e` (samma gröna kulör, ett steg
mörkare — 4,65:1 mot vitt) som bara används där vit text står på grön
yta; prickar/ikoner/grön text behåller `--color-ok` oförändrad
(`css/tokens.css`, `css/app.css`).

**Före:** `docs/screenshots/issue-95/kontrast-presentknapp-fore.png`
**Efter:** `docs/screenshots/issue-95/kontrast-presentknapp-efter.png`

### 2. Trafikljusets "gult 1:00 · rött 2:00" på ovald typ: 4,41:1

**Vad:** `.tl-kind-limits` hade `opacity: 0.85`, vilket tunnade ut den
redan dämpade texten till strax under AA-gränsen på den ovalda
typknappen.

**Fix:** opaciteten borttagen — texten använder samma dämpade färg som
resten (5,5:1); den valda (guld-)knappen påverkas knappt (7,2:1)
(`css/modes/trafikljus.css`).

**Före:** `docs/screenshots/issue-95/kontrast-tl-kind-fore.png`
**Efter:** `docs/screenshots/issue-95/kontrast-tl-kind-efter.png`

### 3. Lektionssökens inskrivna text ärvde ikongrått: 4,13:1

**Vad:** `.plan-filter__search` sätter `--color-ink-soft` för
förstoringsglaset, och sökfältet ärvde färgen (base.css låter fält ärva)
— det läraren **skriver** blev grått på fältets mörka botten.

**Fix:** fältet får `color: var(--color-ink)` — inskriven text är nu lika
ljus som i andra fält; ikonen förblir dämpad (`css/modes/lektion.css`).

**Före:** `docs/screenshots/issue-95/kontrast-sokfalt-fore.png`
**Efter:** `docs/screenshots/issue-95/kontrast-sokfalt-efter.png`

## Testsviter

Alla 16 `docs/test-*.mjs` gröna före och efter ändringarna (riktig
firebase-config återställd innan körning).

## Förslag (inte åtgärdade — utanför "tydlig bugg")

| Förslag | Varför |
|---|---|
| Uppdatera `docs/stress-flikbyten.js` | Skriptet indexerar `#mode-nav a` som om menyn vore en platt lista med fem lägen (före #52). Efter fästa lägen + rullgardiner pekar index 3–4 på fel länkar → falska röda. Mitt 50-bytes-stresstest kördes i stället direkt (grönt). |
| Se över `--color-ok`/`--color-danger` som **text** på mörka ytor | T.ex. `.pwchange__done` och elevlistans chips ligger nära AA-gränsen (~3,5:1) men fanns inte på de Lighthouse-mätta sidorna i mätögonblicket. Samma mönster som bugg 1 — en `--color-*-text`-variant vore konsekvent. |
| Kommentera spärrens räckvidd i elevskärmen | `#/elev/…` är vattentät, men ett elevskärmsfönster som får en lärar-URL inskriven blir en lärarvy (samma inloggade webbläsare). Avsiktligt i dag — värt en rad i `docs/AUTH.md` så ingen tror att spärren gäller mer än elevvyn. |
| 84 separata ES-moduler vid kallstart | Lokalt osynligt; på GitHub Pages med kall cache blir det många rundresor. Ingen åtgärd krävs nu (HTTP/2 + cache), men en enkel bundling skulle halvera kallstarten på långsamma nät. |
