/**
 * WIDGETS — rendering i lägena (issue #115).
 *
 * Två former, samma typer (js/widgets/registry.js):
 *
 *  - BRICKOR i lektionens rubrikrad: `chipsHTML(plan.widgets)` ger markupen
 *    (tom sträng utan widgets → tavlan är exakt som förut), och en
 *    `createChipHost(ctx)` monterar typernas renderChip i den efter varje
 *    omritning av tavlan (`host.mount(container)`).
 *
 *  - HÖRN på Morgonskärmen: `createCornerLayer(stage, …)` lägger ett lager
 *    i `.morgon` med en ruta per widget på sin plats (tl/tr/bl/br, storlek
 *    S/M/L) och flyttar en widget som skulle skymma kortet eller Bra
 *    jobbat-tavlan till närmaste lediga plats (resolveSlots).
 *
 * Lärarens förhandsvisning och elevskärmen kör exakt samma kod.
 */

import { chipWidgets, widgetType, resolveSlots, SLOTS } from "./registry.js";
import { readRuntime, writeRuntime, watchRuntime } from "./runtime.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** ctx som en typ får i render*: vy, klass, instans och körtillståndet bundet till instansen. */
function widgetCtx(base, item, form) {
  const classId = base.classId ?? null;
  return {
    view: base.view,
    classId,
    widgetId: item.id,
    form,
    size: item.size ?? null,
    runtime: {
      read: () => readRuntime(classId, item.id),
      write: (state) => writeRuntime(classId, item.id, state),
      watch: (cb) => watchRuntime(classId, item.id, cb),
    },
  };
}

/** Montera en instans i el. → destroy(). Okänd typ → ingenting. */
function mountOne(el, item, form, base) {
  const type = widgetType(item.type);
  if (!type) return () => {};
  const ctx = widgetCtx(base, item, form);
  try {
    if (form === "chip") type.renderChip(el, item.cfg, ctx);
    else type.renderLarge(el, item.cfg, ctx);
  } catch (err) {
    console.warn(`[widgets] ${item.type}:`, err);
  }
  return () => { try { type.destroy(el); } catch { /* ok */ } };
}

// ---------------------------------------------------------------------------
// Lektionen — brickor i rubrikraden
// ---------------------------------------------------------------------------

/**
 * Brickornas markup för rubrikraden (mellan ämnet och "Tid: …"), eller ""
 * utan widgets. Instansernas data bärs som JSON i data-widget, så värden
 * och markup alltid hör ihop även när tavlan ritas om.
 */
export function chipsHTML(list) {
  const chips = chipWidgets(list);
  if (!chips.length) return "";
  return `<div class="lb-widgets">${chips.map((w) =>
    `<div class="lb-chip" data-widget-type="${esc(w.type)}" data-widget="${esc(JSON.stringify(w))}"></div>`).join("")}</div>`;
}

/**
 * Monterar brickorna efter att tavlan ritats. `mount(container)` städar de
 * förra (tavlan byggs om med innerHTML) och monterar de nya. `destroy()` i
 * lägets unmount.
 */
export function createChipHost(base) {
  let mounted = [];
  const clear = () => { for (const off of mounted) off(); mounted = []; };
  return {
    mount(container) {
      clear();
      for (const el of container.querySelectorAll(".lb-chip[data-widget]")) {
        let item;
        try { item = JSON.parse(el.dataset.widget); } catch { continue; }
        mounted.push(mountOne(el, item, "chip", base));
      }
    },
    destroy: clear,
  };
}

// ---------------------------------------------------------------------------
// Morgonskärmen — hörnplatser
// ---------------------------------------------------------------------------

/**
 * Lager med widgetarna i `.morgon`. `obstacles()` = elementen som aldrig får
 * skymmas (kortet, Bra jobbat-tavlan om den syns). `onPlaced(map)` får
 * Map(id → faktisk plats | null) efter varje layout (null = fick inte plats).
 *
 *   const layer = createCornerLayer(stage, { view, classId, obstacles });
 *   layer.set(settings.widgets);   // vid varje ändring (monterar bara om vid ny data)
 *   layer.layout();                // efter storleksändring / när kortet ändrats
 *   layer.destroy();
 */
export function createCornerLayer(stage, { view, classId, obstacles = () => [], onPlaced = () => {} } = {}) {
  const layer = document.createElement("div");
  layer.className = "morgon__widgets";
  stage.append(layer);

  const base = { view, classId };
  let items = [];
  let key = "";
  const boxes = new Map(); // id → { el, destroy }

  function set(list) {
    const known = (list ?? []).filter((w) => widgetType(w.type) && SLOTS.includes(w.slot));
    const next = JSON.stringify(known);
    if (next === key) { layout(); return; }
    key = next;
    items = known;
    for (const b of boxes.values()) { b.destroy(); b.el.remove(); }
    boxes.clear();
    for (const item of items) {
      const el = document.createElement("div");
      el.className = `mw mw--${item.size}`;
      el.dataset.widgetType = item.type;
      el.dataset.slot = item.slot;
      layer.append(el);
      boxes.set(item.id, { el, destroy: mountOne(el, item, "large", base) });
    }
    layout();
  }

  /** Placera: först på lärarens plats, krockar flyttas (resolveSlots). */
  function layout() {
    if (!layer.isConnected || !items.length) { onPlaced(new Map()); return; }
    const L = layer.getBoundingClientRect();
    if (!L.width || !L.height) return;
    const obs = obstacles()
      .filter((el) => el && !el.hidden && el.isConnected && el.getClientRects().length)
      .map((el) => el.getBoundingClientRect());
    // Hörnets avstånd till kanten mäts i tl-läge (CSS styr det — --mw-inset).
    const geo = new Map();
    for (const item of items) {
      const { el } = boxes.get(item.id);
      el.dataset.slot = "tl";
      el.hidden = false;
      const r = el.getBoundingClientRect();
      geo.set(item.id, { w: r.width, h: r.height, dx: r.left - L.left, dy: r.top - L.top });
    }
    const rectFor = (item, slot) => {
      const g = geo.get(item.id);
      const left = slot[1] === "l" ? L.left + g.dx : L.right - g.dx - g.w;
      const top = slot[0] === "t" ? L.top + g.dy : L.bottom - g.dy - g.h;
      return { left, top, right: left + g.w, bottom: top + g.h };
    };
    const placed = resolveSlots(items, { rectFor, obstacles: obs, width: L.width, height: L.height, gap: 8 });
    for (const item of items) {
      const { el } = boxes.get(item.id);
      const slot = placed.get(item.id);
      el.hidden = !slot;
      el.dataset.slot = slot ?? item.slot;
      el.classList.toggle("mw--moved", !!slot && slot !== item.slot);
    }
    onPlaced(placed);
  }

  return {
    el: layer,
    set,
    layout,
    destroy() {
      for (const b of boxes.values()) b.destroy();
      boxes.clear();
      layer.remove();
    },
  };
}
