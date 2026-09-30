/**
 * TEST — widgets, grund (issue #115): js/widgets/registry.js, runtime.js,
 * normalizePlan i js/modes/lektion.js och morgoninställningarna.
 *
 *   node docs/test-widgets.mjs
 *
 * Kontrollerar:
 *   - registret: klockan finns, har alla delar i kontraktet
 *   - normalisering av lektionens och Morgonskärmens widgets (trasig data,
 *     dubbletter, okända typer behålls, stabila id:n, platskrockar, storlek)
 *   - normalizePlan: widgets standard [], följer med och normaliseras;
 *     Kopiera/Skicka kopia (buildCopy) tar med dem med NYA id:n
 *   - morgoninställningarna (morning.js normalize): widgets med, i det
 *     DELADE dokumentet (splitMorning)
 *   - brickorna: högst 3, bara kända typer; utan widgets ingen markup
 *   - platskollisioner (resolveSlots): krock med kortet/tavlan → närmaste
 *     lediga hörn, ingen plats → null, två widgets aldrig på samma plats
 *   - runtime-tidsstämplar: paus + fortsätt ger rätt kvarvarande tid,
 *     endsAt, lokal lagring under classroom:local:…, lyssnare
 */

// ---- Attrapper för webbläsar-API:er som modulerna rör vid import/körning ----
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

const reg = await import("../js/widgets/registry.js");
const rt = await import("../js/widgets/runtime.js");
const { normalizePlan } = await import("../js/modes/lektion.js");
const { normalize: normalizeMorning, splitMorning } = await import("../js/lib/morning.js");
const { buildCopy } = await import("../js/lib/send-plan.js");
const { formatClock } = await import("../js/widgets/clock-digital.js");
const { chipsHTML } = await import("../js/widgets/host.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Registret
// ---------------------------------------------------------------------------
{
  const clock = reg.widgetType("clock-digital");
  ok(clock, "Klocka (digital) finns i registret");
  ok(clock?.name === "Klocka (digital)", "klockans namn");
  for (const k of ["id", "name", "icon", "defaults", "renderChip", "renderLarge", "destroy"]) {
    ok(clock && k in clock, `klockan har ${k}`);
  }
  ok(reg.widgetTypes().every((t) => typeof t.defaults() === "object"), "defaults() ger ett objekt för alla typer");
  ok(reg.widgetType("finns-inte") === null, "okänd typ → null");
  ok(reg.MAX_CHIPS === 3, "högst 3 brickor");
  ok(eq(reg.SLOTS, ["tl", "tr", "bl", "br"]) && eq(reg.SIZES, ["s", "m", "l"]), "platser och storlekar");
  ok(formatClock(new Date(2026, 8, 30, 8, 5).getTime()) === "08:05", "klockan visar HH:MM");
  ok(formatClock(new Date(2026, 8, 30, 14, 42).getTime()) === "14:42", "klockan visar 24-timmars tid");
}

// ---------------------------------------------------------------------------
// Normalisering — lektionen
// ---------------------------------------------------------------------------
{
  const n = reg.normalizeLessonWidgets;
  ok(eq(n(undefined), []) && eq(n(null), []) && eq(n("x"), []) && eq(n({}), []), "inget/trasigt → []");
  const list = n([
    { id: "a", type: "clock-digital", cfg: { extra: 1 } },
    { id: "a", type: "clock-digital" },          // dubblett-id
    { id: "b", type: "clock-digital" },          // klockan får bara finnas en gång
    null, 7, { id: "c" }, { id: "d", type: "" }, // trasiga
    { id: "e", type: "framtida-typ", cfg: { x: [1, 2] } }, // okänd — behålls
  ]);
  ok(eq(list.map((w) => w.id), ["a", "e"]), "dubbletter och trasiga poster bort, okänd typ kvar");
  ok(list[0].cfg.extra === 1, "egna cfg-värden behålls");
  ok(eq(list[1].cfg, { x: [1, 2] }), "okänd typ: cfg orörd");
  const noId = n([{ type: "clock-digital" }]);
  ok(noId[0].id === n([{ type: "clock-digital" }])[0].id, "saknat id → stabilt id (samma varje gång)");
  ok(eq(n(list), list), "normaliseringen är idempotent");

  const chips = reg.chipWidgets([
    { id: "1", type: "framtida-typ" },
    { id: "2", type: "clock-digital" },
  ]);
  ok(eq(chips.map((w) => w.id), ["2"]), "brickor: bara kända typer");
  ok(chipsHTML([]) === "" && chipsHTML(undefined) === "", "utan widgets: ingen markup alls i rubrikraden");
  ok(chipsHTML([{ id: "x", type: "framtida-typ" }]) === "", "bara okända typer: ingen markup");
  const html = chipsHTML([{ id: "2", type: "clock-digital" }]);
  ok(html.startsWith('<div class="lb-widgets">') && (html.match(/class="lb-chip"/g) ?? []).length === 1, "en klocka → en bricka");
  // Högst 3 brickor — med en (test)typ som får finnas flera gånger.
  const multi = { ...reg.widgetType("clock-digital"), id: "test-multi", multiple: true };
  reg.widgetTypes().push(multi);
  try {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, type: "test-multi" }));
    ok(reg.normalizeLessonWidgets(many).length === 5, "multiple: alla instanser sparas");
    ok(eq(reg.chipWidgets(many).map((w) => w.id), ["m0", "m1", "m2"]), "högst 3 brickor visas (de första)");
    const clocks = [{ id: "c1", type: "clock-digital" }, { id: "c2", type: "clock-digital" }];
    ok(reg.normalizeLessonWidgets(clocks).length === 1, "klockan (inte multiple) bara en gång");
  } finally {
    reg.widgetTypes().pop();
  }
}

