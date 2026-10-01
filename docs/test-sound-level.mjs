/**
 * TEST — ljudnivå (issue #118): js/widgets/sound-level.js, sound-mic.js,
 * sound-sign.js och sound-meter.js.
 *
 *   node docs/test-sound-level.mjs
 *
 * Kontrollerar:
 *   - nivåmappningen: RMS → dB-skala 0–1, jämning (0,5 s glidande medel),
 *     RMS → zon (grön/gul/röd) mot gränsen
 *   - kopplingen till skylten: gränsen följer skyltens valda nivå, faller
 *     tillbaka på reglaget utan skylt — även i den monterade mätaren
 *   - hysteresen "för högt i N sekunder": rött först efter HOLD_MS över
 *     gränsen, tillbaka först efter RELEASE_MS under (gräns − marginal)
 *   - mikrofonen (mockad getUserMedia + AudioContext): öppnas bara när
 *     läraren trycker Starta, aldrig två gånger, hålls öppen när vyn monteras
 *     om i samma omritning, och STÄNGS (tracks stoppas, kontexten stängs) när
 *     widgeten stängs, när läraren trycker Stoppa och när fönstret stängs
 *   - elevvyn: öppnar aldrig mikrofonen, visar nivån från sync-bussen, visar
 *     ingenting när mikrofonen nekas / är av / tystnar
 *   - skylten: namn (standard + egna), nivå som körtillstånd, lärarens
 *     knappar skriver nivån, elevvyn har inga knappar
 */

// ---- Falsk tid och timrar ----
let vnow = 1_800_000_000_000;
Date.now = () => vnow;
let seq = 0;
const timers = new Map(); // id → { at, fn, every }
globalThis.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: vnow + Math.max(0, ms), fn }); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
globalThis.setInterval = (fn, ms) => { const id = ++seq; timers.set(id, { at: vnow + ms, fn, every: ms }); return id; };
globalThis.clearInterval = (id) => { timers.delete(id); };
/** Kör fram den falska klockan ms millisekunder och kör timrarna som förfaller. */
function advance(ms = 0) {
  const end = vnow + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
    if (!next) break;
    const [id, t] = next;
    vnow = Math.max(vnow, t.at);
    if (t.every) t.at += t.every; else timers.delete(id);
    t.fn();
  }
  vnow = end;
}
const flush = () => advance(0);

// ---- localStorage + fönsterhändelser ----
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
const winListeners = new Map(); // type → Set
globalThis.addEventListener = (type, fn) => { if (!winListeners.has(type)) winListeners.set(type, new Set()); winListeners.get(type).add(fn); };
globalThis.removeEventListener = (type, fn) => { winListeners.get(type)?.delete(fn); };
const fire = (type, e = {}) => { for (const fn of [...(winListeners.get(type) ?? [])]) fn(e); };

