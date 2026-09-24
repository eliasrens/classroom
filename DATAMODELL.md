# Datamodell — Firestore-struktur

Samma pathsyntax används av det lokala datalagret (`js/data/datalayer.js`),
så modellen gäller oavsett om Firebase är anslutet eller ej.

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

classes/{classId}/students/{studentId}  — elev i klassen
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

classes/{classId}/notes/{noteId}        — noteringar om elever (Läge 4)
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

classes/{classId}/settings/{key}        — inställningar per klass
                                          (dokument-id = inställningens namn,
                                           t.ex. "schedule", "morningScreen")
  value: { … }

classes/{classId}/settings/morningScreen — Läge 1:s tillstånd (js/lib/morning.js)
  value: { greeting, tasks, showNametavla, background,
           praise: [ { id, kind: "student", studentId } | { id, kind: "free", text } ],
           weekOf: "2026-W39" }
                     — praise = Bra jobbat-listan. weekOf = ISO-veckan listan
                       hör till. Första gången appen öppnas en NY vecka
                       arkiveras listan och töms (se Veckorytm nedan). Saknad
                       weekOf (äldre data) = innevarande vecka.

classes/{classId}/praiseArchive/{weekOf} — ögonblicksbild av förra veckans Bra jobbat
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
  }
                     — bakåtkompatibelt: en äldre config utan typ
                       ({ yellowSec, redSec } på toppnivån) läses som
                       "overgang" och skrivs om till typad form vid
                       nästa ändring. Saknad typ får standardvärden.

classes/{classId}/settings/trafikljusState — Läge 3:s live-tillstånd
  value: { timer: { startedAt, pausedAt|null } | null,
           kind: "overgang" | "datorer" }
                     — speglas till elevskärmen (även via sync-bussen);
                       kind styr gränserna och etiketten "Datorer"

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
  påverkas inte (loggas med `console.info`). Övriga fel = synkstatus
  `offline`; kön försöker igen vid nästa skrivning, `online`-event eller
  när en server-snapshot kommer tillbaka.
- Test: `node docs/test-outbox.mjs` (två fönster, 20 snabba skrivningar,
  flush från flera håll, med och utan Web Locks, med konflikter samt
  med en gammal array-outbox).

## Delat kontra privat

- **DELAT mellan alla inloggade lärare** (läs+skriv, realtid via
  onSnapshot): klasser, elever, noteringar, pass/resultat och
  klassinställningar (allt under `classes/{classId}`). En lärare ser
  alla andras noteringar på eleverna, sparade pass och delade
  inställningar.
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
- **Bra jobbat** (`settings/morningScreen → praise`) är ett tillstånd, inte en
  logg. Första öppningen en ny vecka skriver `praiseArchive/{weekOf}` och
  tömmer listan (`weekOf` = den nya veckan) i EN Firestore-transaktion mot
  serverns version (`data.once`, `js/lib/week-rhythm.js`). Öppnar flera lärare
  samtidigt gör bara den första tömningen, så den sker exakt en gång per vecka.
  Vyerna visar aldrig förra veckans lista, inte heller innan tömningen hunnit
  sparas (t.ex. offline).
- **Lektionsplaneringar rörs aldrig** av veckorytmen.
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
