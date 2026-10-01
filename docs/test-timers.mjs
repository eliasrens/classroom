/**
 * TEST — widgets, timrar (issue #117): js/widgets/timer-logic.js + de två
 * typerna i registret (js/widgets/timers.js) + runtime-tidsstämplarna.
 *
 *   node docs/test-timers.mjs
 *
 * Kontrollerar:
 *   - registret: "Kvar av lektionen" (en) och "Nedräkning" (flera) finns
 *   - inställningarna: standard (rubrik tom, ljud AV, siffror), normalisering
 *   - kvarvarande tid, formatering (mm:ss, h:mm:ss, avrundning uppåt)
 *   - paus och fortsätt (pausen räknas inte), omladdning = samma stämplar
 *   - "kvar av lektionen" före, under och efter (+ annan dag, ingen sluttid)
 *   - Morgonskärmens klockslag
 *   - två timrar samtidigt (oberoende körtillstånd)
 *   - urtavlans tårtbit (60 min, moturs från 12)
 *   - tonen: bara ETT fönster, bara en gång, aldrig i förhandsvisningen
 */

// ---- Attrapp för localStorage (runtime + tonens nyckel) ----
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
  clear: () => mem.clear(),
};
globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const L = await import("../js/widgets/timer-logic.js");
const rt = await import("../js/widgets/runtime.js");
const reg = await import("../js/widgets/registry.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Lokal tid i dag kl. hh:mm:ss (ms). */
const at = (h, m, s = 0, base = new Date(2026, 8, 30)) => {
  const d = new Date(base);
  d.setHours(h, m, s, 0);
  return d.getTime();
};
const TODAY = "2026-09-30";

// ---------------------------------------------------------------------------
// Registret + inställningar
// ---------------------------------------------------------------------------
{
  const left = reg.widgetType("time-left");
  const cd = reg.widgetType("countdown");
  ok(left?.name === "Kvar av lektionen", "Kvar av lektionen finns");
  ok(cd?.name === "Nedräkning", "Nedräkning finns");
  ok(left && !left.multiple, "Kvar av lektionen finns högst en gång");
  ok(cd?.multiple === true, "Nedräkning får finnas flera gånger");
  for (const t of [left, cd]) {
    for (const k of ["id", "name", "icon", "defaults", "renderChip", "renderLarge", "destroy", "settingsHTML", "bindSettings"]) {
      ok(t && k in t, `${t?.id} har ${k}`);
    }
  }
  const d = reg.normalizeCfg("countdown", null);
  ok(d.title === "", "rubriken är tom från början");
  ok(d.sound === false, "ljudet är AVSTÄNGT från början (nedräkning)");
  ok(reg.normalizeCfg("time-left", null).sound === false, "ljudet är AVSTÄNGT från början (kvar av lektionen)");
  ok(d.look === "digits" && d.minutes === 5 && d.seconds === 0, "standard: 5:00, siffror");
  ok(cd.settingsHTML(d, {}).includes('placeholder="Rubrik (valfritt)"'), "platshållaren är 'Rubrik (valfritt)'");

  const n = L.normalizeCountdownCfg({ minutes: "7", seconds: 75, look: "pie", sound: "ja", title: 3 });
  ok(n.minutes === 7 && n.seconds === 59, "minuter som sträng, sekunder högst 59");
  ok(n.look === "digits", "okänt utseende → siffror");
  ok(n.sound === false, "ljud bara om exakt true");
  ok(n.title === "", "rubrik som inte är text → tom");
  ok(L.normalizeCountdownCfg({ minutes: 0, seconds: 0 }).minutes === 1, "0:00 blir 1 min");
  ok(L.normalizeCountdownCfg({ minutes: 999 }).minutes === L.MAX_MINUTES, "längst MAX_MINUTES");
  ok(L.normalizeTimeLeftCfg({ until: "9:05" }).until === "09:05", "klockslag normaliseras till HH:MM");
  ok(L.normalizeTimeLeftCfg({ until: "25:00" }).until === "", "ogiltigt klockslag → tomt");

  // Flera nedräkningar i samma lektion; bara en "Kvar av lektionen".
  const list = reg.normalizeLessonWidgets([
    { id: "a", type: "countdown", cfg: { minutes: 3 } },
    { id: "b", type: "countdown", cfg: { minutes: 10, title: "Läsning" } },
    { id: "c", type: "time-left" },
    { id: "d", type: "time-left" },
  ]);
  ok(eq(list.map((w) => w.id), ["a", "b", "c"]), "två nedräkningar + en kvar av lektionen");
  ok(list[1].cfg.title === "Läsning", "rubriken följer med");

  const { chipsHTML } = await import("../js/widgets/host.js");
  const html = chipsHTML(list, { date: TODAY, start: "10:00", end: "10:40", name: "x" });
  ok(html.includes("data-lesson=") && html.includes("10:40"), "brickorna bär lektionens tid (ctx.lesson)");
  ok(!chipsHTML([], { end: "10:40" }), "utan widgets ingen markup");
}

// ---------------------------------------------------------------------------
// Kvarvarande tid + formatering
// ---------------------------------------------------------------------------
{
  ok(L.formatRemaining(5 * 60_000) === "5:00", "5:00");
  ok(L.formatRemaining(61_000) === "1:01", "1:01");
  ok(L.formatRemaining(200) === "0:01", "0,2 s kvar visas som 0:01 (uppåt)");
  ok(L.formatRemaining(0) === "0:00", "0:00");
  ok(L.formatRemaining(-5) === "0:00", "aldrig negativt");
  ok(L.formatRemaining(3_725_000) === "1:02:05", "över en timme: h:mm:ss");

  const cfg = L.normalizeCountdownCfg({ minutes: 5 });
  const t0 = 1_000_000;
  const idle = L.countdownView(cfg, null, t0);
  ok(idle.status === "idle" && idle.text === "5:00" && idle.fraction === 1, "inte startad: visar inställd tid");
  ok(idle.endMs == null, "inte startad: inget slut (ingen ton)");

  const s = rt.startTimer(L.countdownDurationMs(cfg), t0);
  const v = L.countdownView(cfg, s, t0 + 90_000);
  ok(v.status === "running" && v.text === "3:30", "går: 3:30 kvar efter 1,5 min");
  ok(Math.abs(v.fraction - 0.7) < 1e-9, "stapeln: 70 % kvar");
  ok(v.endMs === t0 + 300_000, "slutet = start + längd");
  ok(Math.abs(v.dial - 210_000 / L.DIAL_MS) < 1e-9, "urtavlan: andel av 60 min");

  const done = L.countdownView(cfg, s, t0 + 300_000);
  ok(done.status === "done" && done.text === "0:00", "slut: 0:00");
  ok(done.label === "Tiden är ute", "slut: 'Tiden är ute'");
  ok(done.alarm === true, "nyss slut: pulserar");
  ok(L.countdownView(cfg, s, t0 + 300_000 + L.ALARM_MS).alarm === false, "efter en stund: bara färgmarkering");
}

// ---------------------------------------------------------------------------
// Paus och fortsätt — och omladdning
// ---------------------------------------------------------------------------
{
  const cfg = L.normalizeCountdownCfg({ minutes: 2 });
  const t0 = 5_000_000;
  let s = rt.startTimer(120_000, t0);
  s = rt.pauseTimer(s, t0 + 30_000);
  const p = L.countdownView(cfg, s, t0 + 90_000);
  ok(p.status === "paused" && p.text === "1:30", "pausad: tiden står still (1:30)");
  ok(p.endMs == null, "pausad: inget slut (ingen ton)");
  ok(p.label === "Pausad", "pausad: 'Pausad'");
  s = rt.resumeTimer(s, t0 + 90_000);
  const r = L.countdownView(cfg, s, t0 + 100_000);
  ok(r.status === "running" && r.text === "1:20", "fortsätt: pausen räknas inte (1:20)");
  ok(r.endMs === t0 + 180_000, "fortsätt: slutet flyttas med pausens längd");

  // Omladdning: samma stämplar i lagringen → samma tid.
  rt.writeRuntime("klass", "cd-reload", s, t0 + 100_000);
  const reloaded = rt.readRuntime("klass", "cd-reload");
  ok(L.countdownView(cfg, reloaded, t0 + 110_000).text === "1:10", "omladdning mitt i: fortsätter rätt");
  ok(eq(L.countdownView(cfg, reloaded, t0 + 110_000), L.countdownView(cfg, s, t0 + 110_000)),
    "lärar- och elevfönster (samma stämplar) visar exakt samma sak");
}

// ---------------------------------------------------------------------------
// "Kvar av lektionen" — före, under, efter
// ---------------------------------------------------------------------------
{
  const lesson = { date: TODAY, start: "10:00", end: "10:40" };

  const before = L.lessonLeftView(lesson, at(9, 55));
  ok(before.status === "before", "före: status before");
  ok(before.text === "Börjar om 5 min", "före: 'Börjar om 5 min'");
  ok(L.lessonLeftView(lesson, at(9, 54, 30)).text === "Börjar om 6 min", "före: minuterna avrundas uppåt");
  ok(L.lessonLeftView(lesson, at(8, 0)).text === "Börjar kl. 10:00", "mer än en timme före: klockslaget");

  const during = L.lessonLeftView(lesson, at(10, 25));
  ok(during.status === "running" && during.text === "15:00", "under: 15:00 kvar");
  ok(Math.abs(during.fraction - 15 / 40) < 1e-9, "under: stapeln mot lektionens längd");
  ok(during.endMs === at(10, 40), "under: slutet = plan.end i dag");

  const after = L.lessonLeftView(lesson, at(10, 40));
  ok(after.status === "done" && after.text === "Slut", "efter: 'Slut'");
  ok(after.label === "Tiden är ute" && after.alarm, "efter: 'Tiden är ute', pulserar nyss efter");
  ok(L.lessonLeftView(lesson, at(11, 30)).alarm === false, "långt efter: ingen puls");

  // Annan dag
  const past = L.lessonLeftView({ ...lesson, date: "2026-09-29" }, at(9, 0));
  ok(past.text === "Slut" && past.endMs == null && !past.alarm, "tidigare dag: 'Slut', ingen ton, ingen puls");
  const later = L.lessonLeftView({ ...lesson, date: "2026-10-02" }, at(9, 0));
  ok(later.status === "later" && later.text === "Börjar fre 2/10", "senare dag: 'Börjar fre 2/10'");
  ok(later.endMs == null, "senare dag: ingen ton");

  // Utan datum/start, utan sluttid
  const noStart = L.lessonLeftView({ end: "10:40" }, at(10, 10));
  ok(noStart.status === "running" && noStart.text === "30:00", "utan start/datum: räknar mot sluttiden i dag");
  ok(L.lessonLeftView({ start: "10:00" }, at(10, 10)).status === "none", "utan sluttid: 'Ingen sluttid'");
  ok(L.lessonLeftView(null, at(10, 10)).text === "Ingen sluttid", "ingen lektion: 'Ingen sluttid'");
  ok(L.lessonLeftView({ start: "11:00", end: "10:40" }, at(10, 10)).status === "running", "start efter slut ignoreras");
}

// ---------------------------------------------------------------------------
// Morgonskärmen: klockslag
// ---------------------------------------------------------------------------
{
  const v = L.untilView("08:30", at(8, 10));
  ok(v.status === "running" && v.text === "20:00", "klockslag: 20:00 kvar");
  ok(Math.abs(v.dial - 20 / 60) < 1e-9, "klockslag: urtavlan 20 av 60 min");
  ok(L.untilView("10:30", at(8, 0)).dial === 1, "mer än 60 min kvar: hel tårtbit");
  ok(L.untilView("08:30", at(8, 31)).text === "Slut", "efter klockslaget: 'Slut'");
  ok(L.untilView("", at(8, 0)).status === "none", "inget klockslag valt");
}

// ---------------------------------------------------------------------------
// Två timrar samtidigt
// ---------------------------------------------------------------------------
{
  const t0 = 9_000_000;
  const a = L.normalizeCountdownCfg({ minutes: 3 });
  const b = L.normalizeCountdownCfg({ minutes: 10, title: "Läsning" });
  rt.writeRuntime("k2", "A", rt.startTimer(L.countdownDurationMs(a), t0), t0);
  rt.writeRuntime("k2", "B", rt.startTimer(L.countdownDurationMs(b), t0 + 60_000), t0 + 60_000);
  const view = (cfg, id, now) => L.countdownView(cfg, rt.readRuntime("k2", id), now);
  ok(view(a, "A", t0 + 120_000).text === "1:00", "A: 1:00 kvar");
  ok(view(b, "B", t0 + 120_000).text === "9:00", "B: 9:00 kvar samtidigt");
  // Pausa A — B påverkas inte.
  rt.writeRuntime("k2", "A", rt.pauseTimer(rt.readRuntime("k2", "A"), t0 + 120_000), t0 + 120_000);
  ok(view(a, "A", t0 + 240_000).text === "1:00", "A pausad står still");
  ok(view(b, "B", t0 + 240_000).text === "7:00", "B går vidare");
  ok(view(a, "A", t0 + 240_000).status === "paused" && view(b, "B", t0 + 240_000).status === "running", "olika lägen samtidigt");
  // "Kvar av lektionen" + en nedräkning i samma lektion
  const lesson = { date: TODAY, start: "10:00", end: "10:40" };
  const s = rt.startTimer(5 * 60_000, at(10, 20));
  ok(L.lessonLeftView(lesson, at(10, 22)).text === "18:00" && L.countdownView(b, s, at(10, 22)).text === "3:00",
    "kvar av lektionen och en nedräkning samtidigt");
  // Återställ A → B orörd
  rt.clearRuntime("k2", "A");
  ok(view(a, "A", t0 + 240_000).status === "idle", "Återställ: A tillbaka till inställd tid");
  ok(view(b, "B", t0 + 240_000).text === "7:00", "Återställ A rör inte B");
}

// ---------------------------------------------------------------------------
// Urtavlan
// ---------------------------------------------------------------------------
{
  ok(L.piePath(0) === "", "0 kvar: ingen tårtbit");
  ok(L.piePath(1).startsWith("M50 4A"), "60 min: hel skiva");
  const q = L.piePath(0.25); // 15 min → till kl. 9 (vänster), moturs från 12
  ok(q.startsWith("M50 50L50 4A46 46 0 0 0 4.000 50.000"), `15 min: kvartsbit till vänster (${q})`);
  const big = L.piePath(0.75);
  ok(/A46 46 0 1 0 /.test(big), "45 min: stora bågen");
  ok(L.piePath(2) === L.piePath(1), "över 60 min: hel skiva");
}

// ---------------------------------------------------------------------------
// Tonen — bara ett fönster, bara en gång
// ---------------------------------------------------------------------------
{
  const store = localStorage;
  const key = L.chimeKey("k3", "cd");
  const endMs = 20_000_000;

  ok(L.chimeRole({ view: "student" }) === "student", "elevskärmen: roll student");
  ok(L.chimeRole({ view: "student", preview: true }) === "never", "förhandsvisningen spelar aldrig");
  ok(L.chimeRole({ view: "teacher", studentOpen: true }) === "fallback", "lärarfönster med öppen elevskärm: reserv");
  ok(L.chimeRole({ view: "teacher", studentOpen: false }) === "teacher", "lärarfönster utan elevskärm: spelar");

  /** Ett fönster som tickar: räknar hur många gånger det spelar. */
  const windowSim = (role, audioReady = true) => {
    let plays = 0;
    return {
      get plays() { return plays; },
      tick(now, sound = true, end = endMs) {
        const step = L.chimeStep({ sound, endMs: end, now, role, audioReady, claimed: L.chimeClaimed(store, key, end) });
        if (step === "play" && L.claimChime(store, key, end)) plays++;
      },
    };
  };
  const run = (wins, from, to, end = endMs, sound = true) => {
    for (let t = from; t <= to; t += 250) for (const w of wins) w.tick(t, sound, end);
  };

  // 1) Elevskärm öppen och får spela → bara elevskärmen, en gång.
  store.removeItem(key);
  let stu = windowSim("student");
  let tea = windowSim("fallback");
  const prev = windowSim("never");
  run([tea, stu, prev], endMs - 2000, endMs + 20_000);
  ok(stu.plays === 1, "elevskärmen spelar tonen en gång");
  ok(tea.plays === 0, "lärarfönstret spelar inte när elevskärmen gjort det");
  ok(prev.plays === 0, "förhandsvisningen spelar inte");

  // 2) Elevskärm öppen men tyst (inget klick) → lärarfönstret, en gång.
  store.removeItem(key);
  stu = windowSim("student", false);
  tea = windowSim("fallback");
  run([stu, tea], endMs - 1000, endMs + 20_000);
  ok(stu.plays === 0 && tea.plays === 1, "tyst elevskärm: lärarfönstret tar tonen, en gång");

  // 3) Ingen elevskärm → lärarfönstret direkt.
  store.removeItem(key);
  tea = windowSim("teacher");
  let firstAt = null;
  for (let t = endMs - 1000; t <= endMs + 5000; t += 250) {
    tea.tick(t);
    if (tea.plays && firstAt == null) firstAt = t;
  }
  ok(tea.plays === 1 && firstAt === endMs, "utan elevskärm: lärarfönstret spelar direkt vid slutet");

  // 4) Två lärarflikar utan elevskärm → ändå bara en ton.
  store.removeItem(key);
  const t1 = windowSim("teacher");
  const t2 = windowSim("teacher");
  run([t1, t2], endMs, endMs + 5000);
  ok(t1.plays + t2.plays === 1, "två lärarflikar: en ton totalt");

  // 5) Omladdning efter slutet → ingen ny ton; långt efter → tyst.
  const reloaded = windowSim("student");
  run([reloaded], endMs + 3000, endMs + 10_000);
  ok(reloaded.plays === 0, "omladdning efter tonen: spelar inte igen");
  store.removeItem(key);
  const late = windowSim("teacher");
  run([late], endMs + L.CHIME_WINDOW_MS + 1000, endMs + L.CHIME_WINDOW_MS + 5000);
  ok(late.plays === 0, "öppnat långt efter slutet: tyst");

  // 6) Ljud av (standard) → aldrig.
  store.removeItem(key);
  const off = windowSim("teacher");
  run([off], endMs, endMs + 5000, endMs, false);
  ok(off.plays === 0, "ljud avstängt: ingen ton");

  // 7) Ny körning (nytt slut) → en ny ton.
  store.removeItem(key);
  const again = windowSim("teacher");
  run([again], endMs, endMs + 3000);
  run([again], endMs + 60_000, endMs + 63_000, endMs + 60_000);
  ok(again.plays === 2, "ny körning efter Återställ + Start: ny ton");
}

console.log(`${passed} OK, ${failed} fel`);
if (failed) process.exit(1);