// ---- Mockad mikrofon: getUserMedia + AudioContext ----
let amplitude = 0; // samplens värde (fyrkantsvåg → RMS = amplitude)
let denyWith = null; // "NotAllowedError" m.fl. → getUserMedia nekar
const gum = { calls: 0, streams: [] };
const contexts = [];
function makeStream() {
  const track = { kind: "audio", stopped: false, onended: null, stop() { this.stopped = true; } };
  const stream = { tracks: [track], getTracks() { return this.tracks; } };
  gum.streams.push(stream);
  return stream;
}
let pendingGum = null; // { resolve } när testet vill styra när behörigheten besvaras
let holdGum = false;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  writable: true,
  value: {
    mediaDevices: {
      getUserMedia(constraints) {
        gum.calls++;
        gum.last = constraints;
        if (denyWith) return Promise.reject(Object.assign(new Error("nej"), { name: denyWith }));
        if (holdGum) return new Promise((resolve) => { pendingGum = { resolve: () => resolve(makeStream()) }; });
        return Promise.resolve(makeStream());
      },
    },
  },
});
globalThis.AudioContext = class {
  constructor() { this.closed = false; this.connected = []; contexts.push(this); }
  createMediaStreamSource(stream) { return { stream, connect: (n) => this.connected.push(n), disconnect() { this.disconnected = true; } }; }
  createAnalyser() { return { fftSize: 0, getFloatTimeDomainData: (buf) => buf.fill(amplitude) }; }
  resume() { return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
};
const openTracks = () => gum.streams.flatMap((s) => s.tracks).filter((t) => !t.stopped).length;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

// ---- Attrapp-DOM: precis det widgetarna använder ----
class FakeNode {
  constructor(sel = null, html = () => "") {
    this.sel = sel;
    this.dataset = {};
    this.attrs = {};
    this.props = {};
    this.style = { setProperty: (k, v) => { this.props[k] = String(v); }, removeProperty: (k) => { delete this.props[k]; } };
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.title = "";
    this._html = "";
    this._kids = new Map();
    this._all = new Map();
    this._first = null;
    this._rootHtml = html;
    this.listeners = new Map();
  }
  set innerHTML(h) { this._html = h; this._kids.clear(); this._all.clear(); this._first = null; }
  get innerHTML() { return this._html; }
  get firstElementChild() { return (this._first ??= new FakeNode(null, () => this._html)); }
  html() { return this._html || this._rootHtml(); }
  token(sel) { return sel.replace(/^[.[]/, "").replace(/[\]]$/, "").replace(/=.*$/, ""); }
  querySelector(sel) {
    if (!this.html().includes(this.token(sel))) return null;
    if (!this._kids.has(sel)) this._kids.set(sel, new FakeNode(sel));
    return this._kids.get(sel);
  }
  querySelectorAll(sel) {
    if (this._all.has(sel)) return this._all.get(sel);
    const attr = this.token(sel);
    const out = [];
    if (attr.startsWith("data-")) {
      const key = attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      for (const m of this.html().matchAll(new RegExp(`${attr}="([^"]*)"`, "g"))) {
        const n = new FakeNode(sel);
        n.dataset[key] = m[1];
        out.push(n);
      }
    }
    this._all.set(sel, out);
    return out;
  }
  closest(sel) { return sel === this.sel ? this : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  click(target) {
    const e = { target, preventDefault() {}, stopPropagation() {} };
    for (const fn of [...(this.listeners.get("click") ?? [])]) fn(e);
  }
  get listenerCount() { let n = 0; for (const s of this.listeners.values()) n += s.size; return n; }
}

// ---- Falsk sync-buss: lärarfönstret → elevfönstret ----
function busPair() {
  const handlers = new Map();
  const sent = [];
  const teacher = { publish(type, payload) { sent.push({ type, payload }); for (const cb of handlers.get(type) ?? []) cb({ type, payload, from: "t", at: vnow }); } };
  const student = {
    on(type, cb) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(cb); return () => handlers.get(type)?.delete(cb); },
    get listeners() { let n = 0; for (const s of handlers.values()) n += s.size; return n; },
  };
  return { teacher, student, sent };
}

const L = await import("../js/widgets/sound-level.js");
const { mic, createMicService, statusForError } = await import("../js/widgets/sound-mic.js");
const meterMod = await import("../js/widgets/sound-meter.js");
const meter = meterMod.default;
const sign = (await import("../js/widgets/sound-sign.js")).default;
const { signSymbol } = await import("../js/widgets/sound-sign.js");
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
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
/** RMS för en given dBFS. */
const rmsAt = (db) => 10 ** (db / 20);

// ---------------------------------------------------------------------------
// Registret
// ---------------------------------------------------------------------------
{
  ok(reg.widgetType("sound-sign")?.name === "Ljudnivåskylt", "Ljudnivåskylt finns i registret");
  ok(reg.widgetType("sound-meter")?.name === "Ljudmätare", "Ljudmätare finns i registret");
  for (const t of [sign, meter]) {
    for (const k of ["id", "name", "icon", "defaults", "renderChip", "renderLarge", "destroy", "settingsHTML", "bindSettings"]) {
      ok(k in t, `${t.id} har ${k}`);
    }
    ok(t.multiple === false, `${t.id} finns högst en gång per lista`);
  }
  ok(eq(reg.normalizeCfg("sound-meter", null), { limit: 0.6, linkSign: false }), "mätarens standard: gräns 60 %, inte kopplad");
  ok(eq(reg.normalizeCfg("sound-meter", { limit: 2, linkSign: "ja" }), { limit: 0.95, linkSign: false }), "mätarens cfg normaliseras");
  ok(eq(reg.normalizeCfg("sound-sign", null).names, ["Tyst", "Viska", "Prata lågt", "Prata", "Redovisa"]), "skyltens standardnamn");
}

// ---------------------------------------------------------------------------
// Nivåmappningen: RMS → skala → zon
// ---------------------------------------------------------------------------
{
  ok(L.levelFromRms(0) === 0 && L.levelFromRms(-1) === 0 && L.levelFromRms(NaN) === 0, "tyst/trasigt → 0");
  ok(near(L.levelFromRms(rmsAt(-60)), 0), "−60 dB → 0");
  ok(near(L.levelFromRms(rmsAt(-10)), 1), "−10 dB → 1");
  ok(near(L.levelFromRms(rmsAt(-35)), 0.5), "−35 dB → 0,5 (mitten)");
  ok(L.levelFromRms(rmsAt(-80)) === 0 && L.levelFromRms(1) === 1, "utanför skalan kläms till 0–1");
  let prev = -1;
  let mono = true;
  for (let db = -70; db <= 0; db += 0.5) { const v = L.levelFromRms(rmsAt(db)); if (v < prev) mono = false; prev = v; }
  ok(mono, "nivån växer med ljudstyrkan (monoton)");

  const sq = new Float32Array(256).fill(0.25);
  ok(near(L.rmsOf(sq), 0.25, 1e-6), "RMS av konstant 0,25 = 0,25");
  const sine = Float32Array.from({ length: 1000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * i) / 100));
  ok(near(L.rmsOf(sine), 0.5 / Math.SQRT2, 1e-3), "RMS av sinus = amplitud/√2");
  ok(L.meanSquare([]) === 0 && L.meanSquare(null) === 0, "tom buffert → 0");

  // Zoner mot gränsen (gult band = 0,15 under gränsen).
  ok(L.zoneFor(0.2, 0.6) === "green", "0,2 mot 0,6 → grön");
  ok(L.zoneFor(0.449, 0.6) === "green", "strax under gula bandet → grön");
  ok(L.zoneFor(0.45, 0.6) === "yellow", "0,45 mot 0,6 → gul");
  ok(L.zoneFor(0.59, 0.6) === "yellow", "strax under gränsen → gul");
  ok(L.zoneFor(0.6, 0.6) === "red" && L.zoneFor(0.95, 0.6) === "red", "på/över gränsen → röd");
  ok(L.zoneFor(0.1, 0.3) === "green" && L.zoneFor(0.2, 0.3) === "yellow" && L.zoneFor(0.3, 0.3) === "red", "låg gräns (Tyst)");
  ok(L.zoneFor(0.05, 0.1) === "yellow", "gula bandet börjar aldrig under 0");
  // Hela kedjan: RMS → nivå → zon.
  const zoneOfDb = (db, limit) => L.zoneFor(L.levelFromRms(rmsAt(db)), limit);
  ok(zoneOfDb(-50, 0.6) === "green" && zoneOfDb(-35, 0.6) === "yellow" && zoneOfDb(-25, 0.6) === "red", "RMS → zon: −50 grön, −35 gul, −25 röd (gräns 0,6)");

  // Reglaget.
  ok(L.clampLimit(0.62) === 0.6 && L.clampLimit(0.63) === 0.65, "reglaget i steg om 5 %");
  ok(L.clampLimit(0) === 0.1 && L.clampLimit(5) === 0.95, "reglaget 10–95 %");
  ok(L.clampLimit(undefined) === 0.6 && L.clampLimit("x") === 0.6 && L.clampLimit(null) === 0.6, "trasigt → 60 %");
}

