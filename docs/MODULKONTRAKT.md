# Modulkontrakt — vad varje läge implementerar

Varje läge (Morgonskärm, Lektionsplanering, Trafikljusur, Elevlista,
Översikt) är EN ES-modul i `js/modes/` som **default-exporterar** ett
objekt med denna yta. Kontraktet gör att de fem lägena kan byggas
parallellt utan att röra varandra eller appkärnan.

```js
export default {
  id: "trafikljus",        // stabilt id — används i URL (#/trafikljus) och registret
  title: "Trafikljusur",   // visas i lägesmenyn
  icon: "🚦",              // emoji i lägesmenyn

  /**
   * Rendera läget in i el (en tömd <main>).
   * Anropas när läget aktiveras — och IGEN vid klassbyte samt vid
   * växling lärarvy ↔ elevvy (alltid med unmount() emellan).
   * Lägen behöver alltså ingen egen klassbyteslogik.
   *
   * ctx = {
   *   view,        // 'teacher' | 'student' — rendera rätt vy härifrån.
   *                //   teacher: kompakt arbetsvy (lärarens laptop)
   *                //   student: projektorvy — få element, stor text
   *   activeClass, // klassdokumentet { id, name, … } eller null
   *   store,       //  globalt tillstånd (js/store.js): classId, modeId, view, syncState
   *   data,        //  datalagret (js/data/datalayer.js): list/get/put/patch/remove/watch
   * }
   */
  async mount(el, ctx) {},

  /**
   * Städa upp ALLT mount startade: timers, data.watch-prenumerationer,
   * event-lyssnare utanför el. Routern tömmer el efteråt.
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
   `ctx.view`. Elevvyn får INTE innehålla interaktiva lärarverktyg.
5. **Styling**: använd designtokens (`css/tokens.css`). Lägesspecifik
   CSS läggs i `css/modes/<id>.css` och länkas från `index.html`.
   Ämnesfärger + läsbar textfärg: `subjectStyle()` i `js/lib/color.js`.
6. **Ingen global state utanför store**: det ett läge vill dela med
   andra lägen går via datalagret (persistent) — inte via egna
   globala variabler.
