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
 *   - platskollisioner (resolveSlots): krock med kortet/tavlan → krymp i
 *     hörnet (ner till S), först därefter närmaste lediga hörn, ingen plats
 *     → null; rund klocka räknas som cirkel; två widgets aldrig på samma
 *     plats; panelens förklaring (placementText) — issue #119
 *   - Elevskärm-dockan (dockPlace, issue #120): står kvar när den inte skymmer
 *     någon widget; annars åt vänster bredvid widgeten i hörnet nere till
 *     höger eller upp ovanför den; en plats som skymmer kortet/Bra jobbat
 *     förkastas; ingen plats → står kvar (→ skymda id:n + panelens rad)
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
  ok(html.startsWith('<div class="lb-widgets"') && (html.match(/class="lb-chip"/g) ?? []).length === 1, "en klocka → en bricka");
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
// Platskollisioner (resolveSlots) — flytt, krympning i hörnet, rund form (#119)
// ---------------------------------------------------------------------------
{
  // Yta 1600 × 900, widget 200 × 100, 20 px från kanten. rectFor skalar
  // formen i hörnet (förankrad mot kanten, som host.js gör).
  const W = 1600, H = 900, w = 200, h = 100, inset = 20;
  const shape = (ww, hh, round = false) => (_item, slot, scale = 1) => {
    const sw = ww * scale, sh = hh * scale;
    const left = slot[1] === "l" ? inset : W - inset - sw;
    const top = slot[0] === "t" ? inset : H - inset - sh;
    return { left, top, right: left + sw, bottom: top + sh, round };
  };
  const rectFor = shape(w, h);
  const card = { left: 500, top: 250, right: 1100, bottom: 650, name: "kortet" };
  const opts = (obstacles, more = {}) => ({ rectFor, obstacles, width: W, height: H, ...more });
  const slotOf = (r, id) => r.get(id)?.slot ?? null;

  let r = reg.resolveSlots([{ id: "a", slot: "tr" }], opts([card]));
  ok(slotOf(r, "a") === "tr" && r.get("a").scale === 1 && eq(r.get("a").blockedBy, []), "ingen krock → står kvar, full storlek");

  // Bra jobbat-tavlan till höger, hög: täcker tr och br.
  const board = { left: 1300, top: 60, right: 1580, bottom: 840, name: "Bra jobbat-tavlan" };
  r = reg.resolveSlots([{ id: "a", slot: "tr" }], opts([card, board]));
  ok(slotOf(r, "a") === "tl", "krock uppe till höger (ingen krympning tillåten) → närmaste lediga (uppe till vänster)");
  ok(eq(r.get("a").blockedBy, ["Bra jobbat-tavlan"]), "blockedBy: vad som skulle skymts");
  r = reg.resolveSlots([{ id: "a", slot: "br" }], opts([card, board]));
  ok(slotOf(r, "a") === "bl", "krock nere till höger → nere till vänster");

  // Närmaste = hörnet rakt under på en bred skärm.
  ok(eq(reg.slotsByDistance("tl", W, H), ["tl", "bl", "tr", "br"]), "närmast: rakt under före andra sidan (bred skärm)");
  ok(eq(reg.slotsByDistance("tl", 900, 1600), ["tl", "tr", "bl", "br"]), "närmast: bredvid före under (hög skärm)");

  // Den som står rätt knuffas aldrig bort av en som flyttas.
  r = reg.resolveSlots([{ id: "a", slot: "tr" }, { id: "b", slot: "tl" }], opts([board]));
  ok(slotOf(r, "b") === "tl" && slotOf(r, "a") === "bl", "widget på egen plats behåller den; krockaren tar nästa lediga");
  ok(new Set([...r.values()].map((x) => x.slot)).size === 2, "aldrig två på samma plats efter flytt");

  // Allt blockerat → null (döljs).
  const all = { left: 0, top: 0, right: W, bottom: H, name: "kortet" };
  r = reg.resolveSlots([{ id: "a", slot: "tl" }], opts([all], { minScale: () => 0.4 }));
  ok(r.get("a").slot === null && eq(r.get("a").blockedBy, ["kortet"]), "ingen ledig plats (inte ens krympt) → null, med orsak");

  // Kortet som täcker vänster sida: tl + bl blockeras.
  const left = { left: 0, top: 0, right: 400, bottom: H };
  r = reg.resolveSlots([{ id: "a", slot: "tl" }, { id: "b", slot: "bl" }], opts([left]));
  ok(slotOf(r, "a") === "tr" && slotOf(r, "b") === "br", "två krockar flyttas till var sitt ledigt hörn");

  ok(reg.rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 15, top: 0, right: 20, bottom: 10 }, 8), "gap räknas som krock");
  ok(!reg.rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 }), "kant mot kant utan gap = ingen krock");

  // ---- Krymp hellre i hörnet än byt hörn (#119) ----
  // Stor analog klocka (300 × 300) uppe till vänster; kortet börjar 250 px
  // ner och 150 px in — som när Bra jobbat skjuter kortet åt vänster.
  const big = shape(300, 300, true);
  const lowCard = { left: 150, top: 250, right: 1100, bottom: 650, name: "kortet" };
  const S = 0.33; // storlek S i förhållande till L
  r = reg.resolveSlots([{ id: "c", slot: "tl" }], { rectFor: big, minScale: () => S, obstacles: [lowCard], width: W, height: H, gap: 8 });
  const c = r.get("c");
  ok(c.slot === "tl", "L som inte ryms uppe till vänster stannar i hörnet (krymps, flyttas inte)");
  ok(c.scale < 1 && c.scale >= S, `krympt till mellan S och L (${c.scale})`);
  const shrunk = big({}, "tl", c.scale);
  ok(!reg.shapeOverlaps(shrunk, lowCard, 8), "den krympta klockan skymmer inte kortet");
  ok(reg.shapeOverlaps(big({}, "tl", Math.min(1, c.scale + 0.02)), lowCard, 8), "största skala som ryms (lite större skulle skymma)");
  ok(eq(c.blockedBy, ["kortet"]), "krympt: orsaken är kortet");

  // Ryms inte ens S i hörnet → flyttas (hellre det än skymma kortet).
  const tallCard = { left: 0, top: 60, right: 1100, bottom: 650, name: "kortet" };
  r = reg.resolveSlots([{ id: "c", slot: "tl" }], { rectFor: big, minScale: () => S, obstacles: [tallCard], width: W, height: H, gap: 8 });
  // bl är närmast (bred skärm) och rymmer en krympt klocka under kortet.
  ok(r.get("c").slot === "bl" && r.get("c").scale < 1, "inte ens S ryms → närmaste hörn där den ryms (krympt där om det behövs)");
  ok(eq(r.get("c").blockedBy, ["kortet"]), "flyttad: orsaken är kortet");
  const tallCard2 = { ...tallCard, bottom: 840 };
  r = reg.resolveSlots([{ id: "c", slot: "tl" }], { rectFor: big, minScale: () => S, obstacles: [tallCard2], width: W, height: H, gap: 8 });
  ok(r.get("c").slot === "tr" && r.get("c").scale === 1, "vänster sida helt blockerad → uppe till höger i full storlek");

  // Utan minScale (standard 1) krymps aldrig.
  r = reg.resolveSlots([{ id: "c", slot: "tl" }], { rectFor: big, obstacles: [lowCard], width: W, height: H, gap: 8 });
  ok(r.get("c").slot !== "tl" && r.get("c").scale === 1, "minScale 1 → ingen krympning");

  // Rund form: kvadratens tomma hörn får gå in över kortets hörn.
  const nearCard = { left: 290, top: 290, right: 1100, bottom: 650, name: "kortet" };
  r = reg.resolveSlots([{ id: "c", slot: "tl" }], { rectFor: big, minScale: () => S, obstacles: [nearCard], width: W, height: H, gap: 8 });
  ok(r.get("c").slot === "tl" && r.get("c").scale === 1, "rund klocka: kortets hörn i kvadratens tomma hörn = ingen krock, full storlek");
  r = reg.resolveSlots([{ id: "c", slot: "tl" }], { rectFor: shape(300, 300, false), minScale: () => S, obstacles: [nearCard], width: W, height: H, gap: 8 });
  ok(r.get("c").scale < 1, "samma mått som fyrkant: krock → krymps");
  ok(!reg.shapeOverlaps({ left: 0, top: 0, right: 100, bottom: 100, round: true }, { left: 90, top: 90, right: 200, bottom: 200 }), "cirkel vs rektangel i hörnet: ingen överlapp");
  ok(reg.shapeOverlaps({ left: 0, top: 0, right: 100, bottom: 100, round: true }, { left: 40, top: 95, right: 60, bottom: 200 }), "cirkel vs rektangel rakt under: överlapp");

  // Alla fyra hörnen i alla storlekar när det finns plats (inga hinder).
  for (const slot of reg.SLOTS) for (const size of [0.33, 0.6, 1]) {
    const rr = reg.resolveSlots([{ id: "x", slot }], { rectFor: shape(300 * size, 300 * size, true), minScale: () => S, obstacles: [card], width: W, height: H, gap: 8 });
    if (rr.get("x").slot !== slot || rr.get("x").scale !== 1) { ok(false, `${slot} i skala ${size} ska stå kvar`); }
  }
  ok(true, "alla fyra hörn × S/M/L står kvar när kortet är i mitten");

  // Två widgets: en krympt i sitt hörn knuffar inte grannen.
  r = reg.resolveSlots([{ id: "c", slot: "tl" }, { id: "d", slot: "tr" }],
    { rectFor: big, minScale: () => S, obstacles: [lowCard], width: W, height: H, gap: 8 });
  ok(r.get("c").slot === "tl" && r.get("c").scale < 1 && r.get("d").slot === "tr" && r.get("d").scale === 1,
    "krympt widget i sitt hörn + granne i sitt hörn i full storlek");

  // Panelens rad (settings-ui placementText).
  const { placementText } = await import("../js/widgets/settings-ui.js");
  const wl = { id: "c", slot: "tl" };
  ok(placementText(wl, { slot: "tl", scale: 1, blockedBy: [] }) === null, "panel: som valt → ingen rad");
  ok(placementText(wl, { slot: "tl", scale: 0.7, blockedBy: ["kortet"] }) === "Mindre för att inte skymma kortet.", "panel: krympt");
  ok(placementText(wl, { slot: "tr", scale: 1, blockedBy: ["kortet", "Bra jobbat-tavlan"] }) === "Flyttad till uppe till höger — skulle skymma kortet och Bra jobbat-tavlan.", "panel: flyttad");
  ok(/^Dold just nu/.test(placementText(wl, { slot: null, scale: 1, blockedBy: ["kortet"] })), "panel: dold");

  // Elevskärmen har en annan yta (ingen verktygsrad/panel) — panelen visar dess
  // resultat när den är öppen, och bara en rad när båda vyerna är lika.
  const { placementLines } = await import("../js/widgets/settings-ui.js");
  const fine = { slot: "tl", scale: 1, blockedBy: [] };
  const small = { slot: "tl", scale: 0.6, blockedBy: ["kortet"] };
  ok(placementLines(wl, small, null, false) === "Mindre för att inte skymma kortet.", "panel utan elevskärm: lärarvyns rad");
  ok(placementLines(wl, fine, small, true) === "På elevskärmen: Mindre för att inte skymma kortet.", "panel: bara elevskärmen krymper den");
  ok(placementLines(wl, small, small, true) === "Mindre för att inte skymma kortet.", "panel: samma i båda vyerna → en rad");
  ok(placementLines(wl, small, fine, true) === "Här: Mindre för att inte skymma kortet.", "panel: bara här");
  ok(placementLines(wl, fine, fine, true) === null, "panel: som valt överallt → ingen rad");
  ok(placementLines(wl, fine, null, true) === null, "panel: elevskärmen har inte lagt ut än → ingen rad");

  // Elevfönstret delar sina platser lokalt, bara vid ändring.
  const host = await import("../js/widgets/host.js");
  const seenP = [];
  const offP = host.watchStudentPlacement("QA-PL", (m) => seenP.push(m));
  ok(seenP.length === 1 && seenP[0] === null, "watchStudentPlacement: inget delat än → null");
  const share = host.createPlacementSharer("QA-PL");
  share(new Map([["c", small]]));
  share(new Map([["c", small]]));
  ok(seenP.length === 2 && seenP[1].get("c").scale === 0.6, "delade platser når lärarens panel (en gång per ändring)");
  ok(mem.has("classroom:local:widgets/QA-PL/_placement"), "lagras lokalt (classroom:local:), aldrig i molnet");
  offP();
}