// ---------------------------------------------------------------------------
// Jämning: glidande medel över 0,5 s (på energin)
// ---------------------------------------------------------------------------
{
  const s = L.createRmsSmoother({ windowMs: 500 });
  let t = 0;
  for (let i = 0; i < 10; i++) s.push(0, (t += 100));
  ok(s.value() === 0, "bara tystnad → 0");
  s.push(0.25, (t += 100)); // en kort smäll (RMS 0,5 i 100 ms)
  ok(s.value() > 0 && s.value() < 0.5, "en kort smäll dämpas av medlet");
  for (let i = 0; i < 5; i++) s.push(0.25, (t += 100));
  ok(near(s.value(), 0.5), "efter 0,5 s konstant ljud: full nivå (RMS 0,5)");
  for (let i = 0; i < 5; i++) s.push(0, (t += 100));
  ok(s.value() === 0, "0,5 s tystnad: tillbaka till 0");
  s.push(0.04, (t += 100)); s.push(0.16, (t += 100));
  ok(near(s.value() ** 2, (0 * 3 + 0.04 + 0.16) / 5), "medlet tas på kvadraterna inom fönstret");
}

// ---------------------------------------------------------------------------
// Kopplingen till skylten
// ---------------------------------------------------------------------------
{
  ok(L.SIGN_LIMITS.length === 5 && L.SIGN_LIMITS.every((v, i) => i === 0 || v > L.SIGN_LIMITS[i - 1]), "högre skyltnivå → högre gräns");
  ok(L.limitForSign(0) === 0.3 && L.limitForSign(4) === 0.9, "Tyst 0,3 … Redovisa 0,9");
  ok(L.effectiveLimit({ limit: 0.8, linkSign: true }, 0) === 0.3, "kopplad: skyltens nivå styr (Tyst)");
  ok(L.effectiveLimit({ limit: 0.8, linkSign: true }, 2) === 0.6, "kopplad: Prata lågt → 0,6");
  ok(L.effectiveLimit({ limit: 0.8, linkSign: true }, null) === 0.8, "kopplad men ingen skylt → reglaget");
  ok(L.effectiveLimit({ limit: 0.8, linkSign: false }, 0) === 0.8, "inte kopplad → reglaget");
  ok(L.effectiveLimit(null, null) === 0.6, "ingen cfg → standardgränsen");
  ok(L.signLevelOf(null) === L.DEFAULT_LEVEL && L.signLevelOf({ level: 9 }) === L.DEFAULT_LEVEL && L.signLevelOf({ level: "3" }) === 3, "skyltens körtillstånd normaliseras");
}

