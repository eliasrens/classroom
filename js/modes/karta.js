/**
 * TANKEKARTA (issue #53) — ett moln i mitten med en rubrik, bubblor runt
 * om. Läraren skriver, eleverna ser kartan växa live på elevskärmen.
 *
 * Tom yta: inga förifyllda kartor, rubriker, bubblor eller förslag. En ny
 * karta har tom rubrik (grå platshållare som aldrig sparas) och heter
 * "Ny karta" i listan tills läraren ger den ett eget namn.
 *
 * Scenen (molnet, kurvorna, bubblorna, rörelsen) ritas av
 * js/modes/karta/scene.js och layouten räknas i js/lib/karta-layout.js —
 * samma bild i lärarens förhandsvisning, på projektorn och på papperet.
 *
 * Grenar (issue #59): ett klick på en bubbla MARKERAR den (ring + ×).
 * Skrivraden säger då "Lägg till under ”…”" och det du skriver hamnar som
 * grenar under den, en i taget med Enter. Klick på molnet, på tom yta
 * eller Esc går tillbaka till huvudnivån. Tre nivåer (tree.js MAX_DEPTH):
 * markerar du en under-gren hamnar nya bubblor bredvid den.
 *
 * Säker borttagning: ett klick tar aldrig bort något. Den markerade
 * bubblan tas bort med sitt lilla ×, eller med Delete/Backspace när
 * skrivraden är tom — med alla sina grenar, och Ångra tar tillbaka allt.
 * Ångra ångrar det senaste: tillagd, borttagen, flyttad, ändrad bubbla,
 * färg, Töm tavlan och Ordna automatiskt. Dubbelklick eller F2 ändrar
 * texten. En bubbla kan dras till en egen plats (dess grenar följer med);
 * "Ordna automatiskt" släpper alla sådana.
 *
 * Färger (issue #59): färgraden under kartan byter molnets färg — eller,
 * när en bubbla är markerad, bubblans. Grenar ärver förälderns färg i en
 * ljusare nyans ("Som föräldern"). "Färglägg automatiskt" (standard) ger
 * huvudbubblorna var sin färg; av → alla neutrala.
 *
 * Data (DATAMODELL.md): ENDAST LOKALT i classes/{cid}/karta (bubblorna kan
 * innehålla elevnamn — js/data/local-only.js, aldrig Firestore):
 *   state      { cur, paper, rev }        — kartan som visas, valt papper
 *   map-<id>   { name, title, cloud, autoColor,
 *                bubbles: [{ id, text, color, parentId, pin? }], nextColor, rev }
 *     color: index i palette.js, eller null för en gren = ärv förälderns
 *     parentId: null = huvudnivå. Kartor från #53 saknar parentId → huvudnivå.
 * Varje ändring går direkt ut på sync-bussen (`karta:state`
 * { cid, cur, map, rev }) och sparas (rubriken med debounce), så att en
 * omladdad elevskärm visar samma karta. `rev` ordnar bussen mot
 * storage-eventet som hos Skrivtavlan.
 *
 * Skriv ut: A3/A4, liggande/stående — js/modes/karta/print.js.
 */

import { icon } from "../lib/icons.js";
import { createScene } from "./karta/scene.js";
import { PALETTE, AUTO_COLORS, NEUTRAL, CLOUD_COLORS, cloudColor, resolveColors } from "./karta/palette.js";
import { MAX_DEPTH, depths, treeOrder, subtreeIds, repairParents } from "./karta/tree.js";
import { PAPERS, DEFAULT_PAPER, isPaper, printKarta, buildKartaPrint, closeKartaPrint, hasKartaPrint } from "./karta/print.js";

const EVENT = "karta:state";
const STATE_ID = "state";
const TITLE_SAVE_MS = 400;
const MAX_TEXT = 60;
const MAX_TITLE = 80;
const MAX_BUBBLES = 60;
const UNDO_MAX = 50;
const NEW_NAME = "Ny karta"; // bara visning i listan — sparas aldrig som innehåll

const kartaPath = (cid) => `classes/${cid}/karta`;
const isMapId = (id) => typeof id === "string" && id.startsWith("map-");

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const randomHex = (bytes) => {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};
const newMapId = () => `map-${randomHex(6)}`;
const newBubbleId = () => `b${randomHex(5)}`;

const cleanText = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function normalizePin(p) {
  const x = Number(p?.x);
  const y = Number(p?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } : null;
}

/**
 * Normalisera ett sparat kartdokument. Migrerar kartor från #53: utan
 * parentId blir alla bubblor huvudnivå, utan cloud får molnet sin gamla
 * färg (index 0) och färgläggningen är automatisk.
 */
