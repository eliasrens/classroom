/**
 * LOTTNING (issue #47) — ren logik utan DOM: rättvis slump, listornas
 * innehåll, poolen (vad som kan dras just nu) och animationernas mål.
 *
 * Rättvis slump: resultatet väljs med crypto.getRandomValues och
 * förkastningssampling (ingen modulo-bias). Läraren avgör resultatet och
 * skickar det — plus ett frö och hjulets vinklar — till elevskärmen, som
 * spelar upp EXAKT samma animation (seededRandom är deterministisk).
 * Animationernas "slump" (hur många varv, var i tårtbiten pilen hamnar,
 * hur lapparna skakar) påverkar aldrig VEM som dras.
 *
 * Testas i Node: node docs/test-lotta.mjs
 */

/** Sätten att dra. Varje animation (inklusive resultatets inträde) ≤ 3 s. */
export const METHODS = [
  { id: "hjul", label: "Lyckohjul" },
  { id: "rulle", label: "Namnrulle" },
  { id: "lapp", label: "Dra en lapp" },
  { id: "direkt", label: "Direkt" },
];
export const METHOD_IDS = METHODS.map((m) => m.id);
export const DEFAULT_METHOD = "hjul";

/**
 * Animationens längd (ms) per sätt. Resultatet tonar in på ≤ 300 ms därefter
 * (ringen runt det ≤ 450 ms) — allt ryms under MAX_DRAW_MS.
 */
export const DURATION_MS = { hjul: 2400, rulle: 2200, lapp: 2300, direkt: 0 };
export const RESULT_IN_MS = 300;
export const MAX_DRAW_MS = 3000;

/** Fler alternativ än så blir svårlästa på hjulet → föreslå namnrullen. */
export const WHEEL_COMFORT_MAX = 24;

/** De inbyggda listorna. Egna listor har nyckeln = dokument-id ("list-…"). */
export const LIST_CLASS = "klassen";
export const LIST_COLORS = "farger";
export const isCustomList = (key) => typeof key === "string" && key.startsWith("list-");

/** Färglistan: tydliga, pedagogiska färger (innehåll för eleverna, inte UI). */
export const COLORS = [
  { id: "rod", name: "Röd", hex: "#d6332b" },
  { id: "bla", name: "Blå", hex: "#2463c9" },
  { id: "gron", name: "Grön", hex: "#2f9a48" },
  { id: "gul", name: "Gul", hex: "#f3c614" },
  { id: "orange", name: "Orange", hex: "#ee7a18" },
  { id: "lila", name: "Lila", hex: "#7b45b0" },
  { id: "rosa", name: "Rosa", hex: "#ea6aa8" },
  { id: "svart", name: "Svart", hex: "#1c1e21" },
  { id: "vit", name: "Vit", hex: "#ffffff" },
  { id: "brun", name: "Brun", hex: "#88562d" },
  { id: "gra", name: "Grå", hex: "#8b9097" },
  { id: "turkos", name: "Turkos", hex: "#17aeb0" },
];
export const DEFAULT_COLOR_IDS = ["rod", "bla", "gron", "gul", "orange", "lila", "rosa", "svart"];

// ---- Slump ------------------------------------------------------------------

function randomUint32() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0];
}

/**
 * Rättvist heltal i [0, n) — förkastningssampling: värden i den
 * ofullständiga sista "omgången" av 2^32 kastas, så varje utfall har
 * exakt samma sannolikhet (ingen modulo-bias).
 */
export function randomInt(n, next = randomUint32) {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError("randomInt: n måste vara ett positivt heltal");
  if (n === 1) return 0;
  const limit = 2 ** 32 - (2 ** 32 % n); // största multipel av n som ryms
  for (;;) {
    const x = next();
    if (x < limit) return x % n;
  }
}

/** Frö till animationen (påverkar aldrig resultatet). */
export const randomSeed = () => randomUint32();

/** Deterministisk PRNG (mulberry32): samma frö → samma följd i alla fönster. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Datum ------------------------------------------------------------------

/** Lokalt datum "YYYY-MM-DD" — frånvaron gäller bara den dagen. */
export function todayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Dagens frånvarande (id-lista) — tom om dokumentet gäller en annan dag. */
export function absentToday(doc, date = new Date()) {
  return doc?.date === todayKey(date) && Array.isArray(doc.ids) ? doc.ids.filter((x) => typeof x === "string") : [];
}