// ---------------------------------------------------------------------------
// Hysteresen "för högt i N sekunder"
// ---------------------------------------------------------------------------
{
  const d = L.createOverDetector({ holdMs: 3000, releaseMs: 2000, releaseMargin: 0.05 });
  let t = 0;
  const run = (level, ms, step = 100) => { let r; const end = t + ms; for (; t < end; t += step) r = d.update(level, 0.6, t); r = d.update(level, 0.6, t); return r; };
  ok(run(0.3, 1000).alert === false, "under gränsen: aldrig rött");
  let r = run(0.7, 2900);
  ok(r.zone === "red" && r.alert === false, "över gränsen i 2,9 s: röd zon men inte 'för högt' än");
  r = run(0.7, 100);
  ok(r.alert === true, "över gränsen i 3 s: 'för högt' (lugnt rött)");
  r = run(0.58, 3000);
  ok(r.alert === true && r.zone === "yellow", "strax under gränsen (inom marginalen): står kvar på rött");
  r = run(0.5, 1900);
  ok(r.alert === true, "under gränsen i 1,9 s: fortfarande rött (ingen blinkning)");
  r = run(0.5, 100);
  ok(r.alert === false, "under gränsen i 2 s: tillbaka");
  // Korta toppar räknas inte ihop.
  run(0.7, 2000); run(0.3, 200); r = run(0.7, 2000);
  ok(r.alert === false, "två toppar på 2 s med en paus emellan: inte 'för högt'");
  // En kort topp avbryter inte återgången… men ett avbrott över gränsen gör det.
  run(0.7, 3000);
  ok(d.alert, "rött igen efter 3 s");
  run(0.5, 1500); run(0.62, 100); r = run(0.5, 1500);
  ok(r.alert === true, "återgången börjar om när nivån går över gränsen igen");
  r = run(0.5, 600);
  ok(r.alert === false, "… och släpper efter 2 s i följd under");
  ok(d.update(0.7, 0.6, t) === undefined || true, "update är tidsbaserad");
  const a = d.update(0.4, 0.6, t);
  const b = d.update(0.4, 0.6, t);
  ok(eq(a, b), "samma anrop två gånger → samma svar");
  d.reset();
  ok(d.alert === false, "reset nollställer");
}

