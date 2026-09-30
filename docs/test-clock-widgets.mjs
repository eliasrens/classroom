/**
 * TEST — klockorna (issue #116): js/widgets/clock-digital.js,
 * clock-analog.js och clock-shared.js.
 *
 *   node docs/test-clock-widgets.mjs
 *
 * Kontrollerar:
 *   - visarvinklarna (handAngles) för givna tider, med och utan sekundvisare
 *   - unwrapAngle: 59 → 0 sekunder tickar framåt, aldrig ett varv bakåt
 *   - formateringen: HH:MM / HH:MM:SS (alltid 24 h), "tisdag 29 september"
 *   - inställningarna: standard av, normalisering, kryssrutorna
 *   - ritsignalen (createClockTicker) med falsk tid: tickar precis vid
 *     sekund-/minutskiftet, rättar sig efter serverNow(), och efter stop()
 *     finns inga timrar eller lyssnare kvar
 *   - hela widgetarna monterade i ett attrapp-element: visarna står rätt,
 *     texten stämmer, och destroy() lämnar inga läckande timrar
 */

// ---- Falsk tid: Date.now, setTimeout, requestAnimationFrame, document ----
let vnow = new Date(2026, 8, 29, 10, 10, 30).getTime();
const RealDate = Date;
Date.now = () => vnow;

let seq = 0;
const timers = new Map(); // id → { at, fn }
globalThis.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: vnow + Math.max(0, ms), fn }); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
globalThis.setInterval = () => { throw new Error("klockorna får inte använda setInterval"); };
const frames = new Map();
globalThis.requestAnimationFrame = (fn) => { const id = ++seq; frames.set(id, fn); return id; };
globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
function runFrames() {
  for (const [id, fn] of [...frames]) { frames.delete(id); fn(vnow); }
}
const docListeners = new Set();
globalThis.document = {
  hidden: false,
  addEventListener: (type, fn) => docListeners.add(fn),
  removeEventListener: (type, fn) => docListeners.delete(fn),
};
const liveDocListeners = () => docListeners.size;

/** Kör fram den falska klockan ms millisekunder och kör de timrar som förfaller. */
function advance(ms) {
  const end = vnow + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
    if (!next) break;
    timers.delete(next[0]);
    vnow = next[1].at;
    next[1].fn();
  }
  vnow = end;
}

