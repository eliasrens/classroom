# Datamodell — Firestore-struktur

Samma pathsyntax används av det lokala datalagret (`js/data/datalayer.js`),
så modellen gäller oavsett om Firebase är anslutet eller ej.

**ELEVDATA ÄR ENDAST LOKAL (issue #32).** Ingenting om enskilda elever
lämnar lärardatorn: samlingarna `students`, `notes`, `praise`,
`praiseArchive`, `privacy` och `reports` under en klass routas av datalagret till
en egen lokal lagring (`js/data/local-only.js`, prefix
`classroom:local:`) som aldrig går via outboxen eller Firestore.
Molnet innehåller bara klasstatistik: `sessions` (trafikljuspass) och
`noteStats` (anonyma noteringsräkningar), plus klassinställningar,
lärarnas delade klassåtgärder (`classActions`, issue #34) och lärarnas
privata planeringar. `firestore.rules` nekar elevsamlingarna helt och
fältvaliderar `noteStats` och `classActions`. Se `docs/DATASKYDD.md`.

## Struktur

```
classes/{classId}                       — en klass (4A, 4B, …)
  name: "4A"
                     — {classId} är för nya klasser ett DETERMINISTISKT
                       id härlett ur namnet ("4B" → "4b", se
                       js/data/classes.js) så att två enheter som skapar
                       samma klass oberoende av varandra skriver samma
                       dokument — klasser kan aldrig dubbleras. Äldre
                       klasser med UUID-id fortsätter gälla; skapande
                       med ett namn som redan finns återanvänder alltid
                       den befintliga klassen.

classes/{classId}/students/{studentId}  — elev i klassen — ENDAST LOKALT
  firstName          — ENDAST förnamn. Det finns AVSIKTLIGT inget
                       efternamns-/fullnamnsfält (integritet: appen
                       visas på projektor).
  tag                — VALFRI kort särskiljare (emoji/bokstav/siffra,
                       t.ex. "🐱" eller "B") om två elever delar
                       förnamn. Aldrig obligatorisk.
  active: true       — false i stället för borttagning (historik bevaras)
  hotkey             — VALFRI tangent (en bokstav/siffra) för snabb-
                       notering i Läge 4. Unik per klass; bara aktiv i
                       Läge 4:s registreringsflik.

classes/{classId}/sessions/{sessionId}  — genomförda pass/resultat
                                          (trafikljuspass, aktiviteter; Läge 3/5)
  type: "trafikljus" | …
  kind               — endast type "trafikljus": "overgang" | "datorer".
                       Gamla pass UTAN kind räknas som "overgang".
                       Statistik och rekord räknas alltid separat per
                       kind (datorer jämförs aldrig med övergångar).
  startedAt, endedAt
  result: { … }      — passtypens egna data (t.ex. antal varningar).
                       Trafikljus: { color: "green"|"yellow"|"red",
                       durationSec, limits: { yellowSec, redSec } }
                       (limits = gränserna som gällde, saknas på äldre pass)
  lesson             — SNAPSHOT av pågående block ur den inloggade
                       lärarens lessonPlans vid sparandet (samma format
                       som noteringarnas): { date, start, end,
                       subjectId, title } | null om inget block pågår
  createdBy          — lärarens uid
  createdByName      — lärarens visningsnamn ("Elias"); gamla dokument
                       utan fältet visas som "okänd lärare"

classes/{classId}/notes/{noteId}        — noteringar om elever (Läge 4) — ENDAST LOKALT
  studentId
  kind: "typ" | "text" | "insats"
                     — typ = kategoriserad snabbnotering (ett tryck),
                       text = fritextanteckning,
                       insats = vad läraren gjorde åt saken
  typeId             — för kind "typ": prat | stol | fokus | sen | annat | positiv
  positive: bool     — noteringar om det som går bra (egen tangent/knapp)
  text               — fritext (tom för rena snabbnoteringar)
  labelId            — VALFRI lärardefinierad etikett (settings/elevlista → labels)
  followUp: bool     — markerad för uppföljning — sätts ALLTID av läraren
                       själv, aldrig automatiskt
  helped             — endast kind "insats": "ja" | "delvis" | "nej" | null
  lesson             — SNAPSHOT av pågående block ur lessonPlans vid
                       skapandet: { date, start, end, subjectId, title } | null
                       (grund för mönstervyerna: moment/veckodag/tid/ämne)
  createdBy          — lärarens uid
  createdByName      — lärarens visningsnamn ("Elias"); gamla dokument
                       utan fältet visas som "okänd lärare"
  createdAt          — epoch ms; tillsammans med klass-kopplingen i pathen
                       gör tidsstämpeln central auto-radering (Läge 5) möjlig

classes/{classId}/noteStats/{eventId}   — ANONYMT "streck" per notering (issue #32)
  id: "note-{noteId}" — deterministiskt (noteId = den LOKALA noteringens
                       id) så att omräkning/migrering är idempotent och
                       en borttagen lokal notering kan ta bort sitt streck.
                       Kopplingen notering → streck finns bara lokalt.
  kind               — "typ" | "text" | "insats"
  typeId             — för kind "typ": prat | stol | fokus | sen | annat | positiv
  positive: bool
  lesson             — SNAPSHOT { date, start, end, subjectId, title } | null
  createdBy, createdByName, createdAt, updatedAt
                     — ALDRIG studentId, text, followUp, helped eller
                       labelId — firestore.rules fältvaliderar (hasOnly).
                       Append-only i praktiken (inga räknare som krockar);
                       radering sker när noteringen tas bort lokalt eller
                       klassen raderas.

classes/{classId}/classActions/{id}     — KLASSÅTGÄRD (issue #34) — DELAD mellan lärarna
                       "Testade par i stället för enskilt — lugnare. → Bättre".
                       Gäller KLASSEN, aldrig en elev. Skapas via
                       js/ui/class-actions.js (logik: js/lib/class-actions.js).
  text               — vad man testade och hur det gick (1–500 tecken)
  outcome            — "better" | "same" | "worse" | "unsure"
                       (Bättre / Ingen skillnad / Sämre / Osäkert; visas med
                       linje-ikoner, inga emoji)
  category           — VALFRI: förvald (arbetssatt | placering | struktur |
                       rorelse | ljud | ovrigt) eller lärarens egen text
                       (högst 40 tecken) | null
  lesson             — SNAPSHOT { date, start, end, subjectId, title } | null
                       (samma form som noteStats/sessions; förvald = den
                       pågående lektionen, eller passets/den öppna planeringens)
  createdBy, createdByName, createdAt, updatedAt
                     — firestore.rules: alla inloggade läser och skapar
                       (createdBy == auth.uid), bara upphovspersonen ändrar
                       och tar bort; createdBy kan inte skrivas om; hasOnly
                       + storleksgränser. Radering av andras poster tillåts
                       först när klassdokumentet är borta ("Radera all data").
                     — NAMNSPÄRR i klienten: texten (och en egen kategori)
                       prövas mot datorns LOKALA elevlistor (alla klasser),
                       skiftlägesokänsligt, hela ord (+ genitiv-s). Träff →
                       sparas inte. Kan inte finnas i reglerna — namnen
                       finns aldrig i molnet.
                     — Följer INTE måndagsrensningen: kunskap som ska finnas
                       kvar. Statistik bläddrar dem per vecka (createdAt);
                       Översikt visar de senaste.

classes/{classId}/classActionReplies/{id} — "Testade också" (issue #34) — DELAD
  actionId           — klassåtgärden svaret gäller
  outcome            — som ovan
  text               — kort kommentar, 0–300 tecken (namnspärr som ovan)
  createdBy, createdByName, createdAt, updatedAt
                     — samma ägarregler; actionId kan inte ändras. Ett svar
                       får tas bort av vem som helst när åtgärden det svarar
                       på är borta — upphovspersonen raderar sin åtgärd FÖRST
                       och städar sedan svaren (outboxen pushar i ordning).
                       PLATT samling (inte en subkollektion per åtgärd): en
                       lyssnare per klass i stället för en per åtgärd.

classes/{classId}/praise/board          — Bra jobbat-listan — ENDAST LOKALT
  praise: [ { id, kind: "student", studentId } | { id, kind: "free", text } ]
  weekOf: "2026-W39" — veckan listan hör till (veckorytmen nedan).
                       Flyttad hit från settings/morningScreen (issue #32):
                       listan innehåller elevdata och delas inte längre.

classes/{classId}/privacy/privacy       — lokal gallring — ENDAST LOKALT
  value: { noteRetentionWeeks,          — standard 12 (en termin), min 1.
           awaitingChoice }             — uppgraderingsskydd: sätts av
                       migreringen när datorn hade "Spara tills vidare"
                       (eller ingen inställning). Gallringen körs INTE
                       förrän läraren bekräftat en lagringstid i
                       Översikten (annars hade lokala noteringar äldre
                       än 12 veckor raderats tyst vid första öppningen).

classes/{classId}/reports/{id}          — elevrapporter (issue #33) — ENDAST LOKALT
  log:       { exports: [ { at, from, to, students: null | [studentId] } ] }
                     — vilka perioder som laddats ned (krypterad fil eller
                       utskrift), för hela klassen (students null) eller
                       vissa elever. Styr att påminnelserna inte tjatar.
  reminders: { monday: "2026-W38", retention: ["2026-W27", …] }
                     — avvisade påminnelser (måndagsbannern per vecka,
                       gallringspåminnelsen per uppsättning veckor)
  matches:   { pairs: [ { teacherUid, name, tag, localId } ] }
                     — bekräftade namnpar vid sammanslagning ("Catalins
                       'Mohammad' = min elev s_moh"). BARA namn ↔ lokalt
                       id — aldrig notisdata. Dekrypterade rapporter och
                       sammanställningar sparas ALDRIG (bara i minnet).

  Rapportfilerna (.klassrum) lagras inte av appen alls: de laddas ned
  och flyttas för hand. Format: js/lib/report-crypto.js (container:
  AES-GCM 256, nyckel via PBKDF2-SHA-256 ≥ 600 000 iterationer, slumpad
  salt + IV per fil; klartextdelen är bara lärare/klass/period/antal) och
  js/modes/elever/report-data.js (nyttolasten, formatVersion 1).

classes/{classId}/settings/{key}        — inställningar per klass
                                          (dokument-id = inställningens namn,
                                           t.ex. "schedule", "morningScreen")
  value: { … }

classes/{classId}/settings/morningScreen — Läge 1:s tillstånd (js/lib/morning.js)
  value: { greeting, tasks, showNametavla, background }
                     — Bra jobbat (praise/weekOf) är FLYTTAD till den
                       lokala classes/{id}/praise/board (issue #32);
                       firestore.rules nekar en morningScreen som
                       innehåller praise/weekOf. I minnet slår
                       js/lib/morning.js ihop båda källorna
                       (watchMorning/loadMorning/saveMorning).

classes/{classId}/praiseArchive/{weekOf} — ögonblicksbild av förra veckans Bra jobbat — ENDAST LOKALT
  weekOf: "2026-W38" — = dokument-id (deterministiskt: en per vecka)
  weekStart          — epoch ms, måndag 00:00 lokal tid
  praise: [ … ]      — listan som den såg ut när veckan tog slut
  archivedAt, createdBy, createdByName — vilken lärares enhet som gjorde tömningen

classes/{classId}/settings/elevlista    — Läge 4:s inställningar
  value: {
    defaultTypeId    — standardtyp för ett-trycks-notering ("prat" …)
    labels: [ { id, name, color } ]
                     — lärarens egna etiketter för anteckningar
                       (t.ex. positivt, följ upp, ring hem)
    sessionStart     — epoch ms; minneslistan visar noteringar efter
                       denna. "Nollställ inför nästa lektion" = nu.
  }

classes/{classId}/settings/trafikljus   — Läge 3:s gränser, per passtyp
  value: {
    overgang: { yellowSec, redSec }   — standard 60 / 120
    datorer:  { yellowSec, redSec }   — standard 180 / 300 (grönt <3:00,
                                        gult 3:00–5:00, rött från 5:00)
    goalMetric, showGoalToStudents    — veckomålet, se nedan
  }
                     — bakåtkompatibelt: en äldre config utan typ
                       ({ yellowSec, redSec } på toppnivån) läses som
                       "overgang" och skrivs om till typad form vid
                       nästa ändring. Saknad typ får standardvärden.
    goalMetric: { overgang: "avg"|"best"|"total", datorer: … }
                     — veckomålets mått per typ (issue #35), standard "avg"
                       (snitt per pass). Målet = förra veckans värde i
                       måttet; klaras när veckans värde är UNDER det.
    showGoalToStudents: bool
                     — "Visa veckomålet för eleverna": en diskret rad under
                       klockan på elevskärmen ("Veckans mål: snitt under
                       2:40"). Standard av. Inga lärarnamn/statistik där.
                     — veckoresultaten LAGRAS INTE: de räknas fram ur
                       sessions per vecka (js/lib/week-goal.js), så ett
                       sent synkat pass hamnar alltid i rätt vecka.
                       "Förra veckan" = närmast föregående vecka MED pass
                       av typen (en lovvecka hoppas över och det syns).
                       Test: node docs/test-week-goal.mjs

classes/{classId}/settings/trafikljusState — Läge 3:s live-tillstånd
  value: { timer: { startedAt, pausedAt|null } | null,
           kind: "overgang" | "datorer" }
                     — speglas till elevskärmen (även via sync-bussen);
                       kind styr gränserna och etiketten "Datorer"

classes/{classId}/settings/vecka        — Veckans övergångar (issue #36): vad elevskärmen visar
  value: { week: "2026-W39" | null,   — null = innevarande vecka (serverNow)
           kind: "overgang" | "datorer",
           page: 0–3 }                — Översikt, Dag för dag, Snabbaste, Målet
                     — skrivs av lärarvyn vid bläddring (speglas även via
                       sync-bussen `vecka:view`). Innehållet räknas fram ur
                       sessions (js/lib/week-recap.js) — inga lärarnamn
                       eller noteringar når elevskärmen.
                       Test: node docs/test-week-recap.mjs

classes/{classId}/settings/display      — namnvisning (togglas i lärarvyn)
  value: { nameDisplay: "first" | "initials" }
                     — "initials" = reservläget: initialer räknas
                       fram ur förnamnet (js/lib/names.js), lagras ej

teachers/{uid}                          — lärarprofil (se docs/AUTH.md)
  email, displayName — skrivs/uppdateras automatiskt vid inloggning
                       (js/auth.js); displayName härleds ur e-postens
                       lokala del ("elias@…" → "Elias") och används för
                       attribution (createdByName) på pass/noteringar

teachers/{uid}/meta/clock               — klockmätning (issue #31, js/lib/clock.js)
  at                 — serverTimestamp() vid senaste mätningen
  localAt            — enhetens lokala tid när mätningen skickades (felsökning)

teachers/{uid}/classes/{classId}/lessonPlans/{planId}
                     — lektionsplanering (Läge 2). PRIVAT per lärare:
                       ligger under lärarens uid, inte under den delade
                       klassnoden. Bara ägaren läser/skriver (firestore.rules).
  ownerUid           — lärarens uid (= {uid} i pathen; gör ägaren explicit)
  date: "2026-09-14" — ISO-datum; en planering per dag och klass är normalfallet
  name, subjectId, start, end
  fields: { … }      — planeringens innehåll (vad/hur/varför/…)
  show: { … }        — vilka fält som visas på tavlan; show.praise = visa
                       "Bra jobbat"-rutan i högerkolumnen (namnen läses ur
                       den DELADE classes/{id}/settings/morningScreen → praise)
                     — planeringar skapas och raderas aldrig automatiskt
                       (ingen testdata/auto-seed, ingen veckostädning);
                       bara läraren själv skapar, kopierar och tar bort
```

## Outbox (synkkön)

Alla skrivningar går först till localStorage och läggs samtidigt i
outboxen som `js/data/datalayer.js` tömmer mot Firestore. Semantik:

- **Lagring**: en localStorage-nyckel PER op,
  `classroom:outbox:<tid>:<löpnr>:<opId>` (kön = nycklarna sorterade).
  Enqueue är ett `setItem`, borttagning ett `removeItem` — aldrig
  läs-ändra-skriv på en delad array, eftersom localStorage inte är atomärt
  mellan fönster i olika processer (två fönster kunde annars skriva över
  varandras nyss köade ops). En gammal array-kö under `classroom:outbox`
  (före #30) töms först och tas sedan bort.
- **En op** = `{ opId, op: "set"|"patch"|"delete", path, id, doc | at }`.
  `opId` är unikt och sätts vid enqueue. Äldre ops utan `opId`
  identifieras på `op|path|id|updatedAt` (resp. `at` för delete).
- **Borttagning per identitet**: efter lyckad push tas just den op:ens
  nyckel bort (gamla array-ops: `filter` på identitet), aldrig "första i kön" — så en op som köats under
  tiden (här eller i ett annat fönster) kan inte raderas av misstag.
- **En flush i taget per fönster**: spärren (ett promise) sätts synkront
  innan första `await`. Ett flush-anrop under pågående flush tappas inte —
  kön körs igen när den pågående är klar. Kön läses om före varje op.
- **En flush i taget mellan fönster** (lärarfönster och elevskärm delar
  samma localStorage-outbox): Web Locks (`navigator.locks`, låset
  `classroom-outbox`), med ett localStorage-lease
  (`classroom:outbox-lease`, 15 s utgångstid) som reserv.
- **Idempotent push**: varje op skrivs i en last-write-wins-transaktion
  (`firestore-sync.js`) som hoppar över op:en om servern har nyare
  `updatedAt`. Råkar samma op pushas två gånger är det ofarligt. Ett
  `updatedAt` i framtiden kan varken blockera eller skrivas (se
  Tidsstämplar och klocka nedan).
- **Fel**: transaktionskonflikt (`failed-precondition`/`aborted`) ger
  retry med backoff (0,3 s → 30 s), op:en ligger kvar och synkstatusen
  påverkas inte (loggas med `console.info`). Backoffen dubblas bara vid
  konflikter i rad; varje lyckad push nollställer den. Övriga fel = synkstatus
  `offline`; kön försöker igen vid nästa skrivning, `online`-event eller
  när en server-snapshot kommer tillbaka.
- **Ägarskyddade samlingar** (`classActions`, `classActionReplies`, issue
  #34): en op som reglerna nekar (`permission-denied`) kan aldrig lyckas
  och får inte stoppa kön — den tas bort med en varning, och molnets
  version kommer tillbaka med nästa server-snapshot. Undantag: en EGEN
  ny/ändrad post (createdBy = inloggad lärare) försöks igen som vanligt
  (auth-token kan vara sen). Nya ägarskyddade samlingar läggs till i
  `OWNED_PATH` i `js/data/datalayer.js`.
- Test: `node docs/test-outbox.mjs` (två fönster, 20 snabba skrivningar,
  flush från flera håll, med och utan Web Locks, med konflikter, med
  en gammal array-outbox samt en nekad op i en ägarskyddad samling).

## Delat kontra privat kontra endast lokalt (issue #32)

- **DELAT mellan alla inloggade lärare** (läs+skriv, realtid via
  onSnapshot): klasser, pass/resultat, ANONYMA noteringsräkningar
  (`noteStats`), klassinställningar och klassåtgärder med svar
  (`classActions`, `classActionReplies` — bara upphovspersonen ändrar och
  tar bort sin post). En lärare ser alla andras pass, räkningar och
  klassåtgärder — men aldrig något om enskilda elever.
- **ENDAST LOKALT per lärardator** (aldrig via outboxen/Firestore, se
  `js/data/local-only.js`): elevlistan, noteringarna, Bra jobbat med
  arkiv, gallringsinställningen och rapportloggen (issue #33). Elevskärmen i samma webbläsare
  läser samma lokala lagring (livespegling via storage-eventet).
  Varje notering skapar samtidigt ett anonymt `noteStats`-streck i
  molnet (`js/modes/elever/shared.js` → `createNote`).
- **PRIVAT per lärare**: lektionsplaneringar
  (`teachers/{uid}/classes/{classId}/lessonPlans`). Varje lärare
  planerar sina egna lektioner; ingen annan lärare kommer åt dem.
  Pathen bär ägarskapet, så en klientlyssnare på det egna subträdet
  behöver ingen `where`-filtrering (se `js/data/plans.js`).

## Veckorytm — rent varje måndag (issue #29)

- En vecka börjar **måndag 00:00 lokal tid** (`js/lib/week.js`).
- Elevstatistik (noteringar, mönster, tallies i Elevlista och Översikt) och
  trafikljustider (tallies, rekord, veckans pass per typ) **filtreras** på
  innevarande vecka. Ingenting raderas: `notes` och `sessions` behåller all
  historik, och tidigare veckor visas i arkivet under **Statistik**
  (`js/modes/statistik.js`, ett lärarläge som aldrig är elev-visningsbart).
- **Bra jobbat** (LOKALA `praise/board`, issue #32) är ett tillstånd, inte en
  logg. Första öppningen en ny vecka skriver det LOKALA `praiseArchive/{weekOf}`
  och tömmer listan (`weekOf` = den nya veckan) — helt lokalt per dator
  (`js/lib/week-rhythm.js`); det deterministiska arkiv-id:t gör att två
  fönster på samma dator konvergerar. Vyerna visar aldrig förra veckans
  lista, inte heller innan tömningen hunnit sparas.
- **Lektionsplaneringar rörs aldrig** av veckorytmen.
- **Klassåtgärder** (`classActions`, issue #34) följer inte måndagsrensningen:
  Översikt visar de senaste oavsett vecka, och Statistik bläddrar dem per
  vecka (på `createdAt`) i arkivet som resten.
- **Enhetsklockor** (issue #31): veckan räknas på servertid (`serverNow()`,
  se Tidsstämplar och klocka nedan), och med Firebase körs veckorytmen först
  när klockan är mätt mot servern. En dator vars klocka går fel rullar alltså
  inte veckan för tidigt (eller för sent) för de andra. En `weekOf` i
  FRAMTIDEN (skriven med fel klocka) räknas som ogiltig: nästa lärarvy rättar
  den till innevarande vecka och behåller listan, precis som äldre data utan
  `weekOf`. Samma väntan gäller auto-raderingen av gamla noteringar.

## Tidsstämplar och klocka (issue #31)

`updatedAt` avgör last-write-wins, så en enda dator med fel klocka kunde
förr låsa ett delat dokument för alla: skrevs det med en tid fyra dagar
fram vann den versionen mot varje riktig ändring tills realtiden hunnit
ikapp. (Det hände 4A:s `settings/morningScreen` under testet av #29.)
Skyddet, i `js/lib/clock.js`:

- **Servertid som sanning.** `serverNow()` = `Date.now()` + offset, där
  offseten mäts mot Firestore: klienten skriver `serverTimestamp()` i
  `teachers/{uid}/meta/clock` (lärarens privata subträd) och läser tillbaka
  det från servern. Felet är högst halva tur-och-returtiden (mätningar med
  mer än 5 s tur-och-retur kastas). Mätning sker vid uppkoppling (första
  pushen väntar högst 4 s på den), var 10:e minut och när nätet kommer
  tillbaka. Offseten delas med andra fönster via localStorage
  (`classroom:clockOffset`). `serverNow()` används överallt där
  `updatedAt`, `createdAt`, `at`, `startedAt`/`pausedAt`, `archivedAt`,
  `sessionStart` och veckan sätts. Offline innan någon mätning finns gäller
  lokal tid, och då skyddar klämningen.
- **Framtida tidsstämpel** = mer än 5 min efter `serverNow()`
  (`isFutureStamp`). Toleransen tål vanlig klockdrift, och en sådan
  tidsstämpel kan bara komma från en klocka som går fel.
- **Klämning vid skrivning** (push-transaktionen, `firestore-sync.js`): en
  egen op med framtida `updatedAt`/`createdAt`/`at` (skriven offline med
  fel klocka innan offseten var känd) räknas som "nu" och skrivs till
  servern med `serverNow()`. Ett framtida `updatedAt` på SERVERN kan aldrig
  blockera en op. Då vinner op:en och dokumentet skrivs med korrekt tid
  (självläkning).
- **Merge** (`mergeRemote` → `remoteWins`): är exakt en av den lokala och
  fjärrversionen framtida gäller **servern**, utom mot en egen ännu ej
  pushad ändring. Den står då kvar, och pushen ovan skriver den till servern
  med korrekt tid. Annars gäller vanlig LWW (lika = fjärr vinner). Efter en
  lyckad klockmätning prövas senaste fjärrläget om, så att en lokal kopia
  som stämplats innan klockan var känd läks.
- **Varför klämma och inte `serverTimestamp()` i `updatedAt`**: datalagret är
  offline-first. En op stämplas lokalt när läraren gör ändringen och behöver
  kunna jämföras direkt, även offline, och `serverTimestamp()` finns inte
  förrän servern svarat. Skyddet håller därför LWW på `updatedAt` i
  epoch-ms, och klämningen tar bort de tidsstämplar som inte kan vara
  riktiga.
- **Ingen divergens.** Regeln beror bara på serverdatan, den egna outboxen
  och servertiden, som alla mätta enheter är överens om. Med tom outbox
  hamnar därför varje enhet på serverns version, oavsett hur deras
  lokala klockor går. Ett framtida dokument ersätts på alla enheter av den
  första riktiga ändringen, och ingen enhet håller fast vid den framtida
  kopian. Kvarvarande gränsfall: en enhet som ALDRIG når
  servern kan inte mäta sin klocka, men dess skrivningar kläms ändå när
  de väl pushas (då är servern nådd och klockan mätt).
- **Varning i lärarvyn**: skiljer sig datorns klocka mer än 2 min från
  servern visas "Datorns klocka går fel — kontrollera tid och datum" i
  topbaren, som aldrig visas på elevskärmen. Skrivningarna blir rätt ändå,
  men datorns egen klocka (t.ex. i Windows) är fortfarande fel.
- **Klassval**: försvinner den aktiva klassen (raderad på annan enhet eller i
  ett test) går klassväljaren till "Välj klass…". Den väljer inte tyst en
  annan riktig klass, där vyerna annars skulle fortsätta skriva.
- Test: `node docs/test-clock.mjs` (fjärrdokument 4 dygn fram mot ny lokal
  ändring, klient med klockan 1 dygn fel, offline med fel klocka, läkning på
  en annan enhet och veckorytm). Testrutin mot riktig Firestore finns i
  `docs/TESTRUTIN.md`.

## Motivering

- **Delad klassdata under `classes/{id}`** — klassen är appens naturliga
  avgränsning: klassvalet i topbaren väljer i praktiken vilket subtree
  alla lägen läser/skriver. Det gör även Firestores säkerhetsregler
  enkla (delad läs/skriv för inloggade lärare, se docs/AUTH.md) och
  håller lyssnare små (man prenumererar bara på vald klass). Undantaget
  är lektionsplaneringar, som är privata per lärare och därför ligger
  under `teachers/{uid}` i stället (se Delat kontra privat ovan).
- **Subkollektioner i stället för arrayfält** (elever, planeringar,
  noteringar): dokument kan uppdateras oberoende av varandra, vilket
  minimerar synk-konflikter när flera lärare arbetar samtidigt —
  last-write-wins gäller då per elev/planering, inte per klasslista.
- **`settings` som key/value-dokument** — varje läge kan lägga sina
  inställningar under egen nyckel utan schemaändringar.
- **Noteringar i egen kollektion** (inte under varje elev): Läge 5:s
  översikt vill lista senaste noteringar för hela klassen med EN
  lyssnare; filtrering per elev görs på `studentId`.
- **`updatedAt`/`createdAt` (epoch ms) sätts automatiskt** av
  datalagret på alla dokument, med servertid (`serverNow()`), och används
  för last-write-wins-merge vid synk. Framtida tidsstämplar vinner aldrig
  (se Tidsstämplar och klocka).
- **Mjuk borttagning av elever** (`active: false`) så att gamla
  pass/noteringar aldrig pekar på obefintliga elever.
- **Endast förnamn på elever** — medvetet integritetsval: skärmen
  projiceras i klassrummet och data delas mellan lärare. Namnkrockar
  löses med den valfria `tag`-särskiljaren, aldrig med efternamn.
  Visningshjälpare (`studentLabel`, `initialsFor`) finns i
  `js/lib/names.js` och används av alla lägen så att initial-läget
  fungerar överallt.