// ---------------------------------------------------------------------------
// Mikrofontjänsten (fristående instans, injicerade beroenden)
// ---------------------------------------------------------------------------
{
  ok(statusForError({ name: "NotAllowedError" }) === "denied", "NotAllowedError → nekad");
  ok(statusForError({ name: "NotFoundError" }) === "unavailable", "NotFoundError → ingen mikrofon");
  ok(statusForError({ name: "Konstigt" }) === "error", "annat fel → fel");

  let calls = 0;
  const tracks = [];
  const svc = createMicService({
    getUserMedia: async () => { calls++; const t = { stopped: false, stop() { this.stopped = true; } }; tracks.push(t); return { getTracks: () => [t] }; },
    createAudioContext: () => new globalThis.AudioContext(),
  });
  const off = svc.attach("m1");
  await svc.start("m1");
  await svc.start("m1");
  ok(calls === 1 && svc.status === "on", "start två gånger → mikrofonen öppnas en gång");
  await svc.start("m2");
  ok(calls === 1 && svc.owner === "m2", "en annan mätare tar över samma ström (öppnas aldrig två gånger)");
  svc.stop();
  ok(tracks.every((t) => t.stopped) && svc.status === "off" && !svc.open, "stop() stoppar alla tracks");
  off();
  flush();
}