// ---------------------------------------------------------------------------
// normalizePlan med widgets (+ Kopiera / Skicka kopia)
// ---------------------------------------------------------------------------
{
  const empty = normalizePlan({ id: "p1", name: "X" });
  ok(Array.isArray(empty.widgets) && empty.widgets.length === 0, "normalizePlan: widgets standard []");
  const withW = normalizePlan({ id: "p2", widgets: [{ id: "w1", type: "clock-digital" }, { junk: true }] });
  ok(eq(withW.widgets, [{ id: "w1", type: "clock-digital", cfg: { seconds: false, date: false } }]), "normalizePlan: widgets normaliseras");
  ok(eq(normalizePlan(withW).widgets, withW.widgets), "normalizePlan: widgets idempotent");
  ok(withW.show.subject === true && withW.fields.vad === "", "övriga fält orörda");

  const copy = buildCopy(withW, { date: "2026-10-05" }, "u1");
  ok(copy.widgets.length === 1 && copy.widgets[0].type === "clock-digital", "Skicka kopia: widgets följer med");
  ok(copy.widgets[0].id !== "w1", "Skicka kopia: nya widget-id:n (eget körtillstånd)");
  const same = reg.copyLessonWidgets(withW.widgets);
  ok(same[0].id !== "w1" && eq(same[0].cfg, withW.widgets[0].cfg), "Kopiera: samma typ/cfg, nytt id");
  ok(withW.widgets[0].id === "w1", "originalet rörs inte av kopian");
  ok(eq(buildCopy(empty, {}, "u1").widgets, []), "kopia utan widgets → []");
}

// ---------------------------------------------------------------------------
// Normalisering — Morgonskärmen (platser, storlek)
// ---------------------------------------------------------------------------
{
  const n = reg.normalizeMorningWidgets;
  ok(eq(n(undefined), []), "morgon: standard []");
  const a = n([{ id: "k", type: "clock-digital", slot: "br", size: "l" }]);
  ok(eq(a, [{ id: "k", type: "clock-digital", slot: "br", size: "l", cfg: { seconds: false, date: false } }]), "morgon: giltig post orörd");
  const b = n([{ id: "k", type: "clock-digital", slot: "mitten", size: "xl" }]);
  ok(b[0].slot === "tl" && b[0].size === "m", "morgon: ogiltig plats → första lediga, ogiltig storlek → M");
  const c = n([
    { id: "x1", type: "okand", slot: "tr" },
    { id: "x2", type: "okand2", slot: "tr" }, // krock → nästa lediga
    { id: "x3", type: "okand3", slot: "tl" },
  ]);
  ok(eq(c.map((w) => [w.id, w.slot]), [["x1", "tr"], ["x2", "bl"], ["x3", "tl"]]), "morgon: platskrock → nästa lediga, ordningen behålls");
  ok(new Set(c.map((w) => w.slot)).size === c.length, "morgon: aldrig två på samma plats");
  const five = n(Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, type: `t${i}`, slot: "tl" })));
  ok(five.length === 4, "morgon: högst fyra (en per hörn)");
  ok(reg.freeSlot(five) === null, "freeSlot: null när alla hörn är tagna");
  ok(reg.createMorningWidget("clock-digital", five) === null, "ingen ny widget när hörnen är slut");
  const fresh = reg.createMorningWidget("clock-digital", [{ id: "q", slot: "tl" }]);
  ok(fresh.slot === "tr" && fresh.size === "m", "ny widget: första lediga hörn, storlek M");

  const s = normalizeMorning({ widgets: [{ id: "k", type: "clock-digital", slot: "bl", size: "s" }] });
  ok(s.widgets.length === 1 && s.widgets[0].slot === "bl", "morning.normalize: widgets med");
  ok(eq(normalizeMorning(null).widgets, []), "morning.normalize: standard []");
  const { shared } = splitMorning(s);
  ok(shared.widgets?.[0]?.id === "k", "widgets ligger i det DELADE morgondokumentet");
  ok(eq(normalizeMorning(s).widgets, s.widgets), "morning.normalize: widgets idempotenta");
}

