/**
 * ELEVSKÄRM-DOCKAN VIKER UNDAN (issue #120).
 *
 * Elevskärmspanelen (js/ui/student-panel.js) ligger fast nere till höger i
 * lärarvyn — ovanpå allt. Element som inte får skymmas (Morgonskärmens
 * hörnwidgets) märks med `data-dock-avoid="<id>"`; skymmer dockan något av
 * dem viker den undan — åt vänster bredvid widgeten eller upp ovanför den,
 * det som skymmer minst av det som märkts `data-dock-soft` (kortet, Bra
 * jobbat-tavlan). Den går aldrig in över `data-dock-wall` (lärarpanelen) och
 * aldrig upp i verktygsraden. Ingenting annat flyttas, så lärarens
 * förhandsvisning och elevskärmen ritar fortfarande exakt samma sak.
 *
 * Ryms dockan ingenstans (liten skärm, widgets även bredvid och ovanför)
 * står den kvar, och de skymda id:na publiceras så att panelen kan säga det
 * (DOCK_COVERED_TEXT).
 *
 *   el.setAttribute(DOCK_AVOID_ATTR, widgetId);  // märk: får inte skymmas
 *   el.setAttribute(DOCK_SOFT_ATTR, "");          // märk: skyms helst inte
 *   el.setAttribute(DOCK_WALL_ATTR, "");          // märk: dockan går aldrig in över (vänster gräns)
 *   requestDockLayout();                          // efter varje flytt/ändring
 *   const off = watchDockCovered((ids) => …);     // skymda just nu
 *
 * `dockPlace` är ren (ingen DOM) och testas i Node (docs/test-widgets.mjs).
 */

export const DOCK_AVOID_ATTR = "data-dock-avoid";
export const DOCK_SOFT_ATTR = "data-dock-soft";
export const DOCK_WALL_ATTR = "data-dock-wall";
export const DOCK_COVERED_TEXT = "Delvis dold av Elevskärm-panelen här — syns fullt på elevskärmen.";

const LAYOUT_EVENT = "classroom:dock-layout";

/** Be dockan räkna om sin plats (märkta element har flyttats/kommit/försvunnit). */
export function requestDockLayout() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LAYOUT_EVENT));
}

/** Dockans sida: cb() vid varje requestDockLayout. → off */
export function onDockLayoutRequest(cb) {
  window.addEventListener(LAYOUT_EVENT, cb);
  return () => window.removeEventListener(LAYOUT_EVENT, cb);
}

let covered = [];
const watchers = new Set();

/** Dockans sida: id:n (DOCK_AVOID_ATTR) som dockan skymmer just nu. */
export function publishDockCovered(ids) {
  const next = [...new Set(ids)].sort();
  if (next.join("\n") === covered.join("\n")) return;
  covered = next;
  for (const cb of watchers) cb(covered);
}

/** cb(ids) nu och vid varje ändring. → off */
export function watchDockCovered(cb) {
  watchers.add(cb);
  cb(covered);
  return () => watchers.delete(cb);
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const area = (a, b) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * Var dockan ska stå för att inte skymma något i `avoid`.
 *
 *   dock   = dockans rektangel på sin vanliga plats (nere till höger)
 *   avoid  = rektanglar som INTE får skymmas (widgets)
 *   soft   = rektanglar som helst inte skyms (kortet, Bra jobbat)
 *   minTop / minLeft = gränser dockan inte går förbi (verktygsraden, lärarpanelen)
 *   gap    = luft mellan dockan och det den viker undan för
 *
 * → { dx, dy, covered }: förskjutning i px (0, 0 = vanlig plats; dx ≤ 0 =
 *   vänster, dy ≤ 0 = upp); covered = index i `avoid` som dockan skymmer där
 *   den hamnar (tom när den kunde vika undan).
 *
 * Skymmer dockan inget står den kvar — då ändras ingenting. Annars prövas två
 * platser: rakt UPP ovanför widgetarna och åt VÄNSTER bredvid dem (stegvis
 * förbi varje widget den skulle krocka med). Den som skymmer minst av `soft`
 * vinner; lika → vänster, så dockan står kvar längs nederkanten. Ryms ingen
 * står den kvar och de skymda rapporteras.
 */
export function dockPlace(dock, { avoid = [], soft = [], minTop = 0, minLeft = 0, gap = 8 } = {}) {
  const hard = avoid.filter(Boolean);
  const pref = soft.filter(Boolean);
  const hits = (r) => hard.map((a, i) => (overlaps(r, a) ? i : -1)).filter((i) => i >= 0);
  const at = (dx, dy) => ({ left: dock.left + dx, right: dock.right + dx, top: dock.top + dy, bottom: dock.bottom + dy });

  const first = hits(dock);
  if (!first.length) return { dx: 0, dy: 0, covered: [] };

  // Flytta längs en axel tills inget krockar (eller gränsen nås). → px eller null
  function slide(axis) {
    let d = 0;
    for (let step = 0; step <= hard.length; step++) {
      const r = axis === "x" ? at(d, 0) : at(0, d);
      if (r.top < minTop || r.left < minLeft) return null;
      const h = hits(r);
      if (!h.length) return d;
      d = axis === "x"
        ? Math.min(...h.map((i) => hard[i].left)) - gap - dock.right
        : Math.min(...h.map((i) => hard[i].top)) - gap - dock.bottom;
    }
    return null;
  }

  const options = [];
  const dx = slide("x");
  if (dx != null) options.push({ dx, dy: 0 });
  const dy = slide("y");
  if (dy != null) options.push({ dx: 0, dy });
  if (!options.length) return { dx: 0, dy: 0, covered: first };

  const cost = ({ dx, dy }) => pref.reduce((sum, s) => sum + area(at(dx, dy), s), 0);
  const best = options.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  return { ...best, covered: [] };
}