const { handAngles, unwrapAngle, default: analog } = await import("../js/widgets/clock-analog.js");
const { formatClock, default: digital } = await import("../js/widgets/clock-digital.js");
const shared = await import("../js/widgets/clock-shared.js");
const { setServerOffset } = await import("../js/lib/clock.js");
const reg = await import("../js/widgets/registry.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const at = (h, m, s = 0) => new RealDate(2026, 8, 29, h, m, s).getTime();

// ---------------------------------------------------------------------------
// Visarvinklar
// ---------------------------------------------------------------------------
{
  const A = (h, m, s, opts) => handAngles(at(h, m, s), opts);
  ok(eq(A(12, 0, 0), { hour: 0, minute: 0, second: 0 }), "12:00 → alla visare rakt upp");
  ok(eq(A(0, 0, 0), { hour: 0, minute: 0, second: 0 }), "00:00 → alla visare rakt upp");
  ok(eq(A(3, 0, 0), { hour: 90, minute: 0, second: 0 }), "03:00 → timvisaren på 90°");
  ok(eq(A(15, 0, 0), A(3, 0, 0)), "15:00 = 03:00 (12-timmars urtavla)");
  ok(eq(A(6, 30, 0), { hour: 195, minute: 180, second: 0 }), "06:30 → timvisaren mitt mellan 6 och 7");
  ok(eq(A(9, 45, 0), { hour: 292.5, minute: 270, second: 0 }), "09:45 → 292,5° / 270°");
  ok(eq(A(18, 20, 0), { hour: 190, minute: 120, second: 0 }), "18:20 → 190° / 120°");
  ok(eq(A(23, 59, 0), { hour: 359.5, minute: 354, second: 0 }), "23:59 → 359,5° / 354°");
  // Utan sekundvisare: minutvisaren på hel minut (hoppar varje minut).
  ok(eq(A(10, 10, 30), { hour: 305, minute: 60, second: 180 }), "10:10:30 utan sekundvisare → minuten hel");
  // Med sekundvisare: minut- och timvisaren glider med sekunderna.
  ok(eq(A(10, 10, 30, { seconds: true }), { hour: 305.25, minute: 63, second: 180 }), "10:10:30 med sekundvisare");
  ok(eq(A(23, 59, 59, { seconds: true }).second, 354), "59 s → sekundvisaren på 354°");
  const all = [];
  for (let m = 0; m < 24 * 60; m += 7) all.push(A(Math.floor(m / 60), m % 60, m % 60, { seconds: true }));
  ok(all.every((a) => [a.hour, a.minute, a.second].every((v) => v >= 0 && v < 360)), "vinklarna alltid 0–<360");
}

// ---------------------------------------------------------------------------
// unwrapAngle — övergången går alltid kortaste vägen (framåt vid 59 → 0)
// ---------------------------------------------------------------------------
{
  ok(unwrapAngle(undefined, 42) === 42 && unwrapAngle(null, 0) === 0, "utan föregående → vinkeln som den är");
  ok(unwrapAngle(354, 0) === 360, "354° → 0° blir 360° (framåt, inte ett varv bakåt)");
  ok(unwrapAngle(360, 6) === 366, "360° → 6° blir 366°");
  ok(unwrapAngle(714, 0) === 720, "flera varv: 714° → 0° blir 720°");
  ok(unwrapAngle(90, 96) === 96 && unwrapAngle(96, 90) === 90, "små steg orörda");
  ok(unwrapAngle(359.5, 0) === 360, "timvisaren vid midnatt: 359,5° → 360°");
  let prev;
  let back = false;
  let same = true;
  for (let s = 0; s < 200; s++) {
    const v = unwrapAngle(prev, (s % 60) * 6);
    if (prev != null && v < prev) back = true;
    if (((v % 360) + 360) % 360 !== (s % 60) * 6) same = false;
    prev = v;
  }
  ok(same, "unwrap: alltid samma vinkel mod 360");
  ok(!back && prev === 199 * 6, "200 sekunder i följd: visaren går bara framåt");
}

// ---------------------------------------------------------------------------
// Formatering
// ---------------------------------------------------------------------------
{
  ok(formatClock(at(8, 5, 9)) === "08:05", "HH:MM utan sekunder (standard)");
  ok(formatClock(at(8, 5, 9), { seconds: true }) === "08:05:09", "HH:MM:SS med sekunder");
  ok(formatClock(at(14, 42, 0)) === "14:42", "24-timmars tid (14:42, inte 2:42)");
  ok(formatClock(at(0, 0, 0), { seconds: true }) === "00:00:00", "midnatt → 00:00:00");
  ok(formatClock(at(23, 59, 59), { seconds: true }) === "23:59:59", "23:59:59");
  const D = (y, mo, d) => shared.formatDate(new RealDate(y, mo, d, 12).getTime());
  ok(D(2026, 8, 29) === "tisdag 29 september", "datum: tisdag 29 september");
  ok(D(2026, 0, 1) === "torsdag 1 januari", "datum: torsdag 1 januari (ingen inledande nolla)");
  ok(D(2026, 9, 4) === "söndag 4 oktober", "datum: söndag");
  ok(D(2026, 9, 31) === "lördag 31 oktober", "datum: lördag");
  ok(D(2026, 4, 18) === "måndag 18 maj", "datum: måndag 18 maj");
  ok(D(2026, 11, 24) === "torsdag 24 december", "datum: december");
  ok(shared.isoDate(at(9, 0)) === "2026-09-29", "isoDate för <time datetime>");
  ok(shared.msToNextTick(at(10, 0, 0) + 250, 1000) === 750, "nästa sekundskifte om 750 ms");
  ok(shared.msToNextTick(at(10, 0, 30), 60_000) === 30_000, "nästa minutskifte om 30 s");
  ok(shared.msToNextTick(at(10, 0, 0), 60_000) === 60_000, "precis på skiftet → en hel period");
}

// ---------------------------------------------------------------------------
// Registret och inställningarna
// ---------------------------------------------------------------------------
{
  ok(reg.widgetType("clock-analog") === analog, "Klocka (analog) finns i registret");
  ok(analog.name === "Klocka (analog)" && analog.multiple === false, "analog: namn, bara en instans");
  for (const t of [digital, analog]) {
    for (const k of ["id", "name", "icon", "defaults", "renderChip", "renderLarge", "destroy", "settingsHTML", "bindSettings"]) {
      ok(k in t, `${t.id} har ${k}`);
    }
  }
  ok(eq(digital.defaults(), { seconds: false, date: false }), "digital: sekunder och datum av som standard");
  ok(eq(analog.defaults(), { seconds: false }), "analog: sekundvisaren av som standard");
  ok(eq(reg.normalizeCfg("clock-digital", { seconds: "ja", date: true }), { seconds: false, date: true }), "digital: bara true räknas som på");
  ok(eq(reg.normalizeCfg("clock-analog", null), { seconds: false }), "analog: saknad cfg → standard");
  ok(reg.normalizeCfg("clock-analog", { seconds: true, framtid: 1 }).framtid === 1, "okända cfg-fält behålls");
  const w = reg.createMorningWidget("clock-analog", []);
  ok(w && w.slot === "tl" && eq(w.cfg, { seconds: false }), "ny analog klocka på Morgonskärmen");
  ok(eq(reg.normalizeLessonWidgets([{ id: "a", type: "clock-analog" }, { id: "b", type: "clock-analog" }]).map((x) => x.id), ["a"]),
    "analog klocka högst en gång");

  const html = digital.settingsHTML({ seconds: true, date: false });
  ok(/data-wopt="seconds" checked/.test(html) && !/data-wopt="date" checked/.test(html), "kryssrutorna speglar cfg");
  ok(/Visa sekunder/.test(html) && /Visa datum/.test(html), "digital: Visa sekunder, Visa datum");
  ok(/Visa sekundvisare/.test(analog.settingsHTML({})), "analog: Visa sekundvisare");

  // bindSettings: ändringar ackumuleras (fältet sparas utan att sektionen byggs om).
  let handler = null;
  const root = { addEventListener: (t, fn) => { handler = fn; }, removeEventListener: (t, fn) => { if (fn === handler) handler = null; } };
  const saved = [];
  const off = digital.bindSettings(root, { seconds: false, date: false }, (c) => saved.push(c));
  handler({ target: { dataset: { wopt: "seconds" }, checked: true } });
  handler({ target: { dataset: { wopt: "date" }, checked: true } });
  handler({ target: { dataset: {} } });
  ok(eq(saved, [{ seconds: true, date: false }, { seconds: true, date: true }]), "bindSettings: varje ändring sparar hela cfg");
  off();
  ok(handler === null, "bindSettings: cleanup tar bort lyssnaren");
}

// ---------------------------------------------------------------------------
// Ritsignalen
// ---------------------------------------------------------------------------
{
  vnow = at(10, 10, 30) + 400;
  const seen = [];
  const stop = shared.createClockTicker((now) => seen.push(now), { periodMs: 1000 });
  ok(seen.length === 1, "tickar direkt vid start");
  advance(600 + 19);
  ok(seen.length === 1, "inte före sekundskiftet (+marginal)");
  advance(1);
  ok(seen.length === 2 && new RealDate(seen[1]).getSeconds() === 31, "tickar precis efter sekundskiftet");
  advance(10_000);
  ok(seen.length === 12, "en gång per sekund");
  ok(seen.slice(1).every((t, i, a) => i === 0 || new RealDate(t).getSeconds() !== new RealDate(a[i - 1]).getSeconds()),
    "varje tick är en ny sekund (ingen sekund två gånger)");
  ok(timers.size === 1 && liveDocListeners() === 1, "bara en timer och en synlighetslyssnare åt gången");

  // Omkalibrering: tiden hoppar 400 ms → ritas direkt och väntan räknas om.
  const before = seen.length;
  setServerOffset(400);
  ok(seen.length === before + 1, "omkalibrerad klocka → ritas direkt");
  ok(timers.size === 1, "fortfarande bara en timer efter omkalibrering");
  setServerOffset(0);

  stop();
  ok(timers.size === 0, "stop(): inga timrar kvar");
  ok(liveDocListeners() === 0, "stop(): synlighetslyssnaren borttagen");
  const after = seen.length;
  setServerOffset(1000);
  advance(5000);
  ok(seen.length === after, "stop(): tickar aldrig mer (inte ens vid omkalibrering)");
  setServerOffset(0);

  // Minut: utan sekunder ritas klockan bara om vid minutskiftet.
  vnow = at(10, 10, 30);
  const mins = [];
  const stopMin = shared.createClockTicker((now) => mins.push(now), { periodMs: 60_000 });
  advance(5 * 60_000);
  ok(mins.length === 1 + 5, "per minut: 5 minuter → 5 omritningar (+ den första)");
  ok(mins.slice(1).every((t) => new RealDate(t).getSeconds() === 0), "omritningen sker vid minutskiftet");
  stopMin();
  ok(timers.size === 0, "per minut: inga timrar kvar efter stop()");

  // Bortplockat element utan destroy → stoppar av sig självt.
  const el = { isConnected: true };
  let n = 0;
  shared.createClockTicker(() => n++, { periodMs: 1000, el });
  advance(2500);
  const seenWhileConnected = n;
  el.isConnected = false;
  advance(5000);
  ok(seenWhileConnected === 3 && n === 3 && timers.size === 0 && liveDocListeners() === 0, "element borta ur dokumentet → tickern stoppar sig själv");
}

// ---------------------------------------------------------------------------
// Widgetarna monterade (attrapp-element)
// ---------------------------------------------------------------------------
function fakeEl() {
  const nodes = new Map();
  const has = (html, cls) => new RegExp(`class="([^"]*\\s)?${cls}(\\s|")`).test(html);
  const el = {
    isConnected: true,
    html: "",
    set innerHTML(h) { this.html = h; nodes.clear(); },
    get innerHTML() { return this.html; },
    querySelector(sel) {
      const cls = sel.replace(/^\./, "");
      if (!has(this.html, cls)) return null;
      if (!nodes.has(cls)) {
        const classes = new Set();
        nodes.set(cls, {
          style: {}, textContent: "", dateTime: "", attrs: {},
          setAttribute(k, v) { this.attrs[k] = v; },
          classList: { add: (c) => classes.add(c), contains: (c) => classes.has(c) },
          querySelector: (s) => el.querySelector(s),
        });
      }
      return nodes.get(cls);
    },
    get firstElementChild() { return this.querySelector(this.html.match(/class="([^" ]+)/)[1]); },
  };
  return el;
}
const deg = (node) => Number(node.style.transform?.match(/rotate\((-?[\d.]+)deg\)/)?.[1]);