// ---------------------------------------------------------------------------
// Platskollisioner (resolveSlots)
// ---------------------------------------------------------------------------
{
  // Yta 1600 × 900, widget 200 × 100, 20 px från kanten.
  const W = 1600, H = 900, w = 200, h = 100, inset = 20;
  const rectFor = (_item, slot) => {
    const left = slot[1] === "l" ? inset : W - inset - w;
    const top = slot[0] === "t" ? inset : H - inset - h;
    return { left, top, right: left + w, bottom: top + h };
  };
  const card = { left: 500, top: 250, right: 1100, bottom: 650 };
  const opts = (obstacles) => ({ rectFor, obstacles, width: W, height: H });

  let r = reg.resolveSlots([{ id: "a", slot: "tr" }], opts([card]));
  ok(r.get("a") === "tr", "ingen krock → står kvar");

  // Bra jobbat-tavlan till höger, hög: täcker tr och br.
  const board = { left: 1300, top: 60, right: 1580, bottom: 840 };
  r = reg.resolveSlots([{ id: "a", slot: "tr" }], opts([card, board]));
  ok(r.get("a") === "tl", "krock uppe till höger → närmaste lediga (uppe till vänster)");
  r = reg.resolveSlots([{ id: "a", slot: "br" }], opts([card, board]));
  ok(r.get("a") === "bl", "krock nere till höger → nere till vänster");

  // Närmaste = hörnet rakt under på en bred skärm.
  ok(eq(reg.slotsByDistance("tl", W, H), ["tl", "bl", "tr", "br"]), "närmast: rakt under före andra sidan (bred skärm)");
  ok(eq(reg.slotsByDistance("tl", 900, 1600), ["tl", "tr", "bl", "br"]), "närmast: bredvid före under (hög skärm)");

  // Den som står rätt knuffas aldrig bort av en som flyttas.
  r = reg.resolveSlots([{ id: "a", slot: "tr" }, { id: "b", slot: "tl" }], opts([board]));
  ok(r.get("b") === "tl" && r.get("a") === "bl", "widget på egen plats behåller den; krockaren tar nästa lediga");
  ok(new Set([...r.values()]).size === 2, "aldrig två på samma plats efter flytt");

  // Allt blockerat → null (döljs).
  const all = { left: 0, top: 0, right: W, bottom: H };
  r = reg.resolveSlots([{ id: "a", slot: "tl" }], opts([all]));
  ok(r.get("a") === null, "ingen ledig plats → null");

  // Kortet som täcker vänster sida: tl + bl blockeras.
  const left = { left: 0, top: 0, right: 400, bottom: H };
  r = reg.resolveSlots([{ id: "a", slot: "tl" }, { id: "b", slot: "bl" }], opts([left]));
  ok(r.get("a") === "tr" && r.get("b") === "br", "två krockar flyttas till var sitt ledigt hörn");

  ok(reg.rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 15, top: 0, right: 20, bottom: 10 }, 8), "gap räknas som krock");
  ok(!reg.rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 }), "kant mot kant utan gap = ingen krock");
}

