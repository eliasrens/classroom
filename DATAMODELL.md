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
  startedAt, endedAt
  result: { … }      — passtypens egna data (t.ex. antal varningar)
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

classes/{classId}/settings/elevlista    — Läge 4:s inställningar
  value: {
    defaultTypeId    — standardtyp för ett-trycks-notering ("prat" …)
    labels: [ { id, name, color } ]
                     — lärarens egna etiketter för anteckningar
                       (t.ex. positivt, följ upp, ring hem)
    sessionStart     — epoch ms; minneslistan visar noteringar efter
                       denna. "Nollställ inför nästa lektion" = nu.
  }

classes/{classId}/settings/display      — namnvisning (togglas i lärarvyn)
  value: { nameDisplay: "first" | "initials" }
                     — "initials" = reservläget: initialer räknas
                       fram ur förnamnet (js/lib/names.js), lagras ej

teachers/{uid}                          — lärarprofil (se docs/AUTH.md)
  email, displayName — skrivs/uppdateras automatiskt vid inloggning
                       (js/auth.js); displayName härleds ur e-postens
                       lokala del ("elias@…" → "Elias") och används för
                       attribution (createdByName) på pass/noteringar

teachers/{uid}/classes/{classId}/lessonPlans/{planId}
                     — lektionsplanering (Läge 2). PRIVAT per lärare:
                       ligger under lärarens uid, inte under den delade
                       klassnoden. Bara ägaren läser/skriver (firestore.rules).
  ownerUid           — lärarens uid (= {uid} i pathen; gör ägaren explicit)
  date: "2026-09-14" — ISO-datum; en planering per dag och klass är normalfallet
  name, subjectId, start, end
  fields: { … }      — planeringens innehåll (vad/hur/varför/…)
  show: { … }        — vilka fält som visas på tavlan
```

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
  datalagret på alla dokument och används för last-write-wins-merge
  vid synk.
- **Mjuk borttagning av elever** (`active: false`) så att gamla
  pass/noteringar aldrig pekar på obefintliga elever.
- **Endast förnamn på elever** — medvetet integritetsval: skärmen
  projiceras i klassrummet och data delas mellan lärare. Namnkrockar
  löses med den valfria `tag`-särskiljaren, aldrig med efternamn.
  Visningshjälpare (`studentLabel`, `initialsFor`) finns i
  `js/lib/names.js` och används av alla lägen så att initial-läget
  fungerar överallt.
