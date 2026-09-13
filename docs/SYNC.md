# Sync-API — lärarfönster ↔ elevskärm

Elevskärmen är ett eget fönster (eller helskärm i samma fönster) som
renderar samma mode-moduler i **elevvy-läge** (`ctx.view === "student"`).
Detta dokument är kontraktet för hur de två fönstren pratar med
varandra. Lägena (Morgonskärm, Lektionsplanering, Trafikljusur) bygger
mot detta — sync-lagret själv ändras inte per läge.

## Tre kanaler, tre jobb

| Kanal | Jobb | Persistens |
|---|---|---|
| **Sync-bussen** (`js/sync.js`) | Omedelbara händelser: lägesbyte, timerstart/-stopp, presence | Efemär — försvinner vid omladdning |
| **Datalagret** (`js/data/datalayer.js`) | Allt innehåll: listor, planeringar, inställningar | Persistent (localStorage + ev. Firestore) |
| **`storage`-eventet** | Datalagrets och klassvalets live-spegling mellan fönster | — |

Tumregel: **innehåll** går via datalagret (elevskärmen ser ändringen
via `ctx.data.watch`); **händelser** ("nu startade timern", "byt läge")
går via sync-bussen. Ska något överleva en omladdning av elevskärmen
måste det ligga i datalagret — bussen är bara ett rör.

Transport: `BroadcastChannel` när webbläsaren har den (alla moderna),
annars faller bussen automatiskt tillbaka på `localStorage`-eventet.
Ingen molnväg — allt sker i webbläsaren.

## Bussens API

Mode-moduler får bussen som **`ctx.sync`** i `mount` (se
docs/MODULKONTRAKT.md):

```js
ctx.sync.publish(type, payload)      // till ALLA andra fönster (aldrig sitt eget)
const off = ctx.sync.on(type, cb);   // cb({ type, payload, from, at })
// off() i unmount — alltid!
```

## Meddelandetyper

### Kärnan (äger appkärnan — publicera inte dessa själv)

| Typ | Riktning | Payload | När |
|---|---|---|---|
| `state` | lärare → alla | `{ classId }` | Vid varje klassbyte i lärarvyn, och som svar på `state:request` |
| `present` | lärare → alla | `{ modeId }` | Läraren skickar ut ett läge ("Visa på elevskärm"), och som svar på `state:request` |
| `state:request` | elev → lärare | — | Nyöppnad elevskärm vill ha aktuellt tillstånd |
| `teacher:ping` | lärare → alla | — | Varannan sekund (presence) |
| `student:hello` / `student:pong` / `student:bye` | elev → lärare | — | Presence-livstecken |

**Läget är frikopplat från lärarens navigering.** Lärarens flikbyte
(`store.modeId`) byter INTE läge på elevskärmen — elevskärmen står kvar
på det senast utskickade läget. Läraren trycker aktivt ut ett läge med
"Visa på elevskärm" (panelen i lärarvyn), vilket publicerar `present`
med `modeId`; elevskärmen byter då hash och routern remountar läget.
**Lägen behöver ingen egen följ-läraren-logik** — de blir remountade
med rätt `ctx`.

`state` bär numera bara **klassvalet**, som alltid följer med automatiskt
(samma aktiva klass överallt). Vid `state:request` (nyöppnad elevskärm
eller förhandsvisning) svarar läraren med både klassval och det
utskickade läget; första gången sätts ett rimligt startläge (lärarens
nuvarande elev-visningsbara läge, annars morgonskärm). `presentedMode` i
storen speglar det utskickade läget för indikator/förhandsvisning i
lärarvyn.

### Lägesegna händelser

Egna typer namnges under lägets id: **`<modeId>:<händelse>`**, t.ex.

```js
// Lärarvyn i trafikljus-läget:
ctx.sync.publish("trafikljus:timer", timerState); // starta/pausa/ändra
ctx.sync.publish("trafikljus:timer", null);       // stoppa

// Elevvyn i samma läge:
const off = ctx.sync.on("trafikljus:timer", ({ payload }) => render(payload));
```