export function normalizeMap(raw) {
  if (!raw || !isMapId(raw.id)) return null;
  const seen = new Set();
  const list = (Array.isArray(raw.bubbles) ? raw.bubbles : [])
    .filter((b) => typeof b?.id === "string" && typeof b.text === "string" && b.text.trim() && !seen.has(b.id) && seen.add(b.id))
    .slice(0, MAX_BUBBLES);
  const bubbles = repairParents(list.map((b) => ({ id: b.id, parentId: b.parentId ?? null, src: b })))
    .map(({ id, parentId, src: b }) => {
      const pin = normalizePin(b.pin);
      const color = Number.isInteger(b.color) ? b.color : (parentId ? null : 0);
      return { id, text: cleanText(b.text, MAX_TEXT), color, parentId, ...(pin ? { pin } : {}) };
    });
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name.slice(0, MAX_TITLE) : "",
    title: typeof raw.title === "string" ? raw.title.slice(0, MAX_TITLE) : "",
    cloud: Number.isInteger(raw.cloud) && raw.cloud >= 0 && raw.cloud < CLOUD_COLORS.length ? raw.cloud : 0,
    autoColor: raw.autoColor !== false,
    bubbles,
    nextColor: Number.isInteger(raw.nextColor) ? raw.nextColor : bubbles.length,
    createdAt: Number(raw.createdAt) || 0,
    rev: Number(raw.rev) || 0,
  };
}

/** Namnet i listan: eget namn, annars rubriken, annars "Ny karta". */
export const mapLabel = (m) => (m?.name?.trim() || m?.title?.trim() || NEW_NAME);

/** Det som eleverna ser (och bussen bär): rubrik, molnets färg och bubblor. */
const publicMap = (m) => (m ? { id: m.id, title: m.title, cloud: m.cloud, bubbles: m.bubbles.map((b) => ({ ...b })) } : null);