{
  // Analog med sekundvisare, 10:10:30.
  vnow = at(10, 10, 30);
  const el = fakeEl();
  analog.renderLarge(el, { seconds: true });
  const root = el.firstElementChild;
  ok(/wanalog--large/.test(el.html), "analog stor: rätt form");
  const nums = [...el.html.matchAll(/<text[^>]*>(\d+)<\/text>/g)].map((m) => Number(m[1]));
  ok(eq(nums, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), "urtavlan har siffrorna 1–12");
  ok((el.html.match(/wanalog__tick--hour/g) ?? []).length === 12 && (el.html.match(/class="wanalog__tick[ "]/g) ?? []).length === 60,
    "60 minutstreck, varav 12 timstreck");
  ok(deg(el.querySelector("wanalog__hand--hour")) === 305.25, "timvisaren 305,25°");
  ok(deg(el.querySelector("wanalog__hand--minute")) === 63, "minutvisaren 63°");
  ok(deg(el.querySelector("wanalog__hand--second")) === 180, "sekundvisaren 180°");
  ok(root.attrs["aria-label"] === "Klockan är 10:10:30", "skärmläsartext med tiden");
  ok(!root.classList.contains("wanalog--live"), "ingen övergång före första bilden");
  runFrames(); runFrames();
  ok(root.classList.contains("wanalog--live"), "övergången slås på efter första bilden");
  advance(30_020);
  ok(deg(el.querySelector("wanalog__hand--second")) === 360, "sekundvisaren 59 → 0 tickar fram till 360°");
  ok(deg(el.querySelector("wanalog__hand--minute")) === 66, "minutvisaren på 10:11 → 66°");
  analog.destroy(el);
  ok(timers.size === 0 && frames.size === 0 && liveDocListeners() === 0, "analog destroy(): inga timrar, bildrutor eller lyssnare kvar");

  // Utan sekundvisare: ingen sekundvisare, ritas om per minut.
  vnow = at(10, 10, 30);
  const el2 = fakeEl();
  analog.renderChip(el2, {});
  ok(/wanalog--chip/.test(el2.html) && !/wanalog__hand--second/.test(el2.html), "analog bricka: ingen sekundvisare som standard");
  ok(deg(el2.querySelector("wanalog__hand--minute")) === 60, "utan sekundvisare: minutvisaren på hel minut");
  advance(29_000);
  ok(deg(el2.querySelector("wanalog__hand--minute")) === 60, "… står still inom minuten");
  advance(1_100);
  ok(deg(el2.querySelector("wanalog__hand--minute")) === 66, "… hoppar vid minutskiftet");
  ok(timers.size === 1, "utan sekundvisare: en timer (till nästa minut)");
  // Monteras om (tavlan ritas om vid varje tangenttryck) → fortfarande bara en timer.
  for (let i = 0; i < 5; i++) analog.renderChip(el2, {});
  ok(timers.size === 1 && liveDocListeners() === 1, "ommontering läcker inga timrar eller lyssnare");
  analog.destroy(el2);
  ok(timers.size === 0 && frames.size === 0 && liveDocListeners() === 0, "analog bricka destroy(): allt städat");
}

