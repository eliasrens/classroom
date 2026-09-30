/**
 * WIDGETS — inställnings-UI (issue #115), delat av lektionens formulär
 * ("Widgets" efter "Fält") och Morgonskärmens panel ("Widgets" sist).
 *
 * En kryssruta per widget-typ. Typer som får finnas flera gånger (t.ex.
 * timrar) får "+ Lägg till" och en ta bort-knapp per instans. Under en
 * ikryssad typ visas instansens egna inställningar (typens settingsHTML/
 * bindSettings) och — på Morgonskärmen — platsväljaren (fyra hörn, upptagna
 * är avstängda) och storlek S/M/L.
 *
 *   root.innerHTML = "";   // en tom behållare i sektionen
 *   const ui = mountWidgetSettings(root, { form: "lesson", get: () => list, set: (next) => save(next) });
 *   ui.render();           // när listan bytts utifrån (annan planering / annat fönster)
 *   ui.setPlacement(map);  // Morgonskärmen: faktisk plats efter krockar (createCornerLayer)
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

let uid = 0;

export function mountWidgetSettings(root, { form = "lesson", get, set, ctx = {} }) {
  const look = LOOK[form] ?? LOOK.lesson;
  const isMorning = form === "morning";
  // En typ kan heta olika i formulären (names: { morning: "…" }, issue #117).
  const nameOf = (type) => type?.names?.[form] ?? type?.name;
  const group = `wset-${++uid}`;
  let bound = []; // cleanup från typernas bindSettings
  let placement = new Map();

  const list = () => (Array.isArray(get()) ? get() : []);

  function slotPicker(w, all) {
    const taken = new Map(all.filter((x) => x.id !== w.id).map((x) => [x.slot, x]));
    return `<div class="wset__slots" role="radiogroup" aria-label="Plats">
      ${SLOTS.map((s) => {
        const other = taken.get(s);
        const title = other ? `${SLOT_LABELS[s]} — upptagen av ${nameOf(widgetType(other.type)) ?? "en annan widget"}` : SLOT_LABELS[s];
        return `<label class="wset__slot wset__slot--${s}" title="${esc(title)}">
          <input type="radio" name="${group}-slot-${esc(w.id)}" value="${s}" data-wslot="${esc(w.id)}"
            aria-label="${esc(title)}"${w.slot === s ? " checked" : ""}${other ? " disabled" : ""}>
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
      hint = `<p class="${look.hint}">Visas i hörnen på Morgonskärmen. Två widgets kan inte ha samma plats — en widget som skulle skymma kortet eller Bra jobbat flyttas till närmaste lediga hörn.</p>`
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
      if (!w || !placement.has(w.id)) { p.hidden = true; continue; }
      const at = placement.get(w.id);
      if (at === w.slot) { p.hidden = true; continue; }
      p.hidden = false;
      p.textContent = at
        ? `Visas just nu ${SLOT_LABELS[at].toLowerCase()} — platsen krockar med kortet eller Bra jobbat.`
        : "Får inte plats just nu utan att skymma kortet eller Bra jobbat — prova en mindre storlek.";
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
      void commit(list().map((w) => (w.id === t.dataset.wslot ? { ...w, slot: t.value } : w)));
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
    destroy() {
      root.removeEventListener("change", onChange);
      root.removeEventListener("click", onClick);
      for (const off of bound) { try { off?.(); } catch { /* ok */ } }
      bound = [];
    },
  };
}