export default {
  id: "karta",
  title: "Tankekarta",
  icon: "cloud",

  async mount(el, ctx) {
    const offs = [];
    this._offs = offs; // städning registreras innan något startas

    const { view, activeClass, data, sync } = ctx;
    const isStudent = view === "student";

    if (!activeClass) {
      el.innerHTML = `
        <div class="mode-placeholder">
          <div class="mode-placeholder__icon">${icon("cloud", { size: 44, strokeWidth: 1.4 })}</div>
          <h1>Tankekarta</h1>
          <p>${isStudent ? "Ingen klass vald." : "Välj en klass i topbaren för att göra en tankekarta."}</p>
        </div>`;
      return;
    }

    const cid = activeClass.id;
    el.innerHTML = isStudent ? studentMarkup() : teacherMarkup();
    const stage = el.querySelector(".kt-stage");

    const onResize = (fn) => {
      if (typeof ResizeObserver !== "function") return;
      let frame = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(fn);
      });
      ro.observe(stage);
      offs.push(() => { cancelAnimationFrame(frame); ro.disconnect(); });
    };

    if (isStudent) mountStudent();
    else mountTeacher();

    // ---- Elevskärmen: bara kartan, följer läraren ----

    function mountStudent() {
      const scene = createScene(stage);
      offs.push(() => scene.destroy());
      const emptyEl = el.querySelector(".kt-empty");
      let lastRev = -1;
      let shown = undefined;

      function apply(payload, { animate = true } = {}) {
        if (!payload || payload.cid !== cid) return;
        if (payload.rev < lastRev) return; // en sen sparning — bussen har redan nyare
        lastRev = payload.rev;
        const map = payload.map ?? null;
        // Ny karta → ingen glidning från den förra.
        const same = shown !== undefined && shown?.id === map?.id;
        shown = map;
        emptyEl.hidden = !!map;
        scene.render(map, { animate: animate && same });
      }

      offs.push(data.watch(kartaPath(cid), (docs) => {
        const byId = new Map(docs.map((d) => [d.id, d]));
        const state = byId.get(STATE_ID);
        const map = normalizeMap(byId.get(state?.cur));
        const rev = Math.max(Number(state?.rev) || 0, map?.rev ?? 0);
        apply({ cid, cur: map?.id ?? null, map: publicMap(map), rev }, { animate: shown !== undefined });
      }));
      offs.push(sync.on(EVENT, ({ payload }) => apply(payload)));
      onResize(() => scene.refit());
    }

    // ---- Lärarvyn ----

    function mountTeacher() {
      const $ = (s) => el.querySelector(s);
      const listEl = $(".kt-maps");
      const mapBox = $(".kt-mapbox");
      const nameInput = $('input[name="kt-name"]');
      const deleteConfirm = $(".kt-delete-confirm");
      const emptyEl = $(".kt-empty");
      const form = $(".kt-add");
      const input = $(".kt-input");
      const addBtn = $('[data-act="add"]');
      const undoBtn = $('[data-act="undo"]');
      const arrangeBtn = $('[data-act="arrange"]');
      const clearBtn = $('[data-act="clear"]');
      const clearConfirm = $(".kt-clear-confirm");
      const printBtn = $('[data-act="print"]');
      const printPanel = $(".kt-printpanel");
      const statusEl = $(".kt-status");
      const countEl = $(".kt-count");
      const targetEl = $(".kt-target");
      const colorsEl = $(".kt-colors");
      const colorsLabel = $(".kt-colors__label");
      const swatchesEl = $(".kt-swatches");
      const autoBox = $('input[name="kt-auto"]');

      /** @type {Array<ReturnType<typeof normalizeMap>>} */
      let maps = [];
      let cur = null;
      let paper = DEFAULT_PAPER;
      let rev = 0;
      let loaded = false;
      let titleTimer = 0;
      let selected = null; // markerad bubbla: nya bubblor hamnar som grenar under den
      const undoStacks = new Map(); // kart-id → [op] (bara i minnet)

      const scene = createScene(stage, {
        editable: true,
        titlePlaceholder: "Skriv en rubrik…",
        onTitleInput: (t) => {
          const m = curMap();
          if (!m) return;
          m.title = t.slice(0, MAX_TITLE);
          renderList();
          publish();
          clearTimeout(titleTimer);
          titleTimer = setTimeout(() => saveMap(m), TITLE_SAVE_MS);
          scheduleRelayout();
        },
        onTitleCommit: (t) => {
          const m = curMap();
          if (!m) return;
          const clean = cleanText(t, MAX_TITLE);
          if (clean === m.title && !titleTimer) return;
          m.title = clean;
          clearTimeout(titleTimer);
          titleTimer = 0;
          renderList();
          commit(m);
        },
        onRemove: (id) => removeBubble(id),
        onSelect: (id, how = {}) => {
          select(id);
          if (how.focusInput && !input.disabled) input.focus({ preventScroll: true });
        },
        onMove: (id, pin) => {
          const m = curMap();
          const b = m?.bubbles.find((x) => x.id === id);
          if (!b) return;
          pushUndo(m, { t: "move", id, prev: b.pin ?? null });
          b.pin = normalizePin(pin);
          commit(m);
        },
        onEdit: (id, text) => {
          const m = curMap();
          const b = m?.bubbles.find((x) => x.id === id);
          const clean = cleanText(text, MAX_TEXT);
          if (!b || !clean || clean === b.text) return;
          pushUndo(m, { t: "edit", id, prev: b.text });
          b.text = clean;
          commit(m);
          say(`Bubblan ändrad. Ångra tar tillbaka den gamla texten.`);
        },
      });
      offs.push(() => scene.destroy());

      const curMap = () => maps.find((m) => m.id === cur) ?? null;
      const nextRev = () => (rev = Math.max(Date.now(), rev + 1));

      // ---- Tillstånd ut: bussen direkt, lagringen ----

      function publish() {
        if (!loaded) return;
        const m = curMap();
        const r = nextRev();
        if (m) m.rev = r;
        sync.publish(EVENT, { cid, cur, map: publicMap(m), rev: r });
        return r;
      }

      function saveMap(m) {
        clearTimeout(titleTimer);
        titleTimer = 0;
        const { createdAt: _c, ...doc } = m;
        void data.put(kartaPath(cid), doc);
      }

      function saveState() {
        void data.put(kartaPath(cid), { id: STATE_ID, cur, paper, rev });
      }

      /** En ändring i kartan: rita, skicka ut, spara. */
      function commit(m, { animate = true } = {}) {
        publish();
        saveMap(m);
        drawScene({ animate });
        drawControls();
        const n = listEl.querySelector(`[data-map="${CSS.escape(m.id)}"] .kt-mapbtn__n`);
        if (n) n.textContent = String(m.bubbles.length);
      }

      let relayoutFrame = 0;
      function scheduleRelayout() {
        cancelAnimationFrame(relayoutFrame);
        relayoutFrame = requestAnimationFrame(() => drawScene());
      }
      offs.push(() => cancelAnimationFrame(relayoutFrame));

      const flush = () => { const m = curMap(); if (titleTimer && m) saveMap(m); };
      window.addEventListener("pagehide", flush);
      offs.push(() => { window.removeEventListener("pagehide", flush); flush(); });

      // ---- Ångra ----

      const stackOf = (m) => {
        if (!undoStacks.has(m.id)) undoStacks.set(m.id, []);
        return undoStacks.get(m.id);
      };
      function pushUndo(m, op) {
        const s = stackOf(m);
        s.push(op);
        if (s.length > UNDO_MAX) s.shift();
      }
      const quote = (t) => `”${t.length > 28 ? `${t.slice(0, 27)}…` : t}”`;

      function undoLabel(op, m) {
        if (!op) return "Inget att ångra";
        const text = (id) => m.bubbles.find((b) => b.id === id)?.text ?? "";
        switch (op.t) {
          case "add": return `Ångra: ta bort ${quote(text(op.id))}`;
          case "remove": return `Ångra: ta tillbaka ${quote(op.items[0].bubble.text)}${branchesText(op.items.length - 1, " med ")}`;
          case "cloud": return "Ångra: molnets förra färg";
          case "color": return `Ångra: förra färgen på ${quote(text(op.id))}`;
          case "auto": return op.prevAuto ? "Ångra: färgerna tillbaka" : "Ångra: neutrala bubblor igen";
          case "clear": return `Ångra: ta tillbaka alla ${op.bubbles.length} bubblor`;
          case "move": return `Ångra: flytta tillbaka ${quote(text(op.id))}`;
          case "edit": return `Ångra: tillbaka till ${quote(op.prev)}`;
          case "arrange": return "Ångra: ställ tillbaka de dragna bubblorna";
          default: return "Ångra";
        }
      }

      function undo() {
        const m = curMap();
        const op = m && stackOf(m).pop();
        if (!op) return;
        const find = (id) => m.bubbles.find((b) => b.id === id);
        switch (op.t) {
          case "add": m.bubbles = m.bubbles.filter((b) => b.id !== op.id); say("Den senaste bubblan togs bort."); break;
          case "remove":
            for (const { bubble, index } of [...op.items].sort((a, b) => a.index - b.index)) m.bubbles.splice(Math.min(index, m.bubbles.length), 0, bubble);
            say(`${quote(op.items[0].bubble.text)}${branchesText(op.items.length - 1, " med ")} är tillbaka.`);
            break;
          case "cloud": m.cloud = op.prev; say(""); break;
          case "color": { const b = find(op.id); if (b) b.color = op.prev; say(""); break; }
          case "auto":
            m.autoColor = op.prevAuto;
            m.nextColor = op.prevNext;
            for (const b of m.bubbles) if (op.prev[b.id] !== undefined) b.color = op.prev[b.id];
            say("");
            break;
          case "clear": m.bubbles = op.bubbles.map((b) => ({ ...b })); say("Alla bubblor är tillbaka."); break;
          case "move": { const b = find(op.id); if (b) { if (op.prev) b.pin = op.prev; else delete b.pin; } say(""); break; }
          case "edit": { const b = find(op.id); if (b) b.text = op.prev; say(""); break; }
          case "arrange":
            for (const b of m.bubbles) if (op.pins[b.id]) b.pin = op.pins[b.id];
            say("");
            break;
          default: break;
        }
        commit(m);
      }

      // ---- Bubblor ----

      const branchesText = (n, lead) => (n > 0 ? `${lead}${n === 1 ? "1 gren" : `${n} grenar`}` : "");
      const byId = (m, id) => m?.bubbles.find((b) => b.id === id) ?? null;

      /** Var en ny bubbla hamnar: under den markerade (eller bredvid en under-gren). */
      function targetParent(m) {
        const s = byId(m, selected);
        if (!s) return null;
        return (depths(m.bubbles).get(s.id) ?? 1) < MAX_DEPTH ? s.id : s.parentId;
      }

      function addBubble() {
        const m = curMap();
        const text = cleanText(input.value, MAX_TEXT);
        if (!m || !text) { input.focus(); return; }
        if (m.bubbles.length >= MAX_BUBBLES) { say(`Kartan rymmer högst ${MAX_BUBBLES} bubblor.`); return; }
        const parentId = targetParent(m);
        let color = null; // en gren ärver förälderns färg
        if (!parentId) {
          color = m.autoColor ? m.nextColor % AUTO_COLORS : NEUTRAL;
          if (m.autoColor) m.nextColor = (m.nextColor + 1) % AUTO_COLORS;
        }
        const b = { id: newBubbleId(), text, color, parentId };
        m.bubbles.push(b);
        pushUndo(m, { t: "add", id: b.id });
        input.value = "";
        closeConfirms();
        say("");
        commit(m);
        input.focus();
      }

      /** Ta bort en bubbla med alla dess grenar (Ångra tar tillbaka allt). */
      function removeBubble(id) {
        const m = curMap();
        const bubble = byId(m, id);
        if (!bubble) return;
        const gone = subtreeIds(m.bubbles, id);
        // Index i den ursprungliga listan, stigande — så sätts de tillbaka i
        // samma ordning. En gren skapas alltid efter sin förälder, så den
        // borttagna bubblan står först.
        const items = [];
        m.bubbles.forEach((b, index) => { if (gone.has(b.id)) items.push({ bubble: b, index }); });
        if (items[0].bubble.id !== id) items.unshift(...items.splice(items.findIndex((x) => x.bubble.id === id), 1));
        m.bubbles = m.bubbles.filter((b) => !gone.has(b.id));
        pushUndo(m, { t: "remove", items });
        // Markeringen går till föräldern (fortsätt på samma gren) eller huvudnivån.
        selected = bubble.parentId && byId(m, bubble.parentId) ? bubble.parentId : null;
        closeConfirms();
        commit(m);
        say(`${quote(bubble.text)}${branchesText(items.length - 1, " och ")} togs bort — Ångra tar tillbaka ${items.length > 1 ? "allt" : "den"}.`);
        input.focus({ preventScroll: true });
      }

      function clearAll() {
        const m = curMap();
        if (!m || m.bubbles.length === 0) return;
        pushUndo(m, { t: "clear", bubbles: m.bubbles.map((b) => ({ ...b })) });
        const n = m.bubbles.length;
        m.bubbles = [];
        selected = null;
        closeConfirms();
        commit(m);
        say(`${n} bubblor togs bort — Ångra tar tillbaka dem.`);
        input.focus();
      }

      function arrange() {
        const m = curMap();
        const pins = {};
        for (const b of m?.bubbles ?? []) if (b.pin) { pins[b.id] = b.pin; delete b.pin; }
        if (!Object.keys(pins).length) return;
        pushUndo(m, { t: "arrange", pins });
        commit(m);
      }

      // ---- Markering och färger ----

      /** Markera en bubbla (null = huvudnivån). Nya bubblor hamnar under den markerade. */
      function select(id) {
        const m = curMap();
        const next = id && byId(m, id) ? id : null;
        if (next === selected && scene.selected === next) return;
        selected = next;
        scene.setSelected(selected);
        drawTarget();
        drawColors();
      }

      function setCloudColor(i) {
        const m = curMap();
        if (!m || m.cloud === i) return;
        pushUndo(m, { t: "cloud", prev: m.cloud });
        m.cloud = i;
        commit(m);
      }

      function setBubbleColor(id, i) {
        const m = curMap();
        const b = byId(m, id);
        if (!b || b.color === i || (i === null && !b.parentId)) return;
        pushUndo(m, { t: "color", id, prev: b.color });
        b.color = i;
        commit(m);
      }

      /** Färglägg automatiskt: på → huvudbubblorna får var sin färg; av → alla neutrala. */
      function setAutoColor(on) {
        const m = curMap();
        if (!m || m.autoColor === on) return;
        const prev = {};
        const roots = m.bubbles.filter((b) => !b.parentId);
        for (const b of roots) prev[b.id] = b.color;
        pushUndo(m, { t: "auto", prevAuto: m.autoColor, prevNext: m.nextColor, prev });
        m.autoColor = on;
        roots.forEach((b, i) => { b.color = on ? i % AUTO_COLORS : NEUTRAL; });
        m.nextColor = on ? roots.length % AUTO_COLORS : m.nextColor;
        commit(m);
      }

      /** Skrivradens mål: runt molnet, eller under den markerade bubblan. */
      function drawTarget() {
        const m = curMap();
        const s = byId(m, selected);
        const parent = s ? byId(m, targetParent(m)) : null;
        let hint = "Skriv och tryck Enter";
        let label = "Runt molnet";
        if (s && parent) {
          label = `Under ${quote(parent.text)}`;
          hint = parent.id === s.id ? `Lägg till under ${quote(s.text)} — tryck Enter` : `Lägg till bredvid ${quote(s.text)} — tryck Enter`;
        } else if (s) {
          hint = `Lägg till bredvid ${quote(s.text)} — tryck Enter`;
        }
        input.placeholder = hint;
        input.setAttribute("aria-label", s ? `${hint}. Esc går tillbaka till huvudnivån.` : "Ny bubbla runt molnet");
        targetEl.textContent = label;
        targetEl.classList.toggle("is-branch", !!(s && parent));
        form.classList.toggle("is-branch", !!s);
      }

      /** Färgraden: molnets färger, eller den markerade bubblans. */
      function drawColors() {
        const m = curMap();
        colorsEl.hidden = !m;
        if (!m) return;
        const s = byId(m, selected);
        if (!s) {
          colorsLabel.textContent = "Molnets färg";
          swatchesEl.innerHTML = CLOUD_COLORS.map((c, i) => {
            const ink = cloudColor(i).ink;
            return `<button type="button" class="kt-swatch" data-cloud="${i}" style="--sw:${c.fill};--sw-edge:${c.edge};--sw-ink:${ink}"
              aria-pressed="${m.cloud === i}" title="${escapeHtml(c.label)}" aria-label="Molnet ${escapeHtml(c.label.toLowerCase())}"></button>`;
          }).join("");
          autoBox.closest("label").hidden = false;
          autoBox.checked = m.autoColor;
          return;
        }
        colorsLabel.textContent = `Färg på ${quote(s.text)}`;
        const inherit = s.parentId
          ? (() => {
            const pc = resolveColors(m.bubbles.map((b) => (b.id === s.id ? { ...b, color: null } : b))).get(s.id);
            return `<button type="button" class="kt-swatch kt-swatch--inherit" data-color="inherit" style="--sw:${pc.bg};--sw-edge:${pc.edge}"
              aria-pressed="${s.color === null}" title="Som föräldern (ljusare nyans)" aria-label="Som föräldern"></button>`;
          })()
          : "";
        swatchesEl.innerHTML = inherit + PALETTE.map((c, i) => `<button type="button" class="kt-swatch" data-color="${i}"
            style="--sw:${c.bg};--sw-edge:${c.edge}" aria-pressed="${s.color === i}" title="${escapeHtml(c.label)}"
            aria-label="${escapeHtml(c.label)}"></button>`).join("");
        autoBox.closest("label").hidden = true;
      }

      // ---- Kartor ----

      function selectMap(id, { focusTitle = false } = {}) {
        if (id === cur) return;
        flush();
        cur = maps.some((m) => m.id === id) ? id : null;
        selected = null;
        closeConfirms();
        closePrintPanel();
        say("");
        publish();
        saveState();
        renderAll({ animate: false });
        if (focusTitle) scene.focusTitle();
      }

      function newMap(from = null) {
        // En kopia får nya id:n — grenarna pekar om till sina kopierade föräldrar.
        const ids = new Map((from?.bubbles ?? []).map((b) => [b.id, newBubbleId()]));
        const m = {
          id: newMapId(),
          name: from ? `${mapLabel(from)} (kopia)`.slice(0, MAX_TITLE) : "",
          title: from?.title ?? "",
          cloud: from?.cloud ?? 0,
          autoColor: from?.autoColor ?? true,
          bubbles: from ? from.bubbles.map((b) => ({ ...b, id: ids.get(b.id), parentId: b.parentId ? ids.get(b.parentId) ?? null : null })) : [],
          nextColor: from?.nextColor ?? 0,
          createdAt: Date.now(),
          rev: 0,
        };
        maps.push(m);
        saveMap(m);
        selectMap(m.id, { focusTitle: !from });
        if (from) say("Kopian är vald. Byt namn i fältet till höger.");
      }

      function deleteMap() {
        const m = curMap();
        if (!m) return;
        const i = maps.indexOf(m);
        maps.splice(i, 1);
        undoStacks.delete(m.id);
        void data.remove(kartaPath(cid), m.id);
        const next = maps[Math.min(i, maps.length - 1)] ?? null;
        cur = null; // (selectMap byter bara om id skiljer sig)
        selectMap(next?.id ?? null);
        if (!next) { publish(); saveState(); renderAll(); }
      }

      // ---- Rendering ----

      function drawScene({ animate = true } = {}) {
        const m = curMap();
        emptyEl.hidden = !!m;
        scene.render(m ? publicMap(m) : null, { animate });
      }

      function renderList() {
        listEl.innerHTML = maps.map((m) => {
          const label = mapLabel(m);
          const n = m.bubbles.length;
          return `<button type="button" class="btn kt-mapbtn${label === NEW_NAME && !m.name && !m.title ? " is-unnamed" : ""}"
            data-map="${escapeHtml(m.id)}" aria-pressed="${m.id === cur}">
            <span class="kt-mapbtn__name">${escapeHtml(label)}</span><span class="kt-mapbtn__n">${n}</span></button>`;
        }).join("") || `<p class="kt-sub">Inga kartor ännu.</p>`;
      }

      function drawControls() {
        const m = curMap();
        const has = !!m;
        const n = m?.bubbles.length ?? 0;
        input.disabled = !has;
        addBtn.disabled = !has;
        form.classList.toggle("is-disabled", !has);
        const op = has ? stackOf(m).at(-1) : null;
        undoBtn.disabled = !op;
        undoBtn.title = has ? undoLabel(op, m) : "Inget att ångra";
        arrangeBtn.hidden = !m?.bubbles.some((b) => b.pin);
        clearBtn.disabled = n === 0;
        printBtn.disabled = !has || (n === 0 && !m.title.trim());
        printBtn.title = printBtn.disabled ? "Inget att skriva ut — kartan är tom" : "Skriv ut kartan på A3 eller A4 (eller spara som PDF)";
        countEl.textContent = has ? (n === 1 ? "1 bubbla" : `${n} bubblor`) : "";
        mapBox.hidden = !has;
        if (has && document.activeElement !== nameInput) nameInput.value = m.name;
        if (has) nameInput.placeholder = m.title.trim() || NEW_NAME;
        if (selected && !byId(m, selected)) selected = null;
        scene.setSelected(selected);
        drawTarget();
        drawColors();
        for (const r of printPanel.querySelectorAll('input[name="kt-paper"]')) r.checked = r.value === paper;
      }

      function renderAll({ animate = true } = {}) {
        renderList();
        drawControls();
        drawScene({ animate });
      }

      let sayTimer = 0;
      function say(text) {
        clearTimeout(sayTimer);
        statusEl.textContent = text;
        if (text) sayTimer = setTimeout(() => { statusEl.textContent = ""; }, 8000);
      }
      offs.push(() => clearTimeout(sayTimer));

      function closeConfirms() {
        clearConfirm.hidden = true;
        clearBtn.hidden = false;
        deleteConfirm.hidden = true;
        $('[data-act="delete-map"]').hidden = false;
      }

      // ---- Utskrift ----

      function closePrintPanel() {
        if (printPanel.hidden) return;
        printPanel.hidden = true;
        printBtn.setAttribute("aria-expanded", "false");
      }

      // ---- Händelser ----

      form.addEventListener("submit", (e) => { e.preventDefault(); addBubble(); });

      // Skrivraden: Esc = huvudnivån; tom rad + Delete/Backspace = ta bort
      // den markerade; F2 = ändra den; pil upp/ner (tom rad) = markera nästa.
      input.addEventListener("keydown", (e) => {
        const m = curMap();
        if (!m) return;
        if (e.key === "Escape" && selected) { e.preventDefault(); select(null); return; }
        if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; return; }
        if (input.value !== "") return;
        if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); removeBubble(selected); return; }
        if (e.key === "F2" && selected) { e.preventDefault(); scene.edit(selected); return; }
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && m.bubbles.length) {
          e.preventDefault();
          const order = treeOrder(m.bubbles).map((b) => b.id);
          const i = order.indexOf(selected);
          const dir = e.key === "ArrowDown" ? 1 : -1;
          select(i < 0 ? order[dir > 0 ? 0 : order.length - 1] : order[(i + dir + order.length) % order.length]);
        }
      });

      swatchesEl.addEventListener("click", (e) => {
        const b = e.target.closest(".kt-swatch");
        if (!b) return;
        if (b.dataset.cloud != null) setCloudColor(Number(b.dataset.cloud));
        else if (selected) setBubbleColor(selected, b.dataset.color === "inherit" ? null : Number(b.dataset.color));
      });
      autoBox.addEventListener("change", () => setAutoColor(autoBox.checked));

      const root = $(".kt");
      root.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || !root.contains(b) || b.closest(".kt-scene")) return;
        if (b.dataset.map) { selectMap(b.dataset.map); return; }
        switch (b.dataset.act) {
          case "undo": return undo();
          case "arrange": return arrange();
          case "clear":
            clearBtn.hidden = true;
            clearConfirm.hidden = false;
            clearConfirm.querySelector("span").textContent = `Ta bort alla ${curMap()?.bubbles.length ?? 0} bubblor?`;
            return clearConfirm.querySelector('[data-act="confirm-clear"]').focus();
          case "confirm-clear": return clearAll();
          case "cancel-clear": closeConfirms(); return input.focus();
          case "new-map": return newMap();
          case "copy-map": return curMap() && newMap(curMap());
          case "delete-map":
            b.hidden = true;
            deleteConfirm.hidden = false;
            deleteConfirm.querySelector("span").textContent = `Ta bort ${quote(mapLabel(curMap()))} och alla dess bubblor?`;
            return deleteConfirm.querySelector('[data-act="confirm-delete"]').focus();
          case "confirm-delete": return deleteMap();
          case "cancel-delete": return closeConfirms();
          case "print":
            if (!printPanel.hidden) return closePrintPanel();
            closeConfirms();
            printPanel.hidden = false;
            printBtn.setAttribute("aria-expanded", "true");
            return printPanel.querySelector(`input[value="${paper}"]`)?.focus();
          case "print-cancel": return closePrintPanel();
          case "print-go": {
            const m = curMap();
            if (!m) return undefined;
            closePrintPanel();
            return printKarta({ map: publicMap(m), className: activeClass.name ?? "", paper })
              .catch((err) => { console.warn("[karta] utskrift:", err); closeKartaPrint(); });
          }
          default: return undefined;
        }
      });

      printPanel.addEventListener("change", (e) => {
        if (e.target.name === "kt-paper" && isPaper(e.target.value)) {
          paper = e.target.value;
          saveState();
        }
      });
      printPanel.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); closePrintPanel(); printBtn.focus(); }
      });

      nameInput.addEventListener("input", () => {
        const m = curMap();
        if (!m) return;
        m.name = nameInput.value.slice(0, MAX_TITLE);
        const btn = listEl.querySelector(`[data-map="${CSS.escape(m.id)}"] .kt-mapbtn__name`);
        if (btn) btn.textContent = mapLabel(m);
        clearTimeout(titleTimer);
        titleTimer = setTimeout(() => saveMap(m), TITLE_SAVE_MS);
      });
      nameInput.addEventListener("change", () => {
        const m = curMap();
        if (!m) return;
        m.name = cleanText(nameInput.value, MAX_TITLE);
        nameInput.value = m.name;
        saveMap(m);
        renderList();
      });

      // Ctrl+Z utanför textfälten = Ångra (i textfälten gäller deras egen ångra).
      // Esc utanför textfälten = tillbaka till huvudnivån.
      const onKey = (e) => {
        if (e.key === "Escape" && selected && !e.defaultPrevented) {
          const t = e.target;
          if (!t?.closest?.("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only'], .kt-printpanel")
            && (el.contains(t) || t === document.body)) { e.preventDefault(); select(null); return; }
        }
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "z") return;
        const t = e.target;
        if (t?.closest?.("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']")) return;
        if (!el.contains(t) && t !== document.body) return;
        e.preventDefault();
        undo();
      };
      document.addEventListener("keydown", onKey);
      offs.push(() => document.removeEventListener("keydown", onKey));

      // Ctrl+P direkt i lärarvyn: skriv ut kartan (valt papper), inte appen.
      const onBeforePrint = () => {
        const m = curMap();
        if (hasKartaPrint() || !m) return;
        buildKartaPrint({ map: publicMap(m), className: activeClass.name ?? "", paper });
      };
      window.addEventListener("beforeprint", onBeforePrint);
      offs.push(() => { window.removeEventListener("beforeprint", onBeforePrint); closeKartaPrint(); });

      // ---- Start: läs det sparade (lokalt, synkront) ----

      offs.push(data.watch(kartaPath(cid), (docs) => {
        if (loaded) return; // lärarvyn är enda skribenten — bara första svaret
        loaded = true;
        maps = docs.map(normalizeMap).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
        const state = docs.find((d) => d.id === STATE_ID);
        rev = Math.max(Number(state?.rev) || 0, ...maps.map((m) => m.rev));
        cur = maps.some((m) => m.id === state?.cur) ? state.cur : (maps.at(-1)?.id ?? null);
        paper = isPaper(state?.paper) ? state.paper : DEFAULT_PAPER;
        renderAll({ animate: false });
        publish(); // en redan öppen elevskärm visar direkt samma sak
      }));

      onResize(() => scene.refit());
    }
  },

  async unmount() {
    for (const off of (this._offs ?? []).splice(0)) { try { off(); } catch { /* ok */ } }
  },
};

