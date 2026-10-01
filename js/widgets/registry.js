/**
 * WIDGETS — registret (epic #114, del 1 = issue #115).
 *
 * En widget-typ är ett rent objekt (se js/widgets/README.md):
 *
 *   {
 *     id: "clock-digital", name: "Klocka (digital)", icon: "clock",
 *     multiple: false,              // true = "+ Lägg till" (flera samtidigt, t.ex. timrar)
 *     defaults() → cfg,             // standardinställningar
 *     normalize?(cfg) → cfg,        // valfri; standard = { ...defaults(), ...cfg }
 *     renderChip(el, cfg, ctx),     // kompakt bricka i lektionens rubrikrad
 *     renderLarge(el, cfg, ctx),    // stor form i ett hörn på Morgonskärmen
 *     settingsHTML?(cfg, ctx) → "", // valfria egna inställningar (färdig HTML)
 *     bindSettings?(root, cfg, onChange) → cleanup?,
 *     destroy(el),                  // städa det render* satte upp i el
 *   }
 *
 * Nya typer (del 2–4) läggs till i TYPES nedan — en rad per typ.
 *
 * Här finns också datamodellens normalisering, ren och utan DOM (körs i
 * Node, docs/test-widgets.mjs):
 *   - lektionen: plan.widgets = [{ id, type, cfg }]
 *   - Morgonskärmen: widgets = [{ id, type, slot, size, cfg }] i klassens
 *     DELADE morgoninställningar (js/lib/morning.js — ingen elevdata).
 *
 * Okända typer (t.ex. skrivna av en nyare version av appen) behålls vid
 * normalisering men renderas inte — annars skulle en äldre flik radera
 * dem vid nästa sparning.
 */

import clockDigital from "./clock-digital.js";
import clockAnalog from "./clock-analog.js";
import { timeLeft, countdown } from "./timers.js";

const TYPES = [clockDigital, clockAnalog, timeLeft, countdown];

/** Högst så många brickor visas i lektionens rubrikrad. */
export const MAX_CHIPS = 3;
/** Morgonskärmens hörnplatser: uppe vänster, uppe höger, nere vänster, nere höger. */
export const SLOTS = ["tl", "tr", "bl", "br"];
export const SLOT_LABELS = { tl: "Uppe till vänster", tr: "Uppe till höger", bl: "Nere till vänster", br: "Nere till höger" };
/** Storlekar på Morgonskärmen. */
export const SIZES = ["s", "m", "l"];
export const SIZE_LABELS = { s: "S", m: "M", l: "L" };
export const DEFAULT_SIZE = "m";

/** Alla registrerade typer, i den ordning de visas i inställningarna. */
export function widgetTypes() {
  return TYPES;
}

/** Typen med id, eller null (okänd typ). */
export function widgetType(id) {
  return TYPES.find((t) => t.id === id) ?? null;
}

