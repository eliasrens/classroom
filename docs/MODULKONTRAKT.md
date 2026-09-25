# Modulkontrakt — vad varje läge implementerar

Varje läge (Morgonskärm, Lektionsplanering, Trafikljusur, Elevlista,
Översikt) är EN ES-modul i `js/modes/` som **default-exporterar** ett
objekt med denna yta. Kontraktet gör att de fem lägena kan byggas
parallellt utan att röra varandra eller appkärnan.

```js
export default {
  id: "trafikljus",        // stabilt id — används i URL (#/trafikljus) och registret
  title: "Trafikljusur",   // visas i lägesmenyn
  icon: "signal",          // ikonnamn ur js/lib/icons.js (linje-SVG, ALDRIG emoji)

  /**
   * Rendera läget in i el (en tom behållare i <main>, display: contents —
   * layoutmässigt som om du renderade direkt i <main>).
   * mount och unmount har en tidsgräns i routern (STEP_TIMEOUT_MS, 3 s):
   * ett läge som hänger eller kraschar loggas och routern går vidare, så
   * navigeringen låser sig aldrig (issue #25). Vänta därför ALDRIG på nät
   * i mount — rendera direkt från lokal data och uppdatera via watch.
   * Anropas när läget aktiveras — och IGEN vid klassbyte samt vid
   * växling lärarvy ↔ elevvy (alltid med unmount() emellan).
   * Lägen behöver alltså ingen egen klassbyteslogik.
   *
   * ctx = {
   *   view,        // 'teacher' | 'student' — rendera rätt vy härifrån.
   *                //   teacher: kompakt arbetsvy (lärarens laptop)
   *                //   student: projektorvy — få element, stor text
   *   activeClass, // klassdokumentet { id, name, … } eller null
   *   store,       //  globalt tillstånd (js/store.js): classId, modeId, view, syncState, studentOpen
   *   data,        //  datalagret (js/data/datalayer.js): list/get/put/patch/remove/watch
   *   sync,        //  sync-bussen (js/sync.js): publish/on — omedelbara händelser
   *                //  lärare→elevskärm, t.ex. timerstart. Kontrakt: docs/SYNC.md
   * }
   */
  async mount(el, ctx) {},

  /**
   * Städa upp ALLT mount startade: timers, data.watch-prenumerationer,
   * event-lyssnare utanför el. Routern tömmer el efteråt.
   * Registrera städningen INNAN du startar något (inte sist i mount):
   * unmount anropas även för ett läge vars mount kraschade/hängde halvvägs.
   */
  async unmount() {},
};
```

## Regler

1. **Registrering**: modulen importeras i `js/modes/registry.js`
   (platshållarna är redan registrerade — ersätt filens innehåll,
   behåll `id`).
2. **Data**: läs/skriv ENBART via `ctx.data` med paths ur
   `DATAMODELL.md`, alltid under vald klass:
   `classes/${ctx.activeClass.id}/…`. Hantera `activeClass === null`
   (ingen klass vald) med ett vänligt tomläge — krascha aldrig.
3. **Live-uppdatering**: använd `ctx.data.watch(path, cb)` i stället
   för engångsläsning när vyn ska följa ändringar (t.ex. elevskärmen
   som speglar lärarens ändringar). Avregistrera i `unmount`.
4. **Elevvyn** nås på `#/elev/<id>` (knappen "Elevskärm" öppnar den i
   eget fönster). Samma modul renderar båda vyerna — förgrena på
   `ctx.view`. Elevvyn får INTE innehålla interaktiva lärarverktyg
   eller noteringar. Märk dessutom ALLT lärarmaterial i din markup med
   klassen `teacher-only` (CSS-skyddsnätet släcker den i elevvyn) och
   lyssna/publicera händelser enligt sync-kontraktet i `docs/SYNC.md`.
   Bara lägen i `STUDENT_MODE_IDS` (registry) kan renderas i elevvyn.
   Nedräkningar/klockor: använd `js/lib/timer.js` (tidsstämpelbaserad,
   bakgrundssäker) — aldrig egna tick-räknare.
5. **Elevnamn**: visa ALLTID namn via `studentLabel()`/`initialsFor()`
   i `js/lib/names.js` (endast förnamn + valfri tag; initial-läget
   styrs av klassinställningen `settings/display`, se DATAMODELL.md).
   Rendera aldrig `firstName` rått — då bryts initial-reservläget.
6. **Styling & designspråk**: använd designtokens (`css/tokens.css`).
   Lägesspecifik CSS läggs i `css/modes/<id>.css` och länkas från
   `index.html`. Ämnesfärger + läsbar textfärg: `subjectStyle()` i
   `js/lib/color.js`. Formspråket är vuxet och återhållsamt — det
   gäller HELA epiken:
   - Lärarvyn är MÖRK som standard (ljust alternativ togglas i
     topbaren via `data-scheme="light"`); skriv mot tokens, aldrig
     hårdkodade färger, så följer läget båda schemana.
   - INGA emoji i gränssnittet (knappar, rubriker, etiketter, menyer)
     — behövs en ikon: `icon()` i `js/lib/icons.js` (linje-SVG,
     currentColor). Emoji är tillåtet ENBART som pedagogiskt innehåll
     riktat till eleverna på elevskärmen, och sparsamt.
   - Inga gradienter, ingen pillerform på knappar/flikar, inga tunga
     skuggor — avgränsa med kantlinjer (`--color-line`) och måttliga
     radier (`--radius-s/m/l`). EN accentfärg: `--color-accent`
     (ytor) / `--color-accent-text` (färgad text).
7. **Ingen global state utanför store**: det ett läge vill dela med
   andra lägen går via datalagret (persistent) — inte via egna
   globala variabler.
