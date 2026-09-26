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
 * Säker borttagning: ett klick på en bubbla gör ingenting farligt. Den tas
 * bort med sitt lilla × (eller Delete när den har fokus), och Ångra tar
 * tillbaka den. Ångra ångrar det senaste: tillagd, borttagen, flyttad,
 * ändrad bubbla, Töm tavlan och Ordna automatiskt. Dubbelklick ändrar
 * texten. En bubbla kan dras till en egen plats; "Ordna automatiskt"
 * släpper alla sådana.
 *
 * Data (DATAMODELL.md): ENDAST LOKALT i classes/{cid}/karta (bubblorna kan
 * innehålla elevnamn — js/data/local-only.js, aldrig Firestore):
 *   state      { cur, paper, rev }        — kartan som visas, valt papper
 *   map-<id>   { name, title, bubbles: [{ id, text, color, pin? }], nextColor, rev }
 * Varje ändring går direkt ut på sync-bussen (`karta:state`
 * { cid, cur, map, rev }) och sparas (rubriken med debounce), så att en
 * omladdad elevskärm visar samma karta. `rev` ordnar bussen mot
 * storage-eventet som hos Skrivtavlan.
 *
 * Skriv ut: A3/A4, liggande/stående — js/modes/karta/print.js.
 */

import { icon } from "../lib/icons.js";
import { createScene } from "./karta/scene.js";
import { PALETTE } from "./karta/palette.js";
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

/** Normalisera ett sparat kartdokument. */
export function normalizeMap(raw) {
  if (!raw || !isMapId(raw.id)) return null;
  const seen = new Set();
  const bubbles = (Array.isArray(raw.bubbles) ? raw.bubbles : [])
    .filter((b) => typeof b?.id === "string" && typeof b.text === "string" && b.text.trim() && !seen.has(b.id) && seen.add(b.id))
    .slice(0, MAX_BUBBLES)
    .map((b) => {
      const pin = normalizePin(b.pin);
      return { id: b.id, text: cleanText(b.text, MAX_TEXT), color: Number.isInteger(b.color) ? b.color : 0, ...(pin ? { pin } : {}) };
    });
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name.slice(0, MAX_TITLE) : "",
    title: typeof raw.title === "string" ? raw.title.slice(0, MAX_TITLE) : "",
    bubbles,
    nextColor: Number.isInteger(raw.nextColor) ? raw.nextColor : bubbles.length,
    createdAt: Number(raw.createdAt) || 0,
    rev: Number(raw.rev) || 0,
  };
}

/** Namnet i listan: eget namn, annars rubriken, annars "Ny karta". */
export const mapLabel = (m) => (m?.name?.trim() || m?.title?.trim() || NEW_NAME);

/** Det som eleverna ser (och bussen bär): bara rubrik och bubblor. */
const publicMap = (m) => (m ? { id: m.id, title: m.title, bubbles: m.bubbles.map((b) => ({ ...b })) } : null);

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

      /** @type {Array<ReturnType<typeof normalizeMap>>} */
      let maps = [];
      let cur = null;
      let paper = DEFAULT_PAPER;
      let rev = 0;
      let loaded = false;
      let titleTimer = 0;
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
          case "remove": return `Ångra: ta tillbaka ${quote(op.bubble.text)}`;
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
            m.bubbles.splice(Math.min(op.index, m.bubbles.length), 0, op.bubble);
            say(`${quote(op.bubble.text)} är tillbaka.`);
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

      function addBubble() {
        const m = curMap();
        const text = cleanText(input.value, MAX_TEXT);
        if (!m || !text) { input.focus(); return; }
        if (m.bubbles.length >= MAX_BUBBLES) { say(`Kartan rymmer högst ${MAX_BUBBLES} bubblor.`); return; }
        const b = { id: newBubbleId(), text, color: m.nextColor % PALETTE.length };
        m.nextColor = (m.nextColor + 1) % PALETTE.length;
        m.bubbles.push(b);
        pushUndo(m, { t: "add", id: b.id });
        input.value = "";
        closeConfirms();
        say("");
        commit(m);
        input.focus();
      }

      function removeBubble(id) {
        const m = curMap();
        const index = m?.bubbles.findIndex((b) => b.id === id) ?? -1;
        if (index < 0) return;
        const [bubble] = m.bubbles.splice(index, 1);
        pushUndo(m, { t: "remove", bubble, index });
        closeConfirms();
        commit(m);
        say(`${quote(bubble.text)} togs bort — Ångra tar tillbaka den.`);
        // Fokus till grannen (eller inmatningen) så att tangentbordet inte tappar bort sig.
        const next = stage.querySelectorAll(".kt-bubble")[Math.min(index, m.bubbles.length - 1)];
        (next ?? input).focus({ preventScroll: true });
      }

      function clearAll() {
        const m = curMap();
        if (!m || m.bubbles.length === 0) return;
        pushUndo(m, { t: "clear", bubbles: m.bubbles.map((b) => ({ ...b })) });
        const n = m.bubbles.length;
        m.bubbles = [];
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

      // ---- Kartor ----

      function selectMap(id, { focusTitle = false } = {}) {
        if (id === cur) return;
        flush();
        cur = maps.some((m) => m.id === id) ? id : null;
        closeConfirms();
        closePrintPanel();
        say("");
        publish();
        saveState();
        renderAll({ animate: false });
        if (focusTitle) scene.focusTitle();
      }

      function newMap(from = null) {
        const m = {
          id: newMapId(),
          name: from ? `${mapLabel(from)} (kopia)`.slice(0, MAX_TITLE) : "",
          title: from?.title ?? "",
          bubbles: from ? from.bubbles.map((b) => ({ ...b, id: newBubbleId() })) : [],
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
      const onKey = (e) => {
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

        <form class="kt-add teacher-only" autocomplete="off">
          <input class="kt-input" type="text" name="kt-text" maxlength="${MAX_TEXT}" autocomplete="off"
            spellcheck="false" placeholder="Skriv och tryck Enter" aria-label="Ny bubbla">
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

        <p class="kt-hint teacher-only">Skicka ut med <strong>Visa på elevskärm</strong>. Eleverna ser kartan växa medan du skriver.
          Ta bort en bubbla med dess <strong>×</strong>, ändra texten med dubbelklick och dra den dit du vill.
          Kartorna sparas bara på den här datorn, aldrig i molnet.</p>
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
