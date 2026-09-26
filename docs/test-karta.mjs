/**
 * TEST — Tankekartan (issue #53, grenar och färger #59).
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
 * Grenar och färger (#59):
 *   - trädlayouten: inga överlapp i alla format, även 8 huvudbubblor × 4
 *     grenar + under-grenar; grenarna står utåt från sin förälder och hålls
 *     ihop (liten drift); fästa bubblor tar med sig sina grenar
 *   - trädlogiken (js/modes/karta/tree.js): nivåer, trädordning, gren med
 *     allt under, lagning av föräldrar (okänd, sig själv, slinga, för djup)
 *   - migrering: en karta i #53-formatet blir huvudnivå, molnet sin gamla färg
 *   - färgerna: grenar ärver en ljusare nyans, all text klarar WCAG AA, även
 *     molnets rubrik på de djupa molnfärgerna
 */

const L = await import("../js/lib/karta-layout.js");
const { PALETTE, INK, contrast, bubbleColor, CLOUD_COLORS, cloudColor, resolveColors, tint, AUTO_COLORS, NEUTRAL } = await import("../js/modes/karta/palette.js");
const T = await import("../js/modes/karta/tree.js");

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

// ---- Grenar: trädlayouten (#59) ----

/**
 * Ett påhittat träd: `mains` huvudbubblor med `kids` grenar var, och en
 * under-gren under första grenen hos de `grand` första. Mått som i
 * scenen: grenar 88 %, under-grenar 78 % av textstorleken.
 */
function fakeTree(mains, kids, grand = 0, seed = 3) {
  const n = mains * (1 + kids) + Math.min(grand, mains);
  const f = L.baseFontFor(n);
  const out = [];
  let s = seed;
  const one = (k) => fakeBubbles(1, f * k, s++)[0];
  for (let m = 0; m < mains; m++) {
    const mi = out.length;
    out.push({ ...one(1), parent: -1 });
    for (let k = 0; k < kids; k++) {
      const ki = out.length;
      out.push({ ...one(0.88), parent: mi });
      if (k === 0 && m < grand) out.push({ ...one(0.78), parent: ki });
    }
  }
  return out;
}

const TREES = [[1, 1, 0], [1, 4, 1], [6, 3, 1], [6, 0, 0], [2, 3, 2], [8, 3, 0], [8, 4, 2], [8, 4, 8], [4, 2, 4]];
for (const [name, ar] of Object.entries(ASPECTS)) {
  const { w, h } = L.sceneSize(ar);
  for (const cloud of CLOUDS) {
    for (const [m, k, g] of TREES) {
      for (const seed of [3, 11]) {
        const bubbles = fakeTree(m, k, g, seed);
        const t0 = Date.now();
        const res = L.layoutMap({ w, h, cloud, bubbles });
        const ms = Date.now() - t0;
        const c = { rx: cloud.rx * res.cloudScale, ry: cloud.ry * res.cloudScale };
        const tag = `${name} ${m}×${k}+${g} moln=${cloud.rx} (${bubbles.length} bubblor)`;
        ok(res.items.length === bubbles.length, `${tag}: alla placerade`);
        ok(res.ok && L.isClean({ w, h, cloud: c, items: res.items, margin: 0, gap: 0 }), `${tag}: inga överlapp, inget i molnet, allt inom scenen (skala ${res.scale})`);
        ok(res.scale >= 0.8, `${tag}: texten krymper högst till 80 % (fick ${res.scale})`);
        if (k > 0) ok((res.drift ?? 0) <= 1, `${tag}: grenarna hålls ihop (drift ${res.drift?.toFixed(2)})`);
        ok(ms < 1500, `${tag}: layouten tar under 1,5 s (${ms} ms)`);
        // Utåt: nästan alla grenar står åt samma håll från föräldern som
        // föräldern står från molnet (inte tillbaka in mot molnet).
        // (Stående: trångt åt sidorna — där får en gren oftare stå bredvid.)
        const kidsIdx = bubbles.map((b, i) => (b.parent >= 0 ? i : -1)).filter((i) => i >= 0);
        const outward = kidsIdx.filter((i) => {
          const c = res.items[i];
          const p = res.items[bubbles[i].parent];
          return (c.x - p.x) * (p.x - w / 2) + (c.y - p.y) * (p.y - h / 2) > 0;
        }).length;
        const need = ar >= 1 ? 0.8 : 0.6;
        if (kidsIdx.length) ok(outward / kidsIdx.length >= need, `${tag}: grenarna står utåt från föräldern (${outward}/${kidsIdx.length})`);
      }
    }
  }
}

