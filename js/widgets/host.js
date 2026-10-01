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
 *    S/M/L). En widget som skulle skymma kortet eller Bra jobbat-tavlan
 *    krymps i sitt hörn, och flyttas till närmaste lediga plats först när
 *    inte ens S ryms (resolveSlots, #119).
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
    lesson: base.lesson ?? null,
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
export function chipsHTML(list, lesson = null) {
  const chips = chipWidgets(list);
  if (!chips.length) return "";
  // Planeringens dag och tid ({ date, start, end }) → ctx.lesson i brickorna
  // ("Kvar av lektionen", issue #117).
  const when = lesson ? ` data-lesson="${esc(JSON.stringify({ date: lesson.date ?? "", start: lesson.start ?? "", end: lesson.end ?? "" }))}"` : "";
  return `<div class="lb-widgets"${when}>${chips.map((w) =>
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
      let lesson = null;
      try { lesson = JSON.parse(container.querySelector(".lb-widgets")?.dataset.lesson ?? "null"); } catch { /* ingen tid */ }
      const at = { ...base, lesson };
      for (const el of container.querySelectorAll(".lb-chip[data-widget]")) {
        let item;
        try { item = JSON.parse(el.dataset.widget); } catch { continue; }
        mounted.push(mountOne(el, item, "chip", at));
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
 * skymmas (kortet, Bra jobbat-tavlan om den syns), `obstacleNames()` deras
 * namn i samma ordning ("kortet") för panelens förklaring. `onPlaced(map)`
 * får Map(id → { slot, scale, blockedBy }) efter varje layout (resolveSlots;
 * slot null = fick inte plats, scale < 1 = krympt i sitt hörn).
 *
 *   const layer = createCornerLayer(stage, { view, classId, obstacles });
 *   layer.set(settings.widgets);   // vid varje ändring (monterar bara om vid ny data)
 *   layer.layout();                // efter storleksändring / när kortet ändrats
 *   layer.destroy();
 */
export function createCornerLayer(stage, { view, classId, obstacles = () => [], obstacleNames = () => [], onPlaced = () => {} } = {}) {
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

  /**
   * Placera: först på lärarens plats och storlek; krockar krymps i sitt hörn
   * och flyttas först när inte ens storlek S ryms (resolveSlots, #119).
   */
  function layout() {
    if (!layer.isConnected || !items.length) { onPlaced(new Map()); return; }
    const L = layer.getBoundingClientRect();
    if (!L.width || !L.height) return;
    const names = obstacleNames();
    const obs = obstacles()
      .map((el, i) => ({ el, name: names[i] }))
      .filter(({ el }) => el && !el.hidden && el.isConnected && el.getClientRects().length)
      .map(({ el, name }) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, name };
      });
    // Mått i tl-läge i full storlek och i S (minsta krympningen). Hörnets
    // avstånd till kanten styrs av CSS (--mw-inset) och krymper inte.
    const geo = new Map();
    for (const item of items) {
      const { el } = boxes.get(item.id);
      el.dataset.slot = "tl";
      el.hidden = false;
      el.style.removeProperty("--mw-k");
      const r = el.getBoundingClientRect();
      let min = 1;
      if (item.size !== "s") {
        el.classList.replace(`mw--${item.size}`, "mw--s");
        min = Math.min(1, el.getBoundingClientRect().width / r.width || 1);
        el.classList.replace("mw--s", `mw--${item.size}`);
      }
      const round = widgetType(item.type)?.shape === "round";
      geo.set(item.id, { w: r.width, h: r.height, dx: r.left - L.left, dy: r.top - L.top, min, round });
    }
    const rectFor = (item, slot, scale = 1) => {
      const g = geo.get(item.id);
      const w = g.w * scale, h = g.h * scale;
      const left = slot[1] === "l" ? L.left + g.dx : L.right - g.dx - w;
      const top = slot[0] === "t" ? L.top + g.dy : L.bottom - g.dy - h;
      return { left, top, right: left + w, bottom: top + h, round: g.round };
    };
    const placed = resolveSlots(items, {
      rectFor, minScale: (item) => geo.get(item.id).min,
      // 4 px luft mot kortet/tavlan — glaset syns ändå åtskilt, och en större
      // marginal krympte en M-klocka bara för marginalens skull (#119).
      obstacles: obs, width: L.width, height: L.height, gap: 4,
    });
    for (const item of items) {
      const { el } = boxes.get(item.id);
      const at = placed.get(item.id);
      el.hidden = !at?.slot;
      el.dataset.slot = at?.slot ?? item.slot;
      if (at?.slot && at.scale < 1) el.style.setProperty("--mw-k", String(at.scale));
      else el.style.removeProperty("--mw-k");
      el.classList.toggle("mw--moved", !!at?.slot && at.slot !== item.slot);
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

// ---------------------------------------------------------------------------
// Elevskärmens faktiska platser → lärarens panel (issue #119)
// ---------------------------------------------------------------------------
// Elevskärmen (projektorn) har en annan yta än lärarens fönster — ingen
// verktygsrad, ingen panel, större namn på Bra jobbat — så en widget kan
// krympas eller flyttas där men inte hos läraren. Elevfönstret delar därför
// sitt resultat LOKALT (körtillståndets nyckel, samma webbläsare, aldrig
// molnet) och panelen visar det medan elevskärmen är öppen.

const PLACEMENT_ID = "_placement";
const placementJSON = (placed) => JSON.stringify(Object.fromEntries(placed ?? []));

/** Elevfönstret: dela var widgetarna hamnade (bara vid ändring). */
export function createPlacementSharer(classId) {
  let last = null;
  return (placed) => {
    const json = placementJSON(placed);
    if (json === last) return;
    last = json;
    writeRuntime(classId, PLACEMENT_ID, { placed: JSON.parse(json) });
  };
}

/** Lärarfönstret: cb(Map(id → { slot, scale, blockedBy }) | null) nu och vid varje ändring. → off */
export function watchStudentPlacement(classId, cb) {
  const toMap = (v) => (v?.placed && typeof v.placed === "object" ? new Map(Object.entries(v.placed)) : null);
  cb(toMap(readRuntime(classId, PLACEMENT_ID)));
  return watchRuntime(classId, PLACEMENT_ID, (v) => cb(toMap(v)));
}