// ---------------------------------------------------------------------------
// Elevskärm-dockan viker undan (issue #120)
// ---------------------------------------------------------------------------
{
  const { dockPlace, publishDockCovered, watchDockCovered, DOCK_COVERED_TEXT } = await import("../js/lib/dock.js");
  const R = (left, top, right, bottom) => ({ left, top, right, bottom });
  const opt = { minTop: 56, minLeft: 8, gap: 8 };
  const still = { dx: 0, dy: 0, covered: [] };
  // 1920×1080: docka nere till höger, widget L i br, kortet i mitten, Bra jobbat till höger.
  const collapsed = R(1608, 1032, 1908, 1068);  // hopfälld 300×36
  const open = R(1608, 698, 1908, 1068);        // utfälld 300×370
  const br = R(1575, 840, 1888, 1048);
  const card = R(540, 355, 1290, 772);
  const board = R(1512, 382, 1888, 745);
  const block = [card, board];
  ok(eq(dockPlace(collapsed, opt), still), "docka: inget att undvika → vanlig plats");
  ok(eq(dockPlace(collapsed, { ...opt, avoid: [R(400, 840, 700, 1048)], block }), still),
    "docka: widget nere till vänster → vanlig plats (inget ändras)");
  ok(eq(dockPlace(open, { ...opt, avoid: [], block }), still),
    "docka: ligger den bara över kortet/tavlan står den kvar (som förut)");
  // Hopfälld: åt vänster längs nederkanten, 8 px från widgeten.
  const c = dockPlace(collapsed, { ...opt, avoid: [br], block });
  ok(c.dx === 1575 - 8 - 1908 && c.dy === 0 && !c.covered.length, "docka: hopfälld flyttas åt vänster, 8 px från widgeten");
  // Utfälld: vänster skulle skymma kortets hörn, upp Bra jobbat → står kvar, widgeten skymd.
  const o = dockPlace(open, { ...opt, avoid: [br], block });
  ok(eq(o, { dx: 0, dy: 0, covered: [0] }), "docka: utfälld — vänster skymmer kortet, upp tavlan → står kvar + skymd");
  // Kandidat som överlappar kortet förkastas, även om upp skulle gå: här finns ingen tavla.
  const up = dockPlace(open, { ...opt, avoid: [br], block: [card] });
  ok(up.dx === 0 && up.dy === 832 - 1068 && !up.covered.length, "docka: vänster skymmer kortet → upp ovanför widgeten");
  // Lägre kort och tavla: vänster ryms.
  const left = dockPlace(open, { ...opt, avoid: [br], block: [R(540, 355, 1200, 690), R(1512, 382, 1888, 690)] });
  ok(left.dx === 1575 - 8 - 1908 && left.dy === 0, "docka: utfälld åt vänster när kortet inte är i vägen");
  // Båda ryms → vänster.
  const tie = dockPlace(collapsed, { ...opt, avoid: [br] });
  ok(tie.dy === 0 && tie.dx < 0, "docka: båda ryms → vänster");
  // Vänster förbi två widgets i rad.
  const two = dockPlace(collapsed, { ...opt, avoid: [br, R(1300, 1000, 1560, 1060)] });
  ok(two.dx === 1300 - 8 - 1908 && !two.covered.length, "docka: åt vänster förbi två widgets i rad");
  // Gränser: upp in i verktygsraden, vänster förbi lärarpanelen → står kvar.
  const br720 = R(1040, 550, 1250, 690);
  const tall = dockPlace(R(968, 100, 1268, 708), { ...opt, minLeft: 900, avoid: [br720] });
  ok(eq(tall, { dx: 0, dy: 0, covered: [0] }), "docka: verktygsraden och vänstergränsen respekteras");
  // 1280×720 utfälld med en klocka uppe till höger → ingen plats → står kvar, br skymd.
  const stay = dockPlace(R(968, 338, 1268, 708), { ...opt, minLeft: 340, avoid: [R(1000, 80, 1250, 300), br720], block: [R(330, 220, 860, 548)] });
  ok(eq(stay, { dx: 0, dy: 0, covered: [1] }), "docka: ryms ingenstans → vanlig plats, widgeten i br rapporteras skymd");
  // Publicering av skymda id:n: bara vid ändring.
  const seen = [];
  const off = watchDockCovered((ids) => seen.push(ids.join(",")));
  publishDockCovered(["b", "a"]);
  publishDockCovered(["a", "b"]);
  publishDockCovered([]);
  off();
  publishDockCovered(["c"]);
  ok(eq(seen, ["", "a,b", ""]), "docka: skymda id:n publiceras sorterade, bara vid ändring");
  publishDockCovered([]);
  ok(/Elevskärm-panelen/.test(DOCK_COVERED_TEXT), "docka: panelens rad nämner Elevskärm-panelen");
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