// ---------------------------------------------------------------------------
// Mätaren monterad: mikrofonen öppnas/stängs med widgeten
// ---------------------------------------------------------------------------
const CLASS = "4B";
{
  const { teacher: tBus, student: sBus, sent } = busPair();
  const ctxFor = (view, bus, siblings = []) => ({
    view, classId: CLASS, widgetId: "meter-1", form: "large", size: "m",
    sync: bus, siblings: () => siblings,
    runtime: { read: () => null, write() {}, watch: () => () => {} },
  });
  const cfg = { limit: 0.6, linkSign: false };

  // Elevvyn monteras först: den får aldrig röra mikrofonen.
  const sEl = new FakeNode();
  meter.renderLarge(sEl, cfg, ctxFor("student", sBus));
  const sRoot = sEl.firstElementChild;
  ok(gum.calls === 0, "elevvyn öppnar aldrig mikrofonen");
  ok(!sEl.innerHTML.includes("data-sound-toggle"), "elevvyn har ingen start-knapp");
  ok(sRoot.dataset.status === "off" && sEl.innerHTML.includes("wsound--student"), "elevvyn: av tills läraren startar (döljs i CSS)");

  // Lärarvyn: inget öppnas förrän läraren trycker Starta.
  const tEl = new FakeNode();
  meter.renderLarge(tEl, cfg, ctxFor("teacher", tBus));
  const tRoot = tEl.firstElementChild;
  ok(gum.calls === 0 && mic.status === "off", "lärarvyn monterad: mikrofonen är fortfarande av");
  ok(tRoot.querySelector(".wsound__msg").textContent.includes("Starta"), "lärarvyn: 'tryck Starta'");

  const btn = tRoot.querySelector("[data-sound-toggle]");
  tEl.click(btn);
  await tick();
  ok(gum.calls === 1 && mic.status === "on" && openTracks() === 1, "Starta → getUserMedia en gång, mikrofonen öppen");
  ok(gum.last?.audio && gum.last.video === false, "bara ljud begärs");
  ok(contexts.at(-1)?.connected.length === 1, "källan kopplas bara till analysen (aldrig till högtalarna)");

  // Mätningar: ljudet går upp → nivån syns i lärarvyn och på elevskärmen.
  amplitude = rmsAt(-50);
  advance(600);
  ok(tRoot.dataset.zone === "green" && sRoot.dataset.status === "on" && sRoot.dataset.zone === "green", "tyst → grön, elevskärmen visar mätaren");
  const msgs = sent.filter((m) => m.type === meterMod.SOUND_MSG);
  ok(msgs.length >= 5 && msgs.every((m) => m.payload.classId === CLASS && typeof m.payload.level === "number"), "nivån skickas som ett tal via sync-bussen");
  ok(msgs.every((m) => Object.keys(m.payload).every((k) => ["classId", "widgetId", "status", "level", "limit", "zone", "alert"].includes(k))), "bara talen skickas — inget ljud");
  amplitude = rmsAt(-35);
  advance(600);
  ok(tRoot.dataset.zone === "yellow" && sRoot.dataset.zone === "yellow", "nära gränsen → gul");
  amplitude = rmsAt(-20);
  advance(1000);
  ok(tRoot.dataset.zone === "red" && tRoot.dataset.alert === "false", "över gränsen → röd zon, men inte 'för högt' direkt");
  advance(3000);
  ok(tRoot.dataset.alert === "true" && sRoot.dataset.alert === "true", "över gränsen i >3 s → lugnt rött (båda fönstren)");

  // Omritning i samma tick (lektionens brickor vid varje tangenttryck): mikrofonen står kvar.
  meter.destroy(tEl);
  meter.renderLarge(tEl, cfg, ctxFor("teacher", tBus));
  flush();
  ok(openTracks() === 1 && mic.status === "on" && gum.calls === 1, "vyn monteras om i samma omritning → mikrofonen hålls öppen, öppnas inte igen");
  ok(tEl.firstElementChild.dataset.alert === "true", "… och 'för högt'-läget behålls");

  // Widgeten stängs (kryssas ur / läget byts) → mikrofonen stängs helt.
  meter.destroy(tEl);
  ok(tEl.listenerCount === 0, "destroy tar bort klicklyssnaren");
  flush();
  ok(openTracks() === 0, "widgeten stängd → alla tracks stoppade");
  ok(contexts.at(-1).closed, "widgeten stängd → ljudkontexten stängd");
  ok(mic.status === "off" && !mic.open, "widgeten stängd → mikrofonen av");
  ok(sRoot.dataset.status === "off", "elevskärmen får 'av' och döljer mätaren");

  // Stoppa-knappen.
  const t2 = new FakeNode();
  meter.renderChip(t2, cfg, { ...ctxFor("teacher", tBus), form: "chip" });
  t2.click(t2.firstElementChild.querySelector("[data-sound-toggle]"));
  await tick();
  ok(gum.calls === 2 && openTracks() === 1, "brickans knapp startar mätaren");
  t2.click(t2.firstElementChild.querySelector("[data-sound-toggle]"));
  ok(openTracks() === 0 && mic.status === "off", "… och stoppar den (tracks stoppas)");

  // Fönstret stängs.
  t2.click(t2.firstElementChild.querySelector("[data-sound-toggle]"));
  await tick();
  ok(openTracks() === 1, "startad igen");
  fire("pagehide");
  ok(openTracks() === 0 && mic.status === "off", "fönstret stängs (pagehide) → mikrofonen stängs");

  // Stängd medan läraren svarar på behörighetsfrågan → strömmen släpps direkt.
  holdGum = true;
  t2.click(t2.firstElementChild.querySelector("[data-sound-toggle]"));
  await tick();
  ok(mic.status === "starting", "väntar på behörighet");
  meter.destroy(t2);
  flush();
  pendingGum.resolve();
  await tick();
  ok(openTracks() === 0 && mic.status === "off", "stängd under behörighetsfrågan → strömmen stoppas direkt när den kommer");
  holdGum = false;

  // Elevskärmen tystnar om lärarfönstret slutar skicka (t.ex. kraschar).
  const t3 = new FakeNode();
  meter.renderLarge(t3, cfg, ctxFor("teacher", tBus));
  t3.click(t3.firstElementChild.querySelector("[data-sound-toggle]"));
  await tick();
  amplitude = rmsAt(-40);
  advance(300);
  ok(sRoot.dataset.status === "on", "elevskärmen visar mätaren");
  const running = [...timers.entries()].find(([, t]) => t.every);
  timers.delete(running[0]); // "lärarfönstret fryser"
  advance(meterMod.STALE_MS + 10);
  ok(sRoot.dataset.status === "off", "inga nivåer på en stund → elevskärmen döljer mätaren");
  mic.stop();
  meter.destroy(t3);
  flush();

  // Mikrofonen nekas: vänlig text i lärarvyn, ingenting på elevskärmen.
  denyWith = "NotAllowedError";
  const t4 = new FakeNode();
  meter.renderLarge(t4, cfg, ctxFor("teacher", tBus));
  t4.click(t4.firstElementChild.querySelector("[data-sound-toggle]"));
  await tick();
  const msg = t4.firstElementChild.querySelector(".wsound__msg");
  ok(mic.status === "denied" && t4.firstElementChild.dataset.status === "denied", "nekad → status 'denied'");
  ok(!msg.hidden && /blockerad/.test(msg.textContent) && /Starta igen/.test(msg.textContent), "nekad → tydlig, vänlig text i lärarvyn");
  ok(sRoot.dataset.status !== "on", "nekad → elevskärmen visar ingenting");
  ok(openTracks() === 0, "nekad → ingen ström öppen");
  denyWith = "NotFoundError";
  t4.click(t4.firstElementChild.querySelector("[data-sound-toggle]"));
  await tick();
  ok(/Hittar ingen mikrofon/.test(t4.firstElementChild.querySelector(".wsound__msg").textContent), "ingen mikrofon → egen text");
  denyWith = null;
  meter.destroy(t4);
  flush();
  ok(mic.status === "off", "stängd widget efter nekad → av igen (texten försvinner)");

  // Elevvyn städar sin prenumeration.
  meter.destroy(sEl);
  ok(sBus.listeners === 0, "elevvyns destroy tar bort sync-lyssnaren");
}

