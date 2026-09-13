# Datamodell — Firestore-struktur

Samma pathsyntax används av det lokala datalagret (`js/data/datalayer.js`),
så modellen gäller oavsett om Firebase är anslutet eller ej.

## Struktur

```
classes/{classId}                       — en klass (4A, 4B, …)
  name: "4A"

classes/{classId}/students/{studentId}  — elev i klassen
  firstName, lastName
  displayName        — visningsnamn (unikt i klassen, t.ex. "Elsa B")
  active: true       — false i stället för borttagning (historik bevaras)

classes/{classId}/lessonPlans/{planId}  — lektionsplanering (Läge 2)
  date: "2026-09-14" — ISO-datum; en planering per dag och klass är normalfallet
  blocks: [ { start, end, subjectId, title, note } ]

classes/{classId}/sessions/{sessionId}  — genomförda pass/resultat
                                          (trafikljuspass, aktiviteter; Läge 3/5)
  type: "trafikljus" | …
  startedAt, endedAt
  result: { … }      — passtypens egna data (t.ex. antal varningar)

classes/{classId}/notes/{noteId}        — noteringar om elever (Läge 4)
  studentId
  text
  createdBy          — lärarens uid/e-post
  createdAt

classes/{classId}/settings/{key}        — inställningar per klass
                                          (dokument-id = inställningens namn,
                                           t.ex. "schedule", "morningScreen")
  value: { … }

teachers/{uid}                          — lärarprofil (se docs/AUTH.md)
  email, displayName
  classIds: ["…"]    — klasser läraren undervisar (för behörighetsregler)
```

## Motivering

- **Allt klassdata under `classes/{id}`** — klassen är appens naturliga
  avgränsning: klassvalet i topbaren väljer i praktiken vilket subtree
  alla lägen läser/skriver. Det gör även Firestores säkerhetsregler
  enkla (behörighet per klass, se docs/AUTH.md) och håller lyssnare
  små (man prenumererar bara på vald klass).
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
