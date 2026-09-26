/**
 * TEST — Tankekartan (issue #53).
 *
 *   node docs/test-karta.mjs
 *
 * Rena funktioner — ingen DOM, inget nätverk. Påhittade bubbeltexter
 * (bubblornas mått). Kontrollerar:
 *   - layouten: inga överlapp mellan bubblor, inga bubblor i molnet och
 *     alla inom scenen — 1 till 40 bubblor, i 16:9, 4:3 och papperens
 *     bildformat (A3/A4, liggande/stående), med korta och långa texter
 *   - samma bildformat ger samma layout (1920×1080 = 1280×720)
 *   - fästa (dragna) bubblor står kvar där läraren ställde dem
 *   - paletten: textens kontrast mot varje bubbla klarar WCAG AA (≥ 4,5:1)
 *   - normalizeMap: skräp faller bort, inget förifyllt innehåll i en tom karta
 *   - classes/{cid}/karta är ENDAST LOKAL: inget når molnattrappen eller outboxen
 */

const L = await import("../js/lib/karta-layout.js");
const { PALETTE, INK, contrast, bubbleColor } = await import("../js/modes/karta/palette.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}

// ---- Layouten ----

/** Påhittade bubbelmått vid textstorlek f: bredd efter "antal tecken", ibland två rader. */
function fakeBubbles(n, f, seed = 1) {
  const out = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const chars = 3 + (s % 26);                 // 3–28 tecken
    const lines = chars > 16 ? 2 : 1;
    const w = Math.min(12.5 * f, (Math.min(chars, 16) * 0.58 + 1.8) * f);
    const h = (lines * 1.22 + 0.9) * f + 4;
    out.push({ w, h });
  }
  return out;
}

const ASPECTS = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "A3 liggande": (419 - 30) / (296.5 - 30 - 12),
  "A3 stående": (296.5 - 30) / (419 - 30 - 12),
  "A4 liggande": (296.5 - 30) / (209 - 30 - 12),
  "A4 stående": (209 - 30) / (296.5 - 30 - 12),
};
const CLOUDS = [{ rx: 190, ry: 112 }, { rx: 372, ry: 171 }]; // tom rubrik / lång rubrik på två rader

for (const [name, ar] of Object.entries(ASPECTS)) {
  const { w, h } = L.sceneSize(ar);
  for (const cloud of CLOUDS) {
    for (const n of [1, 2, 3, 5, 8, 9, 10, 15, 20, 25, 30, 40]) {
      for (const seed of [1, 7]) {
        const bubbles = fakeBubbles(n, L.baseFontFor(n), seed);
        const res = L.layoutMap({ w, h, cloud, bubbles });
        const c = { rx: cloud.rx * res.cloudScale, ry: cloud.ry * res.cloudScale };
        ok(res.items.length === n, `${name} n=${n}: alla bubblor placerade`);
        ok(res.ok && L.isClean({ w, h, cloud: c, items: res.items, margin: 0, gap: 0 }),
          `${name} n=${n} moln=${cloud.rx}: inga överlapp, inget i molnet, allt inom scenen (skala ${res.scale})`);
        if (n <= 30 && name.startsWith("16:9")) ok(res.scale >= 0.8, `16:9 n=${n}: texten krymper högst till 80 % (fick ${res.scale})`);
      }
    }
  }
}

{
  // Samma bildformat ⇒ samma virtuella scen ⇒ samma layout (1920×1080 och 1280×720).
  const a = L.sceneSize(1920 / 1080);
  const b = L.sceneSize(1280 / 720);
  ok(Math.abs(a.w - b.w) < 1e-9 && Math.abs(a.h - b.h) < 1e-9, "1920×1080 och 1280×720 får samma scen");
  const bubbles = fakeBubbles(15, L.baseFontFor(15));
  const ra = L.layoutMap({ w: a.w, h: a.h, cloud: CLOUDS[1], bubbles });
  const rb = L.layoutMap({ w: b.w, h: b.h, cloud: CLOUDS[1], bubbles });
  ok(JSON.stringify(ra) === JSON.stringify(rb), "deterministisk: samma indata ⇒ exakt samma layout");
}

{
  // Fäst bubbla står kvar; de andra håller sig undan.
  const { w, h } = L.sceneSize(16 / 9);
  const bubbles = fakeBubbles(12, L.baseFontFor(12));
  bubbles[3].pin = { x: 0.15, y: 0.2 };
  const res = L.layoutMap({ w, h, cloud: CLOUDS[0], bubbles });
  ok(Math.abs(res.items[3].x - 0.15 * w) < 1 && Math.abs(res.items[3].y - 0.2 * h) < 1, "fäst bubbla står där läraren släppte den");
  ok(res.ok, "de andra bubblorna håller sig undan den fästa");
}