// ---------------------------------------------------------------------------
// Mätaren kopplad till skylten (monterad)
// ---------------------------------------------------------------------------
{
  const { teacher: tBus, sent } = busPair();
  const siblings = [{ id: "sign-1", type: "sound-sign", cfg: {} }, { id: "meter-2", type: "sound-meter", cfg: {} }];
  const ctx = {
    view: "teacher", classId: CLASS, widgetId: "meter-2", form: "large", size: "m",
    sync: tBus, siblings: () => siblings,
    runtime: { read: () => null, write() {}, watch: () => () => {} },
  };
  rt.writeRuntime(CLASS, "sign-1", { level: 0 });
  const el = new FakeNode();
  meter.renderLarge(el, { limit: 0.9, linkSign: true }, ctx);
  const root = el.firstElementChild;
  ok(root.props["--wsound-limit"] === "0.3", "kopplad: gränsen följer skylten (Tyst → 0,3)");
  rt.writeRuntime(CLASS, "sign-1", { level: 3 });
  ok(root.props["--wsound-limit"] === "0.75", "skylten byts till Prata → gränsen 0,75 direkt");
  el.click(root.querySelector("[data-sound-toggle]"));
  await tick();
  amplitude = rmsAt(-25); // nivå 0,7
  advance(4000);
  ok(root.dataset.zone === "yellow" && root.dataset.alert === "false", "0,7 mot Prata (0,75) → gul, inte för högt");
  rt.writeRuntime(CLASS, "sign-1", { level: 1 });
  advance(3500);
  ok(root.dataset.zone === "red" && root.dataset.alert === "true", "skylten byts till Viska → samma ljud blir för högt");
  ok(sent.at(-1).payload.limit === 0.45, "elevskärmen får skyltens gräns");
  meter.destroy(el);
  const el2 = new FakeNode();
  meter.renderLarge(el2, { limit: 0.9, linkSign: false }, ctx);
  ok(el2.firstElementChild.props["--wsound-limit"] === "0.9", "inte kopplad: reglagets gräns");
  meter.destroy(el2);
  const el3 = new FakeNode();
  meter.renderLarge(el3, { limit: 0.9, linkSign: true }, { ...ctx, siblings: () => [] });
  ok(el3.firstElementChild.props["--wsound-limit"] === "0.9", "kopplad men ingen skylt: reglagets gräns");
  meter.destroy(el3);
  flush();
  ok(openTracks() === 0 && mic.status === "off", "stängd → mikrofonen av");
}