/** Nytt instans-id. */
export function newWidgetId() {
  return globalThis.crypto?.randomUUID?.() ?? `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

/** Typens inställningar ifyllda med standardvärden. Okänd typ → cfg orörd (kopierad). */
export function normalizeCfg(type, cfg) {
  const t = widgetType(type);
  const raw = isObj(cfg) ? cfg : {};
  if (!t) return structuredClone(raw);
  if (typeof t.normalize === "function") return t.normalize(raw);
  return { ...t.defaults(), ...raw };
}

/**
 * Ett giltigt { id, type } eller null. Saknat id (trasig data) ersätts med
 * ett STABILT id ur platsen i listan — samma data ger alltid samma id.
 */
function baseOf(w, index) {
  if (!isObj(w)) return null;
  const type = typeof w.type === "string" ? w.type.trim() : "";
  if (!type) return null;
  const id = typeof w.id === "string" && w.id ? w.id : `${type}-${index}`;
  return { id, type };
}

/** En ny widget-instans för lektionen. */
export function createLessonWidget(type) {
  return { id: newWidgetId(), type, cfg: normalizeCfg(type, null) };
}

/**
 * plan.widgets → [{ id, type, cfg }]. Standard []. Trasiga poster och
 * dubbletter (samma id) tas bort; en typ som inte får finnas flera gånger
 * behålls bara första gången.
 */
export function normalizeLessonWidgets(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  const singles = new Set();
  list.forEach((w, i) => {
    const b = baseOf(w, i);
    if (!b || ids.has(b.id)) return;
    const t = widgetType(b.type);
    if (t && !t.multiple) {
      if (singles.has(b.type)) return;
      singles.add(b.type);
    }
    ids.add(b.id);
    out.push({ ...b, cfg: normalizeCfg(b.type, w.cfg) });
  });
  return out;
}

/**
 * Widgets för en KOPIA av en planering (Kopiera, Skicka kopia): samma typer
 * och inställningar men nya id:n — annars skulle kopian dela körtillstånd
 * (t.ex. en timer som går) med originalet.
 */
export function copyLessonWidgets(list) {
  return normalizeLessonWidgets(list).map((w) => ({ ...w, id: newWidgetId() }));
}

/** Brickorna som ska VISAS i rubrikraden: kända typer, högst MAX_CHIPS. */
export function chipWidgets(list) {
  return normalizeLessonWidgets(list).filter((w) => widgetType(w.type)).slice(0, MAX_CHIPS);
}

/** Första lediga hörnplats (i SLOTS-ordning), eller null om alla är tagna. */
export function freeSlot(list, except = null) {
  const taken = new Set((list ?? []).filter((w) => w.id !== except).map((w) => w.slot));
  return SLOTS.find((s) => !taken.has(s)) ?? null;
}

/** En ny widget-instans för Morgonskärmen (första lediga plats), eller null om platserna är slut. */
export function createMorningWidget(type, list = []) {
  const slot = freeSlot(list);
  if (!slot) return null;
  return { id: newWidgetId(), type, slot, size: DEFAULT_SIZE, cfg: normalizeCfg(type, null) };
}

/**
 * Morgonskärmens widgets → [{ id, type, slot, size, cfg }]. Två widgets
 * kan aldrig ha samma plats: en krock får nästa lediga plats, och när alla
 * fyra är tagna faller resten bort. Ogiltig storlek → M.
 */
export function normalizeMorningWidgets(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  const singles = new Set();
  const pending = []; // saknar/krockar plats — får en ledig plats efter de giltiga
  const order = new Map(); // id → plats i lärarens lista
  list.forEach((w, i) => {
    const b = baseOf(w, i);
    if (!b || ids.has(b.id)) return;
    const t = widgetType(b.type);
    if (t && !t.multiple) {
      if (singles.has(b.type)) return;
      singles.add(b.type);
    }
    ids.add(b.id);
    order.set(b.id, i);
    const item = {
      ...b,
      slot: SLOTS.includes(w.slot) ? w.slot : null,
      size: SIZES.includes(w.size) ? w.size : DEFAULT_SIZE,
      cfg: normalizeCfg(b.type, w.cfg),
    };
    if (item.slot && !out.some((x) => x.slot === item.slot)) out.push(item);
    else pending.push(item);
  });
  for (const item of pending) {
    const slot = freeSlot(out);
    if (!slot) break;
    out.push({ ...item, slot });
  }
  // Behåll lärarens ordning (ordningen i listan) — platsen ändrar den inte.
  return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}

// ---------------------------------------------------------------------------
// Platskollisioner på Morgonskärmen — ren geometri (testas i Node).
// ---------------------------------------------------------------------------

/** Överlappar två rektanglar { left, top, right, bottom } (med marginal `gap`)? */
export function rectsOverlap(a, b, gap = 0) {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

/**
 * Överlappar widgetens form `a` rektangeln `b` (med marginal `gap`)? En
 * rund widget (`a.round`, t.ex. den analoga klockan) räknas som cirkeln i
 * sin kvadrat — hörnen på kvadraten är tomma och får gå in över kortets
 * hörn (issue #119).
 */
export function shapeOverlaps(a, b, gap = 0) {
  if (!rectsOverlap(a, b, gap)) return false;
  if (!a.round) return true;
  const r = Math.min(a.right - a.left, a.bottom - a.top) / 2;
  const cx = (a.left + a.right) / 2;
  const cy = (a.top + a.bottom) / 2;
  const nx = Math.max(b.left, Math.min(cx, b.right));
  const ny = Math.max(b.top, Math.min(cy, b.bottom));
  return Math.hypot(cx - nx, cy - ny) < r + gap;
}

/**
 * Platserna i ordning efter avstånd från `slot` (närmast först). Avståndet
 * mäts mellan hörnen i en yta på width × height — på en bred skärm är
 * hörnet rakt under/över alltså närmare än hörnet på andra sidan.
 */
export function slotsByDistance(slot, width = 16, height = 9) {
  const pos = { tl: [0, 0], tr: [width, 0], bl: [0, height], br: [width, height] };
  const [x0, y0] = pos[slot] ?? pos.tl;
  return [...SLOTS].sort((a, b) =>
    Math.hypot(pos[a][0] - x0, pos[a][1] - y0) - Math.hypot(pos[b][0] - x0, pos[b][1] - y0));
}

/**
 * Var widgetarna faktiskt hamnar och hur stora de blir (issue #115, #119).
 *
 *   items     = [{ id, slot }] i prioritetsordning
 *   rectFor(item, slot, scale) = widgetens form på `slot` i skala `scale`
 *               (1 = lärarens storlek), { left, top, right, bottom, round? },
 *               förankrad i hörnet — en mindre form ligger inuti en större
 *   minScale(item) = minsta tillåtna skala (storlek S i förhållande till
 *               lärarens), standard 1 = krymp aldrig
 *   obstacles = rektanglar som aldrig får skymmas (kortet, Bra jobbat-tavlan),
 *               valfritt med `name` ("kortet") för panelens förklaring
 *
 * Ordning: 1) alla som ryms där läraren ställt dem, i sin storlek;
 * 2) de som inte gör det KRYMPER i sitt hörn till största skala som ryms
 * (hellre mindre än i ett annat hörn); 3) först när inte ens minsta skalan
 * ryms flyttas widgeten till närmaste lediga hörn (största skala som ryms
 * där). Den som står rätt knuffas aldrig bort.
 *
 * → Map(id → { slot, scale, blockedBy }) — `slot` null = ingen plats (döljs);
 *   `blockedBy` = namnen på det som skulle skymts i lärarens hörn och storlek
 *   (tom när widgeten står som läraren valt).
 */
export function resolveSlots(items, { rectFor, minScale = () => 1, obstacles = [], width = 16, height = 9, gap = 0 }) {
  const result = new Map();
  const placed = []; // { slot, rect }
  const obs = obstacles.filter(Boolean);
  const fits = (item, slot, scale) => {
    if (placed.some((p) => p.slot === slot)) return null;
    const rect = rectFor(item, slot, scale);
    if (!rect) return null;
    if (obs.some((o) => shapeOverlaps(rect, o, gap))) return null;
    if (placed.some((p) => shapeOverlaps(rect, p.rect, gap))) return null;
    return rect;
  };
  // Största skala i [min, 1] som ryms på slot (formen växer monotont i
  // hörnet → binärsökning), avrundad nedåt till hundradelar. null = ryms inte.
  const largest = (item, slot) => {
    if (fits(item, slot, 1)) return 1;
    const min = Math.min(1, Math.max(0, minScale(item) ?? 1));
    if (min >= 1 || !fits(item, slot, min)) return null;
    let lo = min, hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (fits(item, slot, mid)) lo = mid; else hi = mid;
    }
    return Math.max(min, Math.floor(lo * 100) / 100);
  };
  const place = (item, slot, scale) => {
    const blockedBy = blockers(item); // före push — widgeten skymmer aldrig sig själv
    placed.push({ slot, rect: rectFor(item, slot, scale) });
    result.set(item.id, { slot, scale, blockedBy });
  };
  // Vad som skulle skymts om widgeten stod som läraren valt (för panelen).
  const blockers = (item) => {
    const rect = rectFor(item, item.slot, 1);
    if (!rect) return [];
    const names = obs.filter((o) => shapeOverlaps(rect, o, gap)).map((o) => o.name ?? "");
    if (placed.some((p) => p.slot !== item.slot && shapeOverlaps(rect, p.rect, gap))) names.push("widget");
    return [...new Set(names)];
  };

  // 1) Alla som ryms där läraren ställt dem, i sin storlek.
  let rest = [];
  for (const item of items) {
    if (fits(item, item.slot, 1)) {
      placed.push({ slot: item.slot, rect: rectFor(item, item.slot, 1) });
      result.set(item.id, { slot: item.slot, scale: 1, blockedBy: [] });
    } else rest.push(item);
  }
  // 2) Krymp i det egna hörnet.
  const moving = [];
  for (const item of rest) {
    const scale = largest(item, item.slot);
    if (scale != null) place(item, item.slot, scale);
    else moving.push(item);
  }
  // 3) Flytta till närmaste hörn där den ryms (största skala där).
  rest = moving;
  for (const item of rest) {
    let done = false;
    for (const slot of slotsByDistance(item.slot, width, height)) {
      if (slot === item.slot) continue;
      const scale = largest(item, slot);
      if (scale != null) { place(item, slot, scale); done = true; break; }
    }
    if (!done) result.set(item.id, { slot: null, scale: 1, blockedBy: blockers(item) });
  }
  return result;
}