{
  // Kurvorna: börjar i molnets mitt och slutar i bubblans mitt.
  const d = L.linkPath(800, 450, 1200, 200);
  ok(/^M800 450 Q[-\d.]+ [-\d.]+ 1200 200$/.test(d), `kopplingen är en kvadratisk Bézier mitt→bubbla (${d})`);
  const cloud = L.cloudPath(200, 120, 190, 112);
  ok(cloud.d.startsWith("M") && cloud.d.endsWith("Z") && (cloud.d.match(/A/g) ?? []).length >= 8, "molnet är en sluten kontur med puffar");
}

// ---- Paletten ----

for (const c of PALETTE) {
  const k = contrast(INK, c.bg);
  ok(k >= 4.5, `${c.id}: kontrasten ${k.toFixed(1)}:1 ska klara WCAG AA (4,5:1)`);
  ok(contrast(c.edge, c.bg) > 1.2, `${c.id}: kanten syns mot bubblan`);
}
ok(bubbleColor(PALETTE.length) === PALETTE[0] && bubbleColor(-1) === PALETTE[PALETTE.length - 1], "färgerna går runt");

// ---- Kartdokumentet ----

{
  const K = await import("../js/modes/karta.js");
  ok(K.normalizeMap(null) === null && K.normalizeMap({ id: "state" }) === null, "bara map-<id> är kartor");
  const m = K.normalizeMap({ id: "map-1", bubbles: [
    { id: "a", text: "  Påhittad  text ", color: 2 },
    { id: "a", text: "dubblett" },
    { id: "b", text: "   " },
    { text: "utan id" },
    { id: "c", text: "Dragen", pin: { x: 2, y: -1 } },
  ] });
  ok(m.bubbles.length === 2, "tomma, dubbletter och bubblor utan id faller bort");
  ok(m.bubbles[0].text === "Påhittad text", "texten trimmas");
  ok(m.bubbles[1].pin.x === 1 && m.bubbles[1].pin.y === 0, "fäst plats hålls inom scenen");
  const empty = K.normalizeMap({ id: "map-2" });
  ok(empty.title === "" && empty.name === "" && empty.bubbles.length === 0, "en ny karta är tom: ingen rubrik, inget namn, inga bubblor");
  ok(K.mapLabel(empty) === "Ny karta", "listan visar \"Ny karta\" tills läraren skriver något");
  ok(K.mapLabel({ name: "", title: "Rubrik" }) === "Rubrik" && K.mapLabel({ name: "Eget", title: "Rubrik" }) === "Eget", "eget namn före rubriken");
}

// ---- Endast lokalt: inget når molnet ----

{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };
  globalThis.window = new EventTarget();
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  const pushed = [];
  const factory = ({ onStatus }) => ({
    async start() { onStatus?.("online"); return true; },
    watch() {},
    reset() {},
    async push(op) { pushed.push(`${op.path}/${op.id}`); },
  });
  const { createDataLayer } = await import("../js/data/datalayer.js");
  const { isLocalOnlyPath } = await import("../js/data/local-only.js");
  ok(isLocalOnlyPath("classes/4X/karta"), "classes/{cid}/karta är ENDAST LOKAL");
  const data = createDataLayer({ createSync: factory });
  const P = "classes/4X/karta";
  await data.put(P, { id: "map-abc", name: "", title: "Påhittad rubrik", bubbles: [{ id: "b1", text: "Påhittad bubbla", color: 0 }], nextColor: 1, rev: 1 });
  await data.put(P, { id: "state", cur: "map-abc", paper: "a3-landscape", rev: 2 });
  await data.remove(P, "map-abc");
  await data.put("classes/4X/settings", { id: "kontroll", value: 1 }); // synkad samling
  await new Promise((r) => setTimeout(r, 300));
  ok(pushed.includes("classes/4X/settings/kontroll"), `kontroll: en synkad samling når molnattrappen (${pushed.join(", ")})`);
  ok(pushed.every((p) => !p.includes("/karta/")), "ingen tankekarta når molnet");
  ok([...store.keys()].filter((k) => k.startsWith("classroom:outbox") && store.get(k).includes("karta")).length === 0, "ingen tankekarta i outboxen");
  ok((await data.get(P, "state"))?.cur === "map-abc", "tankekartan finns lokalt");
}

console.log(`${passed} OK, ${failed} fel`);
process.exit(failed ? 1 : 0);