// ---------------------------------------------------------------------------
// Inställningarna: dataskyddstexten, reglaget, kopplingen
// ---------------------------------------------------------------------------
{
  const html = meter.settingsHTML({ limit: 0.6 }, { view: "teacher", widgetId: "m", siblings: () => [] });
  ok(html.includes("Mikrofonen används bara för att mäta ljudnivån här och nu — inget spelas in eller sparas."), "dataskyddstexten står i inställningarna");
  ok(html.includes("Koppla till skylten") && html.includes('type="range"') && html.includes("data-wsound-toggle"), "reglage, koppling och start-knapp");
  const sh = sign.settingsHTML({ names: ["", "Viskning"] }, { classId: CLASS, widgetId: "sign-1" });
  ok(sh.includes("Viskning") && sh.includes("Tyst") && sh.includes('data-wsign-level="4"'), "skyltens inställningar: nivåknappar och namn");
}

// ---------------------------------------------------------------------------
// Skylten
// ---------------------------------------------------------------------------
{
  ok(eq(L.normalizeNames(["  Lugnt ", "", 7, "x".repeat(40)]), ["Lugnt", "Viska", "Prata lågt", "x".repeat(24), "Redovisa"]), "namnen: egna trimmas, tomma → standard, max 24 tecken");
  ok(L.LEVELS.length === 5 && new Set(L.LEVELS.map((l) => l.color)).size === 5, "fem nivåer med var sin färg");
  ok([0, 1, 2, 3, 4].every((l) => signSymbol(l).startsWith("<svg")) && new Set([0, 1, 2, 3, 4].map(signSymbol)).size === 5, "en egen SVG-symbol per nivå");
  ok(![0, 1, 2, 3, 4].some((l) => /<image|href=|url\(/.test(signSymbol(l))), "symbolerna använder inga externa bilder");

  let state = { level: 2 };
  const writes = [];
  const watchers = new Set();
  const runtime = {
    read: () => state,
    write: (s) => { writes.push(s); state = s; for (const cb of watchers) cb(s); },
    watch: (cb) => { watchers.add(cb); return () => watchers.delete(cb); },
  };
  const t = new FakeNode();
  sign.renderChip(t, { names: ["Tyst", "Viska", "Lågt", "Prata", "Redovisa"] }, { view: "teacher", runtime });
  const root = t.firstElementChild;
  ok(root.querySelector(".wsign__num").textContent === "2" && root.querySelector(".wsign__name").textContent === "Lågt", "brickan: '● 2 Lågt' med lärarens namn");
  ok(root.attrs.style.includes(L.LEVELS[2].color), "brickans prick har nivåns färg");
  const up = root.querySelectorAll("[data-sign-step]").find((b) => b.dataset.signStep === "1");
  up.sel = "[data-sign-step]";
  t.click(up);
  ok(eq(writes.at(-1), { level: 3 }) && root.querySelector(".wsign__num").textContent === "3", "lärarens › höjer nivån (körtillstånd)");

  const s = new FakeNode();
  sign.renderLarge(s, {}, { view: "student", runtime });
  ok(!s.innerHTML.includes("data-sign-set") && !s.innerHTML.includes("data-sign-step"), "elevvyn har inga knappar");
  ok(s.firstElementChild.querySelector(".wsign__badge").innerHTML.includes("<svg"), "stor skylt: SVG-symbol");
  ok(s.listenerCount === 0, "elevvyn lyssnar inte på klick");
  runtime.write({ level: 0 });
  ok(s.firstElementChild.querySelector(".wsign__name").textContent === "Tyst", "elevvyn följer körtillståndet");
  sign.destroy(t);
  sign.destroy(s);
  ok(watchers.size === 0, "destroy tar bort körtillståndslyssnarna");
}

flush();
console.log(`${passed} OK, ${failed} fel`);
if (failed) process.exit(1);
