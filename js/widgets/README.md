# Widgets — API (epic #114)

Del 1 (issue #115) är grunden: register, datamodell, körtillstånd,
inställnings-UI och rendering. Den första widgeten är **Klocka (digital)**.
Del 2–4 (klockor, timrar, ljudnivå) bygger på det som står här.

| Fil | Jobb |
|---|---|
| `registry.js` | Typlistan (`TYPES`) + ren normalisering och platslogik (ingen DOM, testas i Node) |
| `runtime.js` | Körtillstånd per klass + widget (timrar, vald ljudnivå) — lokalt, tidsstämplar |
| `host.js` | Rendering: brickor i lektionens rubrikrad, hörn på Morgonskärmen |
| `settings-ui.js` | Kryssrutor, "+ Lägg till", plats/storlek, typens egna inställningar |
| `clock-digital.js` | Första typen — mall för nya typer |
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
  Klockan i `clock-digital.js` är mönstret.
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
ändring och storleksändring körs `resolveSlots`: en widget som skulle skymma
kortet eller Bra jobbat-tavlan flyttas till närmaste lediga hörn (närmast =
avstånd mellan hörnen, så på en bred skärm går den rakt upp/ner först). Finns
ingen ledig plats döljs den, och panelen säger det. Lärarens förhandsvisning
och elevskärmen kör samma kod.

## Test

`node docs/test-widgets.mjs` — normalisering, `normalizePlan`, kopior,
platskrockar och runtime-tidsstämplar. Varje ny del lägger till en egen svit.