// ---- Markup-mallar --------------------------------------------------------

function studentMarkup() {
  return `
    <section class="kt kt--student">
      <div class="kt-stage theme-student" aria-live="off">
        <p class="kt-empty" hidden>Ingen tankekarta visas.</p>
      </div>
    </section>`;
}

function teacherMarkup() {
  return `
    <section class="kt kt--teacher">
      <div class="kt-main">
        <div class="kt-stage theme-student">
          <div class="kt-empty teacher-only" hidden>
            <p>Inga kartor ännu.</p>
            <button type="button" class="btn btn--primary" data-act="new-map">${icon("plus")}<span>Ny karta</span></button>
          </div>
        </div>

        <div class="kt-colors teacher-only" role="group" aria-label="Färg" hidden>
          <span class="kt-colors__label">Molnets färg</span>
          <span class="kt-swatches"></span>
          <label class="kt-auto"><input type="checkbox" name="kt-auto" checked><span>Färglägg bubblor automatiskt</span></label>
        </div>

        <form class="kt-add teacher-only" autocomplete="off">
          <span class="kt-target" aria-hidden="true">Runt molnet</span>
          <input class="kt-input" type="text" name="kt-text" maxlength="${MAX_TEXT}" autocomplete="off"
            spellcheck="false" placeholder="Skriv och tryck Enter" aria-label="Ny bubbla runt molnet">
          <button type="submit" class="btn btn--primary" data-act="add">${icon("plus")}<span>Lägg till</span></button>
        </form>

        <div class="kt-tools teacher-only">
          <button type="button" class="btn" data-act="undo" title="Inget att ångra" disabled>${icon("undo")}<span>Ångra</span></button>
          <button type="button" class="btn btn--ghost" data-act="arrange" title="Släpp de bubblor du dragit — ordna alla automatiskt" hidden>${icon("refresh")}<span>Ordna automatiskt</span></button>
          <button type="button" class="btn btn--ghost" data-act="clear" disabled>${icon("trash")}<span>Töm tavlan</span></button>
          <span class="kt-confirm kt-clear-confirm" role="group" aria-label="Bekräfta Töm tavlan" hidden>
            <span></span>
            <button type="button" class="btn kt-danger" data-act="confirm-clear">Töm</button>
            <button type="button" class="btn btn--ghost" data-act="cancel-clear">Avbryt</button>
          </span>
          <span class="kt-count" aria-live="polite"></span>
          <button type="button" class="btn kt-printbtn" data-act="print" aria-expanded="false" disabled>${icon("printer")}<span>Skriv ut</span></button>
        </div>
        <p class="kt-status teacher-only" role="status" aria-live="polite"></p>

        <div class="kt-printpanel teacher-only" role="group" aria-label="Skriv ut" hidden>
          <fieldset class="kt-papers">
            <legend>Papper</legend>
            ${PAPERS.map((p) => `<label class="kt-paper"><input type="radio" name="kt-paper" value="${p.id}">
              <span class="kt-paper__icon kt-paper__icon--${p.orientation}" aria-hidden="true"></span><span>${p.label}</span></label>`).join("")}
          </fieldset>
          <p class="kt-printpanel__note">Kartan räknas om så att allt ryms på papperet. Klass och datum står överst.
            Välj <strong>Spara som PDF</strong> i utskriftsrutan för en fil.</p>
          <div class="kt-printpanel__actions">
            <button type="button" class="btn btn--primary" data-act="print-go">${icon("printer")}<span>Skriv ut…</span></button>
            <button type="button" class="btn btn--ghost" data-act="print-cancel">Avbryt</button>
          </div>
        </div>

        <p class="kt-hint kt-hint--main teacher-only">Klicka på en bubbla för att lägga till grenar under den — <kbd>Esc</kbd> eller klick på molnet går tillbaka.</p>
        <p class="kt-hint teacher-only">Skicka ut med <strong>Visa på elevskärm</strong>. Den markerade bubblan tas bort med sitt <strong>×</strong>,
          dubbelklick ändrar texten och du kan dra den dit du vill. Kartorna sparas bara på den här datorn, aldrig i molnet.</p>
      </div>

      <aside class="kt-side teacher-only" aria-label="Tankekartor">
        <section class="kt-box">
          <h2 class="kt-h">Kartor</h2>
          <div class="kt-maps" role="group" aria-label="Välj karta"></div>
          <button type="button" class="btn btn--ghost kt-newmap" data-act="new-map">${icon("plus")}<span>Ny karta</span></button>
        </section>
        <section class="kt-box kt-mapbox" hidden>
          <label class="kt-field"><span>Namn i listan</span>
            <input type="text" name="kt-name" maxlength="${MAX_TITLE}" autocomplete="off" spellcheck="false"></label>
          <p class="kt-sub">Rubriken skriver du i molnet. Den syns för eleverna, namnet bara här.</p>
          <div class="kt-row">
            <button type="button" class="btn btn--ghost" data-act="copy-map">${icon("copy")}<span>Kopiera</span></button>
            <button type="button" class="btn btn--ghost" data-act="delete-map">${icon("trash")}<span>Ta bort</span></button>
          </div>
          <span class="kt-confirm kt-delete-confirm" role="group" aria-label="Bekräfta borttagning" hidden>
            <span></span>
            <button type="button" class="btn kt-danger" data-act="confirm-delete">Ta bort</button>
            <button type="button" class="btn btn--ghost" data-act="cancel-delete">Avbryt</button>
          </span>
        </section>
      </aside>
    </section>`;
}