{
  // Utan grenar: exakt samma layout som före #59 (ringarna) — parent -1 ändrar inget.
  const { w, h } = L.sceneSize(16 / 9);
  const flat = fakeBubbles(12, L.baseFontFor(12));
  const a = L.layoutMap({ w, h, cloud: CLOUDS[0], bubbles: flat });
  const b = L.layoutMap({ w, h, cloud: CLOUDS[0], bubbles: flat.map((x) => ({ ...x, parent: -1 })) });
  ok(JSON.stringify(a) === JSON.stringify(b), "kartor utan grenar får samma layout som i #53");
  // Deterministiskt även med grenar (elevskärmen = läraren).
  const tree = fakeTree(6, 3, 1);
  ok(JSON.stringify(L.layoutMap({ w, h, cloud: CLOUDS[1], bubbles: tree })) === JSON.stringify(L.layoutMap({ w, h, cloud: CLOUDS[1], bubbles: tree })), "trädlayouten är deterministisk");
}

{
  // En fäst (dragen) huvudbubbla tar med sig sina grenar.
  const { w, h } = L.sceneSize(16 / 9);
  const bubbles = fakeTree(5, 3, 0);
  bubbles[0].pin = { x: 0.82, y: 0.78 };
  const res = L.layoutMap({ w, h, cloud: CLOUDS[0], bubbles });
  ok(res.ok, "med en fäst gren: inga överlapp");
  ok(Math.abs(res.items[0].x - 0.82 * w) < 1 && Math.abs(res.items[0].y - 0.78 * h) < 1, "den fästa bubblan står kvar");
  const near = [1, 2, 3].every((i) => Math.hypot(res.items[i].x - res.items[0].x, res.items[i].y - res.items[0].y) < w * 0.3);
  ok(near, "grenarna följer med sin fästa förälder");
}

{
  // buildTree: slingor och ogiltiga föräldrar blir huvudnivå.
  const t = L.buildTree([{ parent: 1 }, { parent: 0 }, { parent: 7 }, { parent: 2 }, { parent: 3 }]);
  ok(t.parent[2] === -1 && t.level[3] === 2 && t.level[4] === 3, "buildTree: okänd förälder → huvudnivå, nivåer räknas");
  ok(t.parent.filter((p) => p === -1).length >= 2 && t.depth === 3, "buildTree: en slinga bryts");
}

// ---- Grenar: trädlogiken (#59) ----

{
  const bubbles = [
    { id: "a" }, { id: "b" }, { id: "a1", parentId: "a" }, { id: "a2", parentId: "a" },
    { id: "a1x", parentId: "a1" }, { id: "b1", parentId: "b" },
  ];
  const d = T.depths(bubbles);
  ok(d.get("a") === 1 && d.get("a1") === 2 && d.get("a1x") === 3, "nivåer: huvudbubbla 1, gren 2, under-gren 3");
  ok(T.treeOrder(bubbles).map((b) => b.id).join(",") === "a,a1,a1x,a2,b,b1", "trädordning: föräldern följs av sina grenar (tabbordningen)");
  ok([...T.subtreeIds(bubbles, "a")].sort().join(",") === "a,a1,a1x,a2", "en bubbla med alla sina grenar (tas bort tillsammans)");
  ok(T.subtreeIds(bubbles, "b1").size === 1, "ett löv är bara sig självt");

  const fixed = T.repairParents([
    { id: "r" }, { id: "x", parentId: "saknas" }, { id: "s", parentId: "s" },
    { id: "c1", parentId: "c2" }, { id: "c2", parentId: "c1" },
    { id: "d1", parentId: "r" }, { id: "d2", parentId: "d1" }, { id: "d3", parentId: "d2" }, { id: "d4", parentId: "d3" },
  ]);
  const P = Object.fromEntries(fixed.map((b) => [b.id, b.parentId]));
  ok(P.r === null && P.x === null && P.s === null, "lagning: ingen, okänd eller sig själv som förälder → huvudnivå");
  ok(P.c1 === null || P.c2 === null, "lagning: en slinga bryts");
  const dd = T.depths(fixed);
  ok(Math.max(...dd.values()) <= T.MAX_DEPTH && P.d2 === "d1" && dd.get("d3") === 3 && dd.get("d4") === 3, `lagning: högst ${T.MAX_DEPTH} nivåer — för djupa flyttas upp`);
  ok(T.repairParents([{ id: "g" }])[0].parentId === null, "gammalt format utan parentId → huvudnivå");
}

// ---- Paletten ----

for (const c of PALETTE) {
  const k = contrast(INK, c.bg);
  ok(k >= 4.5, `${c.id}: kontrasten ${k.toFixed(1)}:1 ska klara WCAG AA (4,5:1)`);
  ok(contrast(c.edge, c.bg) > 1.2, `${c.id}: kanten syns mot bubblan`);
}
ok(bubbleColor(PALETTE.length) === PALETTE[0] && bubbleColor(-1) === PALETTE[PALETTE.length - 1], "färgerna går runt");
ok(AUTO_COLORS === 9 && PALETTE[NEUTRAL].id === "krita", "nio färger i tur och ordning, och en neutral");

