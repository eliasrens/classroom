/**
 * TEST — Lottningens logik (issue #47).
 *
 *   node docs/test-lotta.mjs
 *
 * Rena funktioner — ingen DOM, inget nätverk. Påhittade namn. Kontrollerar:
 *   - randomInt: inom intervallet, förkastar värden som skulle ge modulo-bias,
 *     och en ungefär jämn fördelning med riktig crypto-slump
 *   - hjulets slutvinkel pekar ALLTID på den dragna biten (alla n, alla index)
 *   - namnrullens landningsrad bär ALLTID det dragna alternativet
 *   - "inga upprepningar": 25 dragningar ur 25 elever ger 25 olika, sedan tomt
 *   - frånvarande dras aldrig; frånvaro gäller bara samma dag
 *   - egna listor: en rad per alternativ, tomma rader bort, dubbletter isär
 *   - alla animationer (inkl. resultatets inträde) ≤ 3 s
 */

const L = await import("../js/lib/lotta.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}\n  fick:     ${JSON.stringify(a)}\n  förväntat: ${JSON.stringify(b)}`);

// ---- randomInt ----

{
  // Modulo-bias: n = 3, 2^32 % 3 = 1 → värdet 2^32-1 ligger i den ofullständiga omgången och måste förkastas.
  const seq = [2 ** 32 - 1, 7];
  let i = 0;
  eq(L.randomInt(3, () => seq[i++]), 7 % 3, "randomInt förkastar värden över största multipeln av n");
  eq(i, 2, "randomInt drog ett nytt värde efter förkastningen");
  eq(L.randomInt(1), 0, "randomInt(1) = 0");
  let threw = false;
  try { L.randomInt(0); } catch { threw = true; }
  ok(threw, "randomInt(0) kastar");

  const n = 7;
  const counts = new Array(n).fill(0);
  const N = 70000;
  let inRange = true;
  for (let k = 0; k < N; k++) {
    const x = L.randomInt(n);
    if (!(Number.isInteger(x) && x >= 0 && x < n)) inRange = false;
    else counts[x]++;
  }
  ok(inRange, "randomInt inom [0, n)");
  const exp = N / n;
  ok(counts.every((c) => Math.abs(c - exp) < exp * 0.06), `randomInt ungefär jämn fördelning: ${counts.join(", ")}`);
}

// ---- Hjulet landar på den dragna biten ----

for (const n of [1, 2, 3, 5, 8, 13, 25, 30, 40]) {
  for (let index = 0; index < n; index++) {
    for (const from of [0, 17.5, 359.9, 123.4]) {
      const seed = L.randomSeed();
      const to = L.wheelTarget(from, n, index, seed);
      if (L.wheelIndexAt(to, n) !== index) ok(false, `hjul n=${n} index=${index} from=${from} landade på ${L.wheelIndexAt(to, n)}`);
      else passed++;
      ok(to - from >= 4 * 360 && to - from < 6 * 360, `hjulet snurrar 4–5 varv (n=${n})`);
      eq(L.wheelTarget(from, n, index, seed), to, "samma frö → samma vinkel (elevskärmen)");
    }
  }
}

// ---- Namnrullen landar på den dragna ----

for (const n of [1, 2, 3, 7, 25, 30]) {
  for (let index = 0; index < n; index++) {
    for (const start of [0, n - 1, Math.floor(n / 2)]) {
      const land = L.reelLand(n, start, index, L.randomSeed());
      ok(L.reelItemAt(n, start, land) === index, `rulle n=${n} start=${start} index=${index}`);
      ok(land >= 24 - n || land >= n, "rullen rullar en bit");
    }
  }
}

// ---- Klassen: inga upprepningar, frånvaro, ångra ----

const NAMES = ["Alva", "Bruno", "Cleo", "Dino", "Edith", "Frans", "Gry", "Hugo", "Iris", "Juno",
  "Kasper", "Liv", "Milo", "Nora", "Otto", "Pim", "Quinn", "Rut", "Sixten", "Tyra",
  "Ulf", "Vera", "Wilgot", "Xenia", "Ymer"];
const students = NAMES.map((firstName, i) => ({ id: `s${i}`, firstName }));
students.push({ id: "gone", firstName: "Åke", active: false });
const items = L.studentItems(students, (s) => s.firstName);
eq(items.length, 25, "inaktiva elever är inte med");
eq(items[0].label, "Alva", "sorterat på förnamn");

{
  let drawn = [];
  const picked = [];
  for (let k = 0; k < 25; k++) {
    const pool = L.buildPool(items, { drawn, removeDrawn: true });
    eq(pool.length, 25 - k, `poolen krymper (${k})`);
    const it = pool[L.randomInt(pool.length)];
    picked.push(it.key);
    drawn = [...drawn, it.key];
  }
  eq(new Set(picked).size, 25, "25 dragningar → 25 olika");
  eq(L.buildPool(items, { drawn, removeDrawn: true }).length, 0, "alla dragna → tom pool (erbjud börja om)");
  eq(L.drawnItems(items, drawn).length, 25, "Redan dragna visar alla");
  eq(L.buildPool(items, { drawn: [], removeDrawn: true }).length, 25, "Hela klassen på nytt → full pool");
  // Ångra: sista tillbaka
  const undone = drawn.slice(0, -1);
  eq(L.buildPool(items, { drawn: undone, removeDrawn: true }).map((i) => i.key), [picked[24]], "Ångra ger tillbaka den senast dragna");
  eq(L.buildPool(items, { drawn, removeDrawn: false }).length, 25, "Ta bort den som dragits AV → alla kan dras");
}

{
  const today = new Date(2026, 8, 28, 9, 0);
  const tomorrow = new Date(2026, 8, 29, 7, 30);
  const doc = { date: L.todayKey(today), ids: ["s1", "s3"] };
  eq(L.absentToday(doc, today), ["s1", "s3"], "frånvarande idag");
  eq(L.absentToday(doc, tomorrow), [], "frånvaron nollställs nästa dag");
  const pool = L.buildPool(items, { absent: L.absentToday(doc, today), removeDrawn: true });
  ok(!pool.some((i) => i.key === "s1" || i.key === "s3"), "frånvarande finns inte i poolen");
  for (let k = 0; k < 500; k++) {
    const it = pool[L.randomInt(pool.length)];
    if (it.key === "s1" || it.key === "s3") { ok(false, "frånvarande drogs"); break; }
  }
  passed++;
}

// ---- Färger och egna listor ----

{
  const c = L.colorItems(undefined);
  eq(c.map((x) => x.key), L.DEFAULT_COLOR_IDS, "färglistans standard");
  ok(c.every((x) => /^#[0-9a-f]{6}$/i.test(x.color)), "varje färg har sin färg");
  eq(L.colorItems(["svart", "rod"]).map((x) => x.label), ["Röd", "Svart"], "valda färger i listans ordning");
  eq(L.colorItems([]).length, 0, "inga färger valda → tom lista");

  const list = L.customItems("  Läsa \n\nSkriva\nLäsa\n Räkna\n   \n");
  eq(list.map((x) => x.label), ["Läsa", "Skriva", "Läsa", "Räkna"], "en rad per alternativ, tomma bort");
  eq(new Set(list.map((x) => x.key)).size, 4, "dubbletter får egna nycklar");
  eq(L.customItems("").length, 0, "tom lista");
}

// ---- Tidsgränsen ----

for (const [m, ms] of Object.entries(L.DURATION_MS)) {
  ok(ms + L.RESULT_IN_MS <= L.MAX_DRAW_MS, `${m}: ${ms} + ${L.RESULT_IN_MS} ms ≤ 3 s`);
  ok(ms + 450 <= L.MAX_DRAW_MS, `${m}: resultatets ring ryms också`);
}
eq(L.DURATION_MS.direkt, 0, "Direkt har ingen animation");

// ---- Aldrig till molnet: datalagret med en molnattrapp (jfr test-outbox.mjs) ----

{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
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
  ok(isLocalOnlyPath("classes/4X/lotta"), "classes/{cid}/lotta är ENDAST LOKAL");
  const data = createDataLayer({ createSync: factory });
  const P = "classes/4X/lotta";
  await data.put(P, { id: "stage", items: [{ label: "Alva" }, { label: "Bruno" }], result: 1 });
  await data.put(P, { id: "drawn", lists: { klassen: ["s1"] } });
  await data.put(P, { id: "absent", date: L.todayKey(), ids: ["s0"] });
  await data.put(P, { id: "list-abc", name: "Stationer", text: "Läsa\nSkriva" });
  await data.patch(P, "settings", { list: "klassen" });
  await data.remove(P, "list-abc");
  await data.put("classes/4X/settings", { id: "kontroll", value: 1 }); // synkad samling
  await new Promise((r) => setTimeout(r, 300));
  ok(pushed.includes("classes/4X/settings/kontroll"), `kontroll: en synkad samling når molnattrappen (${pushed.join(", ")})`);
  eq(pushed.filter((p) => p.includes("/lotta/")), [], "ingen lottningsskrivning når molnet");
  eq([...store.keys()].filter((k) => k.startsWith("classroom:outbox") && store.get(k).includes("lotta")), [], "ingen lottningsop i outboxen");
  ok((await data.get(P, "stage"))?.result === 1, "lottningen finns lokalt");
}

console.log(`${passed} OK, ${failed} fel`);
process.exit(failed ? 1 : 0);
