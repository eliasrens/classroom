# Widgets — API (epic #114)

Del 1 (issue #115) är grunden: register, datamodell, körtillstånd,
inställnings-UI och rendering. Den första widgeten är **Klocka (digital)**;
del 2 (#116) lägger till **Klocka (analog)** och klockornas inställningar;
del 3 (#117) lägger till timrarna **Kvar av lektionen** och **Nedräkning**.
Del 2–4 (klockor, timrar, ljudnivå) bygger på det som står här.

| Fil | Jobb |
|---|---|
| `registry.js` | Typlistan (`TYPES`) + ren normalisering och platslogik (ingen DOM, testas i Node) |
| `runtime.js` | Körtillstånd per klass + widget (timrar, vald ljudnivå) — lokalt, tidsstämplar |
| `host.js` | Rendering: brickor i lektionens rubrikrad, hörn på Morgonskärmen |
| `settings-ui.js` | Kryssrutor, "+ Lägg till", plats/storlek, typens egna inställningar |
| `clock-digital.js` | Klocka (digital) — mall för nya typer (#115; sekunder/datum #116) |
| `clock-analog.js` | Klocka (analog) — skolklocka i SVG (#116) |
| `clock-shared.js` | Klockornas ritsignal (`createClockTicker`), svenska datum, av/på-kryssrutor |
| `timers.js` | Kvar av lektionen + Nedräkning (#117): rendering, knappar, inställningar |
| `timer-logic.js` | Timrarnas rena logik: vad som visas nu, urtavlans tårtbit, tonens fönsterval (Node-testad) |
| `chime.js` | Mjuk ton med Web Audio + vilket fönster som spelar den |
| `css/ui/widgets.css` | Alla widget-stilar |

## En ny widget-typ

1. Skapa `js/widgets/<typ>.js` som exporterar ett objekt:

```js
export default {
  id: "timer",                 // unikt, sparas i datan — byt aldrig
  name: "Timer",               // visas i kryssrutan
  icon: "clock",               // namn i js/lib/icons.js
  multiple: true,              // true = "+ Lägg till" (flera instanser)
  defaults: () => ({ title: "", minutes: 5, sound: false }),
  normalize: (cfg) => ({ ... }),          // valfri; standard { ...defaults(), ...cfg }

  renderChip(el, cfg, ctx) { ... },       // kompakt bricka i lektionens rubrikrad
  renderLarge(el, cfg, ctx) { ... },      // stor form i ett hörn på Morgonskärmen
  destroy(el) { ... },                    // städa allt render* satte upp i el (tickers, lyssnare)

  settingsHTML(cfg, ctx) { return `...`; },           // valfri, färdig HTML
  bindSettings(root, cfg, onChange, ctx) { ...; return cleanup; }, // valfri
};
```

2. Lägg till den i `TYPES` i `registry.js` (en rad). Klart — den dyker upp i
   båda inställningssektionerna och renderas i båda lägena.

### ctx i render*

```js
{
  view: "teacher" | "student",
  classId, widgetId,
  form: "chip" | "large",
  size: "s" | "m" | "l" | null,          // bara Morgonskärmen
  runtime: { read(), write(state), watch(cb) → off },  // körtillståndet för DENNA instans
}
```

- **Rita aldrig räknare med egen `setInterval`** — använd `createTicker`
  (`js/lib/timer.js`) som ritsignal och räkna tiden ur tidsstämplar.
  Klockorna ritar precis vid sekund-/minutskiftet med `createClockTicker`
  (`clock-shared.js`): en väntan i taget, omräknad från `serverNow()`,
  stoppar sig själv om elementet försvunnit — `clock-digital.js` är mönstret.
- Tid: `serverNow()` (`js/lib/clock.js`).
- Respektera `prefers-reduced-motion` i egna animationer.
- `destroy(el)` MÅSTE stoppa tickers och `runtime.watch`-lyssnare: brickorna
  monteras om varje gång tavlan ritas om (varje tangenttryck i formuläret).

### Storlek

- **Bricka:** ärver ämnesfärgen (`--subj`, `--subj-ink`, `--subj-deep`) och
  typsnittsstorleken från tavlan (räkna i `em`). Ytan har `contain: size` och
  `overflow: hidden` — en bricka kan aldrig göra rubrikraden högre eller
  påverka `fitBoard`, men den klipps om den är för stor.
- **Stor:** `.mw` sätter `--mw-font` efter S/M/L (redan multiplicerad med
  `--morgon-scale`) och `font-size: var(--mw-font)`. Räkna i `em`. Glaset
  (bakgrund, oskärpa, ram) kommer från `.mw`.

### Klockorna (#116)

| Typ | cfg (standard) | Ritas om |
|---|---|---|
| `clock-digital` | `{ seconds: false, date: false }` | varje sekund med sekunder, annars varje minut |

- **Datum bara på Morgonskärmen** (#119): lektionens formulär visar inte
  "Visa datum" (`settingsHTML(cfg, { form })`), och brickan i rubrikraden
  visar aldrig datum — även om `cfg.date` råkar vara sparat.
| `clock-analog` | `{ seconds: false }` (sekundvisare) | varje sekund med sekundvisare, annars varje minut |

- Alltid 24 timmar (`formatClock`), datum i lång form "tisdag 29 september"
  (`formatDate`, utan Intl — samma i alla webbläsare och i Node).
- Analoga: visarnas vinklar räknas i `handAngles(now, { seconds })`;
  `unwrapAngle` gör att 59 → 0 tickar framåt. Visarna tickar med en kort
  CSS-övergång som bara finns med `prefers-reduced-motion: no-preference`
  och slås på först efter första bilden (ingen inflygning vid omritning).
  Färgerna är CSS-variabler (`--wa-face`, `--wa-ink`, `--wa-second` …):
  glaset på Morgonskärmen, `--subj-ink` i rubrikbrickan. Brickans urtavla
  är lika hög som rubrikraden; container-frågor visar bara 12/3/6/9 på en
  liten tavla och bara timstreck på en mycket liten.

### Timrarna (#117)

| Typ | cfg (standard) | Körtillstånd |
|---|---|---|
| `time-left` "Kvar av lektionen" (en) | `{ look: "digits", sound: false, until: "" }` | inget — följer klockan |
| `countdown` "Nedräkning" (flera) | `{ title: "", minutes: 5, seconds: 0, look: "digits", sound: false }` | runtime-stämplarna (`startTimer` …) |

- `look`: `digits` (mm:ss), `bar` (stapel som krymper), `analog` ("Time
  Timer": röd tårtbit moturs från 12 på en 60-minuterstavla, krymper medurs
  mot 0; mer än 60 min kvar = hel skiva).
- **Kvar av lektionen**: i lektionen räknar den mot planeringens `end` i dag
  (`ctx.lesson` = `{ date, start, end }`, som `chipsHTML(list, plan)` bär på
  `.lb-widgets`). Före `start`: "Börjar om N min"; efter `end`: "Slut".
  Planering en annan dag: "Börjar fre 2/10" / "Slut" (ingen ton). På
  Morgonskärmen: lärarens klockslag `until`. Typen heter "Nedräkning till
  klockslag" där (`names: { morning }` — settings-ui visar `names[form]`).
- **Nedräkning**: Start / Paus·Fortsätt / Återställ i inställningarna och som
  små knappar på brickan (lager vid hover/fokus) och på den stora widgeten —
  bara i lärarvyn. Återställ = `runtime.write(null)` (tillbaka till inställd tid).
- **Vad som visas** räknas i `timer-logic.js` (`lessonLeftView`, `untilView`,
  `countdownView`) → `{ status, text, label, fraction, dial, endMs, alarm }`.
  Renderingen ritar bara ut den, var 250:e ms (`createClockTicker`).
- **Trång rubrikrad**: timerbrickorna släpper det minst viktiga i steg
  (`fitRow`, `data-wt-fit` på `.lb-widgets`): "Kvar", kortad rubrik, ingen
  rubrik, "Tiden är ute" → "0:00", vänsterställt. Siffrorna kortas aldrig.
- **Slut**: färgmarkering + lugn pulsering första minuten (`ALARM_MS`), ingen
  puls med `prefers-reduced-motion`. "Tiden är ute" (+ "0:00"/"Slut").
- **Ton** (`sound`, AV från början): Web Audio, ingen ljudfil. Spelas i
  EXAKT ett fönster: elevskärmen om den är öppen och får spela ljud, annars
  lärarfönstret (som väntar 1,5 s när en elevskärm är öppen och bara spelar
  om ingen tagit tonen). Aldrig i förhandsvisningen (`?preview`). "Tagen"
  lagras lokalt per widget och slut (`classroom:local:widgets-chime/…`), så
  en omladdning spelar den inte igen; ett slut äldre än 15 s spelas inte.

### Egna inställningar

`settingsHTML` ritas under instansen. `bindSettings(root, cfg, onChange)`
kopplar egna fält; `onChange(nyCfg)` sparar UTAN att sektionen byggs om, så
fältet behåller fokus. Inställningar är ingen elevdata och inget körtillstånd
(en timers *längd* är inställning, att den *går* är körtillstånd).

## Datamodell

- **Lektionen** — `plan.widgets = [{ id, type, cfg }]` i planeringen
  (`normalizePlan`, `js/modes/lektion.js`; standard `[]`). Följer med i
  Kopiera och Skicka kopia med **nya id:n** (`copyLessonWidgets`) så att
  kopian får eget körtillstånd. Högst 3 brickor visas (`MAX_CHIPS`, de
  första i listan); formuläret varnar när fler är ikryssade.
- **Morgonskärmen** — `widgets = [{ id, type, slot, size, cfg }]` i klassens
  DELADE `settings/morningScreen` (`js/lib/morning.js`). `slot` ∈
  `tl | tr | bl | br`, `size` ∈ `s | m | l`. Två widgets har aldrig samma
  plats (`normalizeMorningWidgets` flyttar en krock till nästa lediga hörn).
- Okända typer behålls vid normalisering men renderas inte — en äldre flik
  ska aldrig radera en nyare typs data.
- Typer som inte är `multiple` finns högst en gång per lista.

## Körtillstånd (`runtime.js`)

Lokalt, aldrig i molnet: `localStorage["classroom:local:widgets/{classId}/{widgetId}"]`.
Synk mellan lärar- och elevfönster via storage-eventet (docs/SYNC.md) +
lyssnare i samma fönster. Lagra TIDSSTÄMPLAR, aldrig en räknare:

```js
import { startTimer, pauseTimer, resumeTimer, adjustTimer, remainingMs,
         isRunning, isPaused, isFinished, formatMs } from "./runtime.js";

let t = startTimer(5 * 60_000);      // { durationMs, startedAt, pausedAt: null, endsAt }
ctx.runtime.write(t);                 // → elevfönstret ser samma timer direkt
t = pauseTimer(t);                    // pausedAt satt, endsAt null
t = resumeTimer(t);                   // startedAt/endsAt flyttas med pausens längd
const off = ctx.runtime.watch((s) => render(remainingMs(s)));
```

Ljudnivåskylten sparar sitt val på samma sätt: `ctx.runtime.write({ level: 2 })`.
Skriv körtillstånd bara från lärarens kontroller — aldrig från elevvyn eller
förhandsvisningen.

## Hörnplatser på Morgonskärmen

`createCornerLayer` lägger `.morgon__widgets` i `.morgon` (med öppen
lärarpanel börjar lagret till höger om panelen, som kortet). Efter varje
ändring och storleksändring körs `resolveSlots` (#119):

1. Widgeten står där läraren valt, i vald storlek, om den inte skymmer
   kortet eller Bra jobbat-tavlan (4 px marginal).
2. Annars **krymps den i sitt hörn** till största skala som ryms, ner till
   storlek S (`--mw-k` på `.mw`, multipliceras in i `--mw-font`).
3. Först när inte ens S ryms flyttas den till närmaste hörn där den ryms
   (närmast = avstånd mellan hörnen, så på en bred skärm rakt upp/ner först).
   Ryms den ingenstans döljs den.

Den analoga klockan (`shape: "round"` på typen) räknas som cirkeln i sin
kvadrat — kvadratens tomma hörn får gå in över kortets hörn.

Panelen visar en rad under widgeten när den krymps, flyttas eller döljs
("Mindre för att inte skymma kortet.", "Flyttad till uppe till höger — skulle
skymma Bra jobbat-tavlan."). Elevskärmen har en annan yta än lärarens fönster
(ingen verktygsrad eller panel, större namn på Bra jobbat), så den delar sitt
resultat lokalt (`createPlacementSharer` → körtillståndets nyckel
`…/{classId}/_placement`) och panelen visar "På elevskärmen: …" medan den är
öppen. Förhandsvisningen delar aldrig.

I ett upptaget hörn går det att välja en widget — de två byter plats.

## Test

`node docs/test-widgets.mjs` — normalisering, `normalizePlan`, kopior,
platskrockar (krymp i hörnet före flytt, rund klocka, panelens rader,
elevskärmens delade platser) och runtime-tidsstämplar. Varje ny del lägger till en egen svit:
`node docs/test-clock-widgets.mjs` (#116) — visarvinklar, formatering,
inställningar, ritsignalen och att `destroy` inte lämnar några timrar.
`node docs/test-timers.mjs` (#117) — kvarvarande tid, paus/fortsätt,
omladdning, kvar av lektionen före/under/efter, två timrar samtidigt,
urtavlan och att tonen spelas i ett fönster, en gång.