// ---- Listornas alternativ ----------------------------------------------------
// Ett alternativ = { key, label, color? }. key är stabil (elev-id,
// färg-id, textrad) och är det som sparas i "Redan dragna".

/** Klassens elever (aktiva), sorterade på förnamn. label = färdig visningstext. */
export function studentItems(students, labelOf) {
  return (students ?? [])
    .filter((s) => s && s.active !== false && typeof s.id === "string")
    .sort((a, b) => String(a.firstName ?? "").localeCompare(String(b.firstName ?? ""), "sv"))
    .map((s) => ({ key: s.id, label: labelOf(s) }));
}

/** Valda färger i färglistans ordning. */
export function colorItems(ids) {
  const on = new Set(Array.isArray(ids) ? ids : DEFAULT_COLOR_IDS);
  return COLORS.filter((c) => on.has(c.id)).map((c) => ({ key: c.id, label: c.name, color: c.hex }));
}

/** Egen lista: en rad per alternativ. Dubbletter får egna nycklar ("Läsa#2"). */
export function customItems(text) {
  const seen = new Map();
  const items = [];
  for (const raw of String(text ?? "").split("\n")) {
    const label = raw.trim();
    if (!label) continue;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    items.push({ key: n === 1 ? label : `${label}#${n}`, label });
  }
  return items;
}

/**
 * Poolen = det som kan dras nu: listans alternativ minus frånvarande
 * (bara Klassen) och — när "Ta bort den som dragits" är på — minus de
 * redan dragna.
 */
export function buildPool(items, { absent = [], drawn = [], removeDrawn = false } = {}) {
  const out = new Set(absent);
  if (removeDrawn) for (const k of drawn) out.add(k);
  return items.filter((it) => !out.has(it.key));
}

/** "Redan dragna" som finns kvar i listan, i dragordning. */
export function drawnItems(items, drawn) {
  const byKey = new Map(items.map((it) => [it.key, it]));
  return (drawn ?? []).map((k) => byKey.get(k)).filter(Boolean);
}

// ---- Animationernas mål (deterministiska ur fröet) ---------------------------

/** Mjuk inbromsning. */
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeOutQuart = (t) => 1 - (1 - t) ** 4;

/**
 * Lyckohjulet: tårtbit i spänner [i·s, (i+1)·s] grader medurs från toppen
 * (där pilen sitter). Hjulet vrids R grader medurs → bitens mitt står vid
 * (i+½)·s + R. Slutvinkeln ger 4–5 hela varv och landar någonstans inne
 * i biten (inte på kanten) — fröet avgör var, aldrig VILKEN bit.
 */
export function wheelTarget(from, count, index, seed) {
  const rnd = seededRandom(seed);
  const s = 360 / count;
  const jitter = (rnd() - 0.5) * s * 0.6;
  const target = -((index + 0.5) * s) + jitter;
  const delta = (((target - from) % 360) + 360) % 360;
  const turns = 4 + Math.floor(rnd() * 2);
  return from + turns * 360 + delta;
}

/** Vilken tårtbit pilen (toppen) pekar på vid vinkeln angle. */
export function wheelIndexAt(angle, count) {
  const s = 360 / count;
  const a = (((-angle) % 360) + 360) % 360;
  return Math.floor(a / s) % count;
}

/**
 * Namnrullen: raderna är alternativen i ordning (runt, med start i
 * `start`). Rullen snurrar minst ~24 rader och landar på rad `land`,
 * där resultatet står.
 */
export function reelLand(count, start, index, seed) {
  const rnd = seededRandom(seed);
  const cycles = Math.max(1, Math.ceil(24 / count)) + Math.floor(rnd() * 2);
  const offset = (((index - start) % count) + count) % count;
  return cycles * count + offset;
}

/** Alternativet på rad k i namnrullen. */
export const reelItemAt = (count, start, k) => (((start + k) % count) + count) % count;

/** Normalisera en vinkel till [0, 360) (hjulet står still där mellan dragningar). */
export const normAngle = (a) => ((Number(a) || 0) % 360 + 360) % 360;