{
  // Digital: sekunder + datum.
  vnow = at(9, 5, 7);
  const el = fakeEl();
  digital.renderLarge(el, { seconds: true, date: true });
  ok(el.querySelector("wclock__time").textContent === "09:05:07", "digital med sekunder: 09:05:07");
  ok(el.querySelector("wclock__date").textContent === "tisdag 29 september", "digital med datum: tisdag 29 september");
  ok(el.querySelector("wclock__date").dateTime === "2026-09-29", "datumets datetime");
  advance(1020);
  ok(el.querySelector("wclock__time").textContent === "09:05:08", "digital med sekunder: nästa sekund");
  digital.destroy(el);
  ok(timers.size === 0 && liveDocListeners() === 0, "digital destroy(): inga timrar kvar");

  vnow = at(23, 59, 30);
  const el2 = fakeEl();
  digital.renderChip(el2, {});
  ok(el2.querySelector("wclock__time").textContent === "23:59" && !el2.querySelector("wclock__date"), "standard: HH:MM, inget datum");
  advance(30_100);
  ok(el2.querySelector("wclock__time").textContent === "00:00", "midnatt: 00:00");
  digital.renderChip(el2, { date: true });
  ok(el2.querySelector("wclock__date").textContent === "onsdag 30 september", "datumet byts vid midnatt");
  digital.destroy(el2);
  ok(timers.size === 0, "digital bricka destroy(): inga timrar kvar");
}

console.log(`${passed} OK, ${failed} fel`);
if (failed) process.exit(1);