{
  // Grenar ärver förälderns färg i en ljusare nyans; text och kant syns ändå.
  const bubbles = [
    { id: "m", color: 3, parentId: null },
    { id: "g", color: null, parentId: "m" },
    { id: "u", color: null, parentId: "g" },
    { id: "e", color: 5, parentId: "m" },
    { id: "eu", color: null, parentId: "e" },
  ];
  const c = resolveColors(bubbles);
  ok(c.get("m").bg === PALETTE[3].bg && !c.get("m").inherited, "huvudbubblan har sin egen färg");
  ok(c.get("g").inherited && c.get("g").index === 3 && c.get("g").bg !== PALETTE[3].bg, "grenen ärver förälderns färg, ljusare");
  ok(contrast(c.get("u").bg, "#ffffff") < contrast(c.get("g").bg, "#ffffff"), "under-grenen är ännu ljusare");
  ok(c.get("e").bg === PALETTE[5].bg && c.get("eu").index === 5, "en gren med egen färg ger den vidare till sina grenar");
  ok(tint("#000000", 0.5) === "#808080" && tint("#123456", 0) === "#123456", "tint blandar mot vitt");
  for (const p of PALETTE.keys()) {
    for (const [steps, b] of [[1, { id: "k", color: null, parentId: "p" }], [2, { id: "k2", color: null, parentId: "k" }]]) {
      const cc = resolveColors([{ id: "p", color: p, parentId: null }, { id: "k", color: null, parentId: "p" }, b]).get(b.id);
      ok(contrast(INK, cc.bg) >= 4.5, `${PALETTE[p].id} nivå ${steps + 1}: texten klarar WCAG AA (${contrast(INK, cc.bg).toFixed(1)}:1)`);
      ok(contrast(cc.edge, cc.bg) > 1.2, `${PALETTE[p].id} nivå ${steps + 1}: kanten syns`);
    }
  }
}

{
  // Molnets färger: rubriken väljer själv INK eller vit — alltid AA.
  ok(CLOUD_COLORS.length >= 6 && CLOUD_COLORS.length <= 10, `ca 8 molnfärger (${CLOUD_COLORS.length})`);
  ok(cloudColor(0).fill === "#f8e5b5", "standardmolnet har samma färg som i #53");
  for (const i of CLOUD_COLORS.keys()) {
    const c = cloudColor(i);
    ok(contrast(c.ink, c.fill) >= 4.5, `molnet ${c.id}: rubriken klarar WCAG AA (${contrast(c.ink, c.fill).toFixed(1)}:1, ${c.ink})`);
  }
  ok(cloudColor(6).ink === "#ffffff" && cloudColor(0).ink === INK, "mörkt moln → vit rubrik, ljust moln → mörk");
}

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
  ok(empty.cloud === 0 && empty.autoColor === true, "en ny karta: standardmolnet, automatiska färger");

  // Migrering: en karta sparad av #53 (inget parentId, ingen cloud/autoColor).
  const old = K.normalizeMap({ id: "map-old", name: "", title: "Påhittad rubrik", nextColor: 3, rev: 7, bubbles: [
    { id: "b1", text: "Ett", color: 0 },
    { id: "b2", text: "Två", color: 1, pin: { x: 0.2, y: 0.3 } },
    { id: "b3", text: "Tre", color: 2 },
  ] });
  ok(old.bubbles.every((b) => b.parentId === null), "migrering: alla gamla bubblor blir huvudnivå");
  ok(old.bubbles.map((b) => b.color).join(",") === "0,1,2" && old.bubbles[1].pin.x === 0.2, "migrering: färger och dragna platser behålls");
  ok(old.cloud === 0 && old.autoColor === true && old.nextColor === 3 && old.title === "Påhittad rubrik", "migrering: molnet och resten som förut");

  // Grenar sparas och läses tillbaka; skräp lagas.
  const br = K.normalizeMap({ id: "map-br", cloud: 6, autoColor: false, bubbles: [
    { id: "m", text: "Huvud", color: 2, parentId: null },
    { id: "g", text: "Gren", color: null, parentId: "m" },
    { id: "u", text: "Under", parentId: "g" },
    { id: "x", text: "Föräldralös", color: null, parentId: "borta" },
    { id: "y", text: "Egen färg", color: 4, parentId: "m" },
  ] });
  const byId = Object.fromEntries(br.bubbles.map((b) => [b.id, b]));
  ok(byId.g.parentId === "m" && byId.u.parentId === "g" && byId.y.parentId === "m", "grenarna finns kvar efter omladdning");
  ok(byId.g.color === null && byId.u.color === null && byId.y.color === 4, "gren utan egen färg ärver (null), egen färg behålls");
  ok(byId.x.parentId === null && byId.x.color === 0, "en gren vars förälder saknas blir huvudbubbla med en färg");
  ok(br.cloud === 6 && br.autoColor === false, "molnets färg och Färglägg automatiskt sparas per karta");
  ok(K.normalizeMap({ id: "map-c", cloud: 99 }).cloud === 0, "okänd molnfärg → standard");
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
