/**
 * WIDGETS — inställnings-UI (issue #115), delat av lektionens formulär
 * ("Widgets" efter "Fält") och Morgonskärmens panel ("Widgets" sist).
 *
 * En kryssruta per widget-typ. Typer som får finnas flera gånger (t.ex.
 * timrar) får "+ Lägg till" och en ta bort-knapp per instans. Under en
 * ikryssad typ visas instansens egna inställningar (typens settingsHTML/
 * bindSettings) och — på Morgonskärmen — platsväljaren (fyra hörn; väljs ett
 * upptaget hörn byter de två widgetarna plats) och storlek S/M/L.
 *
 *   root.innerHTML = "";   // en tom behållare i sektionen
 *   const ui = mountWidgetSettings(root, { form: "lesson", get: () => list, set: (next) => save(next) });
 *   ui.render();           // när listan bytts utifrån (annan planering / annat fönster)
 *   ui.setPlacement(map);  // Morgonskärmen: faktisk plats/skala efter krockar (createCornerLayer)
 *   ui.destroy();
 */

import { icon } from "../lib/icons.js";
import {
  widgetTypes, widgetType, createLessonWidget, createMorningWidget, freeSlot,
  normalizeCfg, MAX_CHIPS, SLOTS, SLOT_LABELS, SIZES, SIZE_LABELS,
} from "./registry.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Utseendet följer respektive panel (lektionens fältrader, morgonpanelens rader). */
const LOOK = {
  lesson:  { row: "field-edit wset", head: "field-edit__head", hint: "field-edit__hint" },
  morning: { row: "wset wset--morning", head: "wset__head morgon__show", hint: "morgon__hint" },
};

/** Kort sammanfattning för en infälld sektion: "Klocka (digital)" / "Inga widgets". */
export function widgetsSummary(list, form = "lesson") {
  const names = [];
  for (const w of list ?? []) {
    const t = widgetType(w.type);
    const name = t && (t.names?.[form] ?? t.name);
    if (name && !names.includes(name)) names.push(name);
  }
  return names.length ? names.join(", ") : "Inga widgets";
}