Regler:

1. Payload = ren JSON (structured clone — inga funktioner/DOM-noder).
2. **Lärarvyn publicerar, elevvyn lyssnar.** Elevvyn publicerar aldrig
   lägeshändelser (den har inga kontroller).
3. Räkna med att elevskärmen kan ha missat allt (nyss öppnad):
   persistenta saker läses ur datalagret vid mount; rent efemära
   händelser får läraren skicka om vid behov (eller läget spara sitt
   "senaste" i datalagret).
4. Avregistrera i `unmount`.

## Presence — "är elevskärmen öppen?"

Lärarvyn ser i `store.get().studentOpen` (och prenumererar via
`store.subscribe(["studentOpen"], …)`) om en elevskärm är öppen.
Skötts helt av appkärnan: elevfönstret annonserar sig
(`announceStudentScreen`), lärarfönstret pingar och vaktar
(`watchStudentScreen`). Indikatorn syns i topbarens Elevskärm-knapp
och i elevskärmspanelen.

Förhandsvisnings-iframen i lärarvyn kör elevvyn med `?preview=1` i
URL:en — den är **tyst** i presence-protokollet och räknas aldrig som
öppen elevskärm. Kod som bara ska köra i riktiga fönster kan fråga
`isPreviewWindow()` (`js/sync.js`).

## Timer — bakgrundssäker tid (`js/lib/timer.js`)

Bygg ALL nedräkning på detta, aldrig på egna `setInterval`-räknare —
webbläsare stryper timers i bakgrundsfönster och tiden driftar.
Tillståndet är rena tidsstämplar och därmed både syncbart och
sparbart:

```js
import { createTimerState, pauseTimer, resumeTimer, adjustTimer,
         remainingMs, isFinished, formatMs, createTicker } from "../lib/timer.js";

let t = createTimerState(10 * 60_000);            // 10 min från nu
ctx.sync.publish("trafikljus:timer", t);          // elevskärmen får exakt samma klocka
const stop = createTicker(() => el.textContent = formatMs(remainingMs(t)));
// unmount: stop();
```

`createTicker` är bara en ritsignal (den ritar om direkt när fliken
blir synlig igen) — återstående tid beräknas alltid från `Date.now()`
mot `startedAt`, så den är korrekt även efter minuter i bakgrunden.

## Spärren — lärarmaterial når aldrig elevskärmen

Fyra lager, alla aktiva samtidigt:

1. **Routern** vägrar montera annat än `STUDENT_MODE_IDS`
   (`js/modes/registry.js`: morgon, lektion, trafikljus) i elevvyn —
   även om någon skriver `#/elev/elever` för hand.
2. **Utskicks-logiken** (`present`) skickar bara ut elev-visningsbara
   lägen: "Visa på elevskärm" är avstängd på Elevlista/Översikt, och
   elevskärmen byter aldrig till ett lärarläge även om ett `present`
   med sådant modeId skulle nå fram. Dessutom byter lärarens vanliga
   flikbyte aldrig läge ute — eleverna ser bara det läraren aktivt
   skickat ut.
3. **Mode-modulerna** förgrenar på `ctx.view` och renderar aldrig
   noteringar/kontroller i elevvyn (MODULKONTRAKT regel 4).
4. **CSS-skyddsnätet**: allt lärarmaterial märks `.teacher-only` och
   `html[data-theme="student"] .teacher-only { display:none !important }`
   släcker det om lager 3 skulle fallera. Märk ALLA noterings-/
   panelytor med klassen. Topbaren får dessutom `hidden` i elevvyn.

## Enskärmsläge & helskärm

- **Två skärmar** (normalfallet): "Öppna elevskärm" (topbar eller
  panel) öppnar det namngivna fönstret `classroom-student-view` —
  läraren drar det till projektorn. Dubbelklick i elevfönstret växlar
  helskärm.
- **En skärm**: "Helskärm här" i panelen byter samma fönster till
  elevvy + helskärm. Esc (eller lämnad helskärm) tar läraren tillbaka
  till exakt det läge hen stod i.