// ---------------------------------------------------------------------------
// Runtime — tidsstämplar
// ---------------------------------------------------------------------------
{
  const t0 = 1_000_000;
  const MIN = 60_000;
  let s = rt.startTimer(10 * MIN, t0);
  ok(s.startedAt === t0 && s.pausedAt === null && s.durationMs === 10 * MIN, "start: tidsstämplar");
  ok(s.endsAt === t0 + 10 * MIN, "start: endsAt = start + längd");
  ok(rt.remainingMs(s, t0 + 3 * MIN) === 7 * MIN, "3 min in: 7 kvar");
  ok(rt.isRunning(s, t0 + 3 * MIN), "går");

  s = rt.pauseTimer(s, t0 + 3 * MIN);
  ok(s.pausedAt === t0 + 3 * MIN && s.endsAt === null, "paus: pausedAt satt, endsAt null");
  ok(rt.remainingMs(s, t0 + 8 * MIN) === 7 * MIN, "pausad i 5 min: fortfarande 7 kvar");
  ok(rt.isPaused(s) && !rt.isRunning(s, t0 + 8 * MIN), "pausad");
  ok(eq(rt.pauseTimer(s, t0 + 9 * MIN), s), "paus igen = ingen ändring");

  s = rt.resumeTimer(s, t0 + 8 * MIN);
  ok(s.pausedAt === null && rt.remainingMs(s, t0 + 8 * MIN) === 7 * MIN, "fortsätt: 7 kvar direkt efter");
  ok(s.endsAt === t0 + 15 * MIN, "fortsätt: sluttiden flyttad med pausen (5 min)");
  ok(rt.remainingMs(s, t0 + 10 * MIN) === 5 * MIN, "2 min efter fortsätt: 5 kvar");
  // Två pauser i rad
  s = rt.resumeTimer(rt.pauseTimer(s, t0 + 11 * MIN), t0 + 12 * MIN);
  ok(rt.remainingMs(s, t0 + 12 * MIN) === 4 * MIN && s.endsAt === t0 + 16 * MIN, "andra pausen: 4 kvar, slut +1 min");
  ok(rt.remainingMs(s, t0 + 20 * MIN) === 0 && rt.isFinished(s, t0 + 20 * MIN), "efter slut: 0, klar");
  ok(rt.formatMs(7 * MIN) === "7:00", "formatMs");

  s = rt.adjustTimer(rt.startTimer(MIN, t0), MIN, t0);
  ok(s.durationMs === 2 * MIN && s.endsAt === t0 + 2 * MIN, "adjust: +1 min ger ny sluttid");

  // Lagring: lokal nyckel per klass + widget, lyssnare i samma fönster.
  const key = rt.runtimeKey("QA-TEST-1", "w1");
  ok(key === "classroom:local:widgets/QA-TEST-1/w1", "nyckeln ligger under classroom:local:");
  const seen = [];
  const off = rt.watchRuntime("QA-TEST-1", "w1", (v) => seen.push(v));
  rt.writeRuntime("QA-TEST-1", "w1", rt.startTimer(MIN, t0), t0);
  ok(JSON.parse(mem.get(key)).durationMs === MIN, "skrivs till localStorage");
  ok(rt.readRuntime("QA-TEST-1", "w1")?.startedAt === t0, "läses tillbaka");
  ok(seen.length === 1 && seen[0].updatedAt === t0, "lyssnaren får värdet (med updatedAt)");
  ok(rt.readRuntime("QA-TEST-2", "w1") === null, "annan klass = eget tillstånd");
  rt.writeRuntime("QA-TEST-1", "w2", { level: 2 }, t0);
  ok(seen.length === 1, "annan widget väcker inte lyssnaren");
  ok(rt.readRuntime("QA-TEST-1", "w2")?.level === 2, "ljudnivåskylt: vald nivå sparas");
  rt.clearRuntime("QA-TEST-1", "w1");
  ok(!mem.has(key) && seen.at(-1) === null, "clear tar bort och meddelar null");
  off();
  rt.writeRuntime("QA-TEST-1", "w1", { x: 1 }, t0);
  ok(seen.length === 2, "avregistrerad lyssnare får inget");
  mem.set(key, "{trasig");
  ok(rt.readRuntime("QA-TEST-1", "w1") === null, "trasig JSON → null");
}

console.log(`${passed} OK, ${failed} fel`);
if (failed) process.exit(1);