/** "kortet", "Bra jobbat-tavlan" → "kortet och Bra jobbat-tavlan" (blockedBy från resolveSlots). */
function blockedText(names) {
  const parts = (names ?? []).filter(Boolean).map((n) => (n === "widget" ? "en annan widget" : n));
  if (!parts.length) return "kortet eller Bra jobbat";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} och ${parts.at(-1)}`;
}

/**
 * Raden under en widget i panelen när den inte står som läraren valt
 * (issue #119), eller null. `at` = { slot, scale, blockedBy } från resolveSlots.
 */
export function placementText(w, at) {
  if (!at) return null;
  const what = blockedText(at.blockedBy);
  if (!at.slot) return `Dold just nu — ryms inte i något hörn utan att skymma ${what}.`;
  if (at.slot !== w.slot) {
    return `Flyttad till ${SLOT_LABELS[at.slot].toLowerCase()} — skulle skymma ${what}${at.scale < 1 ? ". Visas också mindre" : ""}.`;
  }
  if (at.scale < 1) return `Mindre för att inte skymma ${what}.`;
  return null;
}

/**
 * Panelens text för en widget: lärarvyns rad, och — med en öppen elevskärm —
 * elevskärmens, som är den eleverna ser. Samma på båda = en rad.
 */
export function placementLines(w, here, student, studentOpen = false) {
  const h = placementText(w, here);
  if (!studentOpen) return h;
  const s = placementText(w, student);
  if (h === s) return h;
  return [s && `På elevskärmen: ${s}`, h && `Här: ${h}`].filter(Boolean).join("\n") || null;
}

let uid = 0;

export function mountWidgetSettings(root, { form = "lesson", get, set, ctx = {} }) {
  const look = LOOK[form] ?? LOOK.lesson;
  const isMorning = form === "morning";
  // En typ kan heta olika i formulären (names: { morning: "…" }, issue #117).
  const nameOf = (type) => type?.names?.[form] ?? type?.name;
  const group = `wset-${++uid}`;
  let bound = []; // cleanup från typernas bindSettings
  let placement = new Map();
  let studentPlacement = null; // elevskärmens platser när den är öppen (#119)

  const list = () => (Array.isArray(get()) ? get() : []);

  function slotPicker(w, all) {
    const taken = new Map(all.filter((x) => x.id !== w.id).map((x) => [x.slot, x]));
    return `<div class="wset__slots" role="radiogroup" aria-label="Plats">
      ${SLOTS.map((s) => {
        const other = taken.get(s);
        // Ett upptaget hörn går att välja — widgetarna byter plats (#119).
        const title = other ? `${SLOT_LABELS[s]} — byter plats med ${nameOf(widgetType(other.type)) ?? "en annan widget"}` : SLOT_LABELS[s];
        return `<label class="wset__slot wset__slot--${s}${other ? " wset__slot--taken" : ""}" title="${esc(title)}">
          <input type="radio" name="${group}-slot-${esc(w.id)}" value="${s}" data-wslot="${esc(w.id)}"
            aria-label="${esc(title)}"${w.slot === s ? " checked" : ""}>
          <span aria-hidden="true"></span>
        </label>`;
      }).join("")}
    </div>`;
  }

  function sizePicker(w) {
    return `<div class="wset__sizes" role="radiogroup" aria-label="Storlek">
      ${SIZES.map((s) => `<label class="wset__size">
        <input type="radio" name="${group}-size-${esc(w.id)}" value="${s}" data-wsize="${esc(w.id)}"
          aria-label="Storlek ${SIZE_LABELS[s]}"${w.size === s ? " checked" : ""}>
        <span aria-hidden="true">${SIZE_LABELS[s]}</span>
      </label>`).join("")}
    </div>`;
  }

  function itemHTML(type, w, i, all) {
    const own = typeof type.settingsHTML === "function" ? type.settingsHTML(w.cfg, { ...ctx, form, widgetId: w.id }) : "";
    const head = type.multiple
      ? `<div class="wset__itemhead"><span>${esc(nameOf(type))} ${i + 1}</span>
          <button type="button" class="btn btn--icon wset__remove" data-wremove="${esc(w.id)}"
            title="Ta bort" aria-label="Ta bort ${esc(nameOf(type))} ${i + 1}">${icon("x")}</button></div>`
      : "";
    const place = isMorning
      ? `<div class="wset__place">
          <span class="wset__label">Plats</span>${slotPicker(w, all)}
          <span class="wset__label">Storlek</span>${sizePicker(w)}
        </div>
        <p class="${look.hint} wset__placed" data-wplaced="${esc(w.id)}" hidden></p>`
      : "";
    if (!head && !place && !own) return "";
    return `<div class="wset__item" data-wid="${esc(w.id)}">${head}${place}${own ? `<div class="wset__own">${own}</div>` : ""}</div>`;
  }

  function html() {
    const all = list();
    const slotsFull = isMorning && !freeSlot(all);
    const rows = widgetTypes().map((type) => {
      const mine = all.filter((w) => w.type === type.id);
      const on = mine.length > 0;
      const disabled = !on && slotsFull;
      const add = type.multiple && on
        ? `<button type="button" class="btn wset__add" data-wadd="${esc(type.id)}"${slotsFull ? " disabled" : ""}>${icon("plus")}<span>Lägg till</span></button>`
        : "";
      return `<div class="${look.row}${on ? "" : " field-edit--off"}" data-wtype="${esc(type.id)}">
        <div class="${look.head}">
          <label><input type="checkbox" data-wtoggle="${esc(type.id)}"${on ? " checked" : ""}${disabled ? " disabled" : ""}>
            ${icon(type.icon)} <span>${esc(nameOf(type))}</span></label>
          ${add}
        </div>
        ${mine.map((w, i) => itemHTML(type, w, i, all)).join("")}
      </div>`;
    }).join("");

    let hint;
    if (isMorning) {
      hint = `<p class="${look.hint}">Visas i hörnet du väljer. Skulle den skymma kortet eller Bra jobbat blir den mindre där.</p>`
        + (slotsFull ? `<p class="${look.hint} wset__warn" role="status">Alla fyra hörnen är upptagna.</p>` : "");
    } else {
      const shown = all.filter((w) => widgetType(w.type)).length;
      hint = `<p class="${look.hint}">Visas som brickor i rubrikraden — högst ${MAX_CHIPS}.</p>`
        + (shown > MAX_CHIPS
          ? `<p class="${look.hint} wset__warn" role="status">Du har ${shown} ikryssade — bara de ${MAX_CHIPS} första visas på tavlan.</p>`
          : "");
    }
    return `<div class="wset-list">${rows}</div>${hint}`;
  }

  function bindOwn() {
    for (const off of bound) { try { off?.(); } catch { /* ok */ } }
    bound = [];
    for (const itemEl of root.querySelectorAll("[data-wid]")) {
      const w = list().find((x) => x.id === itemEl.dataset.wid);
      const type = w && widgetType(w.type);
      if (!type || typeof type.bindSettings !== "function") continue;
      const own = itemEl.querySelector(".wset__own");
      if (!own) continue;
      bound.push(type.bindSettings(own, w.cfg, (cfg) => {
        // Egna inställningar sparas utan att sektionen byggs om (fokus behålls).
        void set(list().map((x) => (x.id === w.id ? { ...x, cfg: normalizeCfg(x.type, cfg) } : x)));
      }, { ...ctx, form, widgetId: w.id }));
    }
  }

  function render() {
    root.innerHTML = html();
    bindOwn();
    applyPlacement();
  }

  function applyPlacement() {
    for (const p of root.querySelectorAll("[data-wplaced]")) {
      const w = list().find((x) => x.id === p.dataset.wplaced);
      const text = w && placementLines(w, placement.get(w.id), studentPlacement?.get(w.id) ?? null, !!studentPlacement);
      p.hidden = !text;
      p.textContent = text ?? "";
    }
  }

  async function commit(next) {
    await set(next);
    render();
  }

  const create = (type, all) => (isMorning ? createMorningWidget(type, all) : createLessonWidget(type));

  function onChange(e) {
    const t = e.target;
    if (t.dataset.wtoggle) {
      const all = list();
      if (t.checked) {
        const w = create(t.dataset.wtoggle, all);
        if (!w) { t.checked = false; return; }
        void commit([...all, w]);
      } else {
        void commit(all.filter((w) => w.type !== t.dataset.wtoggle));
      }
      return;
    }
    if (t.dataset.wslot && t.checked) {
      // Upptaget hörn → den andra widgeten tar över det här widgetens hörn.
      const all = list();
      const from = all.find((w) => w.id === t.dataset.wslot)?.slot;
      void commit(all.map((w) => {
        if (w.id === t.dataset.wslot) return { ...w, slot: t.value };
        if (w.slot === t.value && from) return { ...w, slot: from };
        return w;
      }));
      return;
    }
    if (t.dataset.wsize && t.checked) {
      void commit(list().map((w) => (w.id === t.dataset.wsize ? { ...w, size: t.value } : w)));
    }
  }

  function onClick(e) {
    const add = e.target.closest("[data-wadd]");
    if (add) {
      const all = list();
      const w = create(add.dataset.wadd, all);
      if (w) void commit([...all, w]);
      return;
    }
    const rm = e.target.closest("[data-wremove]");
    if (rm) void commit(list().filter((w) => w.id !== rm.dataset.wremove));
  }

  root.addEventListener("change", onChange);
  root.addEventListener("click", onClick);
  render();

  return {
    render,
    setPlacement(map) { placement = map ?? new Map(); applyPlacement(); },
    /** Elevskärmens platser (null = ingen elevskärm öppen). */
    setStudentPlacement(map) { studentPlacement = map ?? null; applyPlacement(); },
    destroy() {
      root.removeEventListener("change", onChange);
      root.removeEventListener("click", onClick);
      for (const off of bound) { try { off?.(); } catch { /* ok */ } }
      bound = [];
    },
  };
}
