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
går via sync-bussen.

Exempel: "Visa på elevskärm" i elevskärmspanelen skickar ut *läget*
(bussen) och — via lägets `onPresent()` (issue #88, se nedan) — *vilken
sak* läget visar. För Lektionsplanering är saken vilken planering:
innehåll, som skrivs till lärarens privata
`teachers/{uid}/classes/{cid}/settings/lektion` i datalagret (issue #39).
Elevskärmen delar lärarens uid och ser bytet via `watch`; vilken
planering läraren redigerar når aldrig elevskärmen. Ska något överleva en omladdning av elevskärmen
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

### En enda regel: knappen skickar ut EXAKT det läraren tittar på (issue #88)

"Visa på elevskärm" är den ENDA utskicksknappen. Den skickar ut läget
OCH — för lägen med "flera saker" (Lektionsplanering: vilken planering;
Tankekarta: vilken karta) — den sak läraren har öppen. Ingenting ändras
för eleverna förrän läraren trycker igen: byte av flik, planering eller
karta rör aldrig elevskärmen.

Ett läge med flera saker implementerar det så här (js/lib/present.js):

- **`onPresent()`** (valfri metod på modulen, sätts i mount i lärarvyn,
  nollas i unmount): panelen anropar den FÖRE `present`-publiceringen.
  Läget persistar då sin öppna sak som utskickad — Lektionsplanering
  skriver `presentedPlanId` (privat, datalagret), Tankekartan skriver
  `presented` i sitt lokala `state`-dokument — så att en elevskärm som
  byter läge eller laddas om läser rätt sak.
- **`store.presentSpot`** = `{ modeId, current, presented }` (`current`/
  `presented` = `{ id, label }` eller null): lägets levande rapport om
  vad som är öppet och vad som är utskickat. Panelen räknar ut sin färg
  ur den: **grön** ("Visas för eleverna") bara när eleverna ser exakt
  samma sak (samma läge OCH samma sak), annars **guld**; raden
  "Eleverna ser:" visar sakens namn ("Lektionsplanering · Bråk intro").
  Lägen utan flera saker (Trafikljus, Skrivtavla, Lottning, Veckan) rör
  varken `onPresent` eller `presentSpot` — samma läge räcker för grönt.
- Ändringar i den UTSKICKADE saken syns fortfarande live (innehåll via
  datalagret respektive `karta:state` på bussen).

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

Ett läge med "sidor" följer samma mönster: Veckans övergångar
(`js/modes/vecka.js`) publicerar `vecka:view` med `{ week, kind, page }`
när läraren bläddrar, och sparar samma värde i `settings/vecka` så att
en nyöppnad elevskärm hamnar på rätt sida (regel 3). I enskärmsläget
("Helskärm här") är elevvyn lärarens eget fönster — där tar läget emot
bläddertangenterna och publicerar själv (`isSingleScreenWindow()`,
`js/sync.js`); ett separat elevfönster gör det aldrig.

Skrivtavlan (`js/modes/skriv.js`, issue #46) skickar hela sitt tillstånd
som `skriv:state` vid varje tangenttryckning (text, markör, storlek,
Följ, scroll som RADNUMMER) och sparar det med debounce i den ENDAST
LOKALA `classes/{cid}/skriv/board` — texten kan innehålla elevnamn och
går aldrig till Firestore. `rev` ordnar bussen mot storage-eventet: en
sen sparning får aldrig skriva över nyare text på elevskärmen.

Lottningen (`js/modes/lotta.js`, issue #47): LÄRAREN avgör resultatet
(`crypto.getRandomValues` utan modulo-bias) och skickar

```js
ctx.sync.publish("lotta:draw", {
  stage, // scenen: { rev, seq, method, listKey, kind, items: [{ label, color? }], result, angle, reelIndex }
  draw,  // { seq, method, list, resultIndex, seed, from, to, start, land, startedAt }
});
ctx.sync.publish("lotta:stage", stage); // byte av lista/sätt, ångra — ingen animation
```

Elevskärmen spelar upp exakt samma animation (hjulets vinkel `from`→`to`,
rullens rad `start`→`land`, lapparnas skakning ur `seed`) i
`js/modes/lotta/stage.js` och landar på samma resultat. Den startar
`Date.now() - startedAt` in i animationen; en sent öppnad elevskärm visar
resultatet direkt. Scenen sparas även i den ENDAST LOKALA
`classes/{cid}/lotta/stage` (namn → aldrig Firestore); `rev` ordnar bussen
mot storage-eventet som hos Skrivtavlan. Elevskärmen får bara scenens
alternativ och resultat — aldrig listorna, frånvaron eller "Redan dragna".

Tankekartan (`js/modes/karta.js`, issue #53) skickar den UTSKICKADE
kartan (issue #88 — inte nödvändigtvis den läraren har öppen) vid varje
ändring (ny/borttagen/flyttad/ändrad bubbla, rubriken medan läraren
skriver, "Visa på elevskärm"):

```js
ctx.sync.publish("karta:state", { cid, cur, map: { id, title, cloud, bubbles }, rev });
// bubbles: [{ id, text, color, parentId, pin? }] — grenar och färger (issue #59).
// Lärarens markering (vald bubbla) skickas aldrig: elevskärmen har ingen.
```

Elevskärmen ritar samma karta (`js/modes/karta/scene.js`) och
räknar layouten själv i sitt eget bildformat. Kartorna sparas i den ENDAST
LOKALA `classes/{cid}/karta` (bubblorna kan innehålla elevnamn → aldrig
Firestore); en omladdad elevskärm läser `state.presented` (den utskickade
kartan, issue #88; äldre state utan nyckeln faller tillbaka på `state.cur`)
och kartan därifrån. Lärarens kartbyte ändrar alltså inget för eleverna —
bara "Visa på elevskärm" gör det.
`rev` ordnar bussen mot storage-eventet som hos Skrivtavlan. Elevskärmen
får bara rubriken och bubblorna — aldrig kartlistan eller namnen i den.

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
   (`js/modes/registry.js`: morgon, lektion, trafikljus, skriv, karta, lotta, vecka) i elevvyn —
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
