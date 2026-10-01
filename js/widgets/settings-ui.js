/**
 * WIDGETS — inställnings-UI (issue #115, kompakt i #123), delat av
 * lektionens formulär ("Widgets" efter "Fält") och Morgonskärmens panel
 * ("Widgets" sist).
 *
 * Bara aktiva widgets visas, en kompakt rad per widget (samma radhöjd och
 * typografi som "Att göra" på Morgonskärmen):
 *
 *   ◔ Nedräkning ”Läsning”                8:00  ▶ ⚙ ✕
 *   🕐 Klocka (analog)                            ⚙ ✕
 *      uppe vänster · L
 *   [+ Lägg till widget]
 *
 *  - Kort status (rowName/rowMeta/rowTime nedan — rena, testas i Node):
 *    timrarnas tid till höger på raden; Morgonskärmens plats och storlek,
 *    skyltens nivå och mätarens mikrofonläge på en liten rad under namnet
 *    (som "Eleverna ser: …" i "Att göra" — panelen är för smal för allt på
 *    en rad).
 *  - ▶/⏸ (bara Nedräkning) styr timern direkt. Återställ ligger i ⚙-läget.
 *  - ⚙ fäller ut widgetens inställningar under raden — en åt gången. En
 *    nytillagd widget öppnas utfälld. Där finns platsväljaren (fyra hörn;
 *    väljs ett upptaget hörn byter de två widgetarna plats), storlek S/M/L
 *    och typens egna inställningar (settingsHTML/bindSettings).
 *  - ✕ tar bort direkt; "Ångra" står i statusraden i några sekunder.
 *  - "+ Lägg till widget" öppnar en meny (WAI-ARIA, js/ui/menu-button.js —
 *    samma som ⋯-menyn i lektionen). Typer som bara får finnas en gång är
 *    avstängda när de redan finns; knappen stängs av vid tre brickor i
 *    lektionen och när alla fyra hörnen är tagna på Morgonskärmen.
 *
 *   root.innerHTML = "";   // en tom behållare i sektionen
 *   const ui = mountWidgetSettings(root, { form: "lesson", get: () => list, set: (next) => save(next) });
 *   ui.render();           // när listan bytts utifrån (annan planering / annat fönster)
 *   ui.setPlacement(map);  // Morgonskärmen: faktisk plats/skala efter krockar (createCornerLayer)
 *   ui.setDockCovered(ids); // Morgonskärmen: widgets som Elevskärm-dockan skymmer här (#120)
 *   ui.destroy();
 *
 * ctx.lesson() (valfri, lektionen) → { date, start, end } för radens
 * "Kvar av lektionen".
 */

import { icon } from "../lib/icons.js";
import { serverNow } from "../lib/clock.js";
import { createMenuButton } from "../ui/menu-button.js";
import {
  widgetTypes, widgetType, createLessonWidget, createMorningWidget, freeSlot,
  normalizeCfg, MAX_CHIPS, SLOTS, SLOT_LABELS, SIZES, SIZE_LABELS,
} from "./registry.js";
import { readRuntime, writeRuntime, watchRuntime } from "./runtime.js";
import { lessonLeftView, untilView, countdownView, normalizeCountdownCfg, normalizeTimeLeftCfg } from "./timer-logic.js";
import { countdownAct } from "./timers.js";
import { signLevelOf, normalizeNames } from "./sound-level.js";
import { createClockTicker } from "./clock-shared.js";
import { mic } from "./sound-mic.js";
import { DOCK_COVERED_TEXT } from "../lib/dock.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Hjälptexterna följer respektive panel (lektionens fält, morgonpanelens rader). */
const HINT = { lesson: "field-edit__hint", morning: "morgon__hint" };

/** Så länge "Ångra" står kvar efter ✕. */
export const UNDO_MS = 6000;

/** Kort plats på raden: "uppe vänster". */
export const SLOT_SHORT = { tl: "uppe vänster", tr: "uppe höger", bl: "nere vänster", br: "nere höger" };

/** Kortnamn i sammanfattningen — klockorna heter bara "Klocka" där. */
const SUMMARY_NAMES = { "clock-digital": "Klocka", "clock-analog": "Klocka" };

/** En typs namn i formuläret (names: { morning: "…" }, issue #117). */
const typeName = (type, form) => type?.names?.[form] ?? type?.name ?? "";

/** Kort sammanfattning för en infälld sektion: "Klocka, Nedräkning" / "Inga". */
export function widgetsSummary(list, form = "lesson") {
  const names = [];
  for (const w of list ?? []) {
    const t = widgetType(w.type);
    const name = t && (SUMMARY_NAMES[t.id] ?? typeName(t, form));
    if (name && !names.includes(name)) names.push(name);
  }
  return names.length ? names.join(", ") : "Inga";
}

const countdownTitle = (w) => (w.type === "countdown" ? normalizeCountdownCfg(w.cfg ?? {}).title.trim() : "");

/**
 * Radens namn: "Nedräkning ”Läsning”", "Nedräkning 2" (flera utan rubrik),
 * "Kvar till 10:40" (Morgonskärmen), annars typens namn. Morgonpanelen är
 * för smal för typ + rubrik + tid + tre knappar: där står bara ”Läsning”
 * och typen på raden under (rowMeta).
 */
export function rowName(w, form = "lesson", all = [w]) {
  const type = widgetType(w.type);
  const name = typeName(type, form) || w.type;
  if (w.type === "countdown") {
    const title = countdownTitle(w);
    if (title) return form === "morning" ? `”${title}”` : `${name} ”${title}”`;
    const same = all.filter((x) => x.type === w.type);
    return same.length > 1 ? `${name} ${same.findIndex((x) => x.id === w.id) + 1}` : name;
  }
  if (w.type === "time-left" && form === "morning") {
    const until = normalizeTimeLeftCfg(w.cfg ?? {}).until;
    if (until) return `Kvar till ${until}`;
  }
  return name;
}

/** Hela namnet (typ + rubrik) — för skärmläsare, verktygstips och "… borttagen". */
export function rowLabel(w, form = "lesson", all = [w]) {
  const title = countdownTitle(w);
  return title ? `${typeName(widgetType(w.type), form)} ”${title}”` : rowName(w, form, all);
}

const METER_TEXT = { on: "Mäter", starting: "Startar …", denied: "Mikrofonen blockerad", unavailable: "Ingen mikrofon", error: "Mikrofonfel" };

/**
 * Radens korta status efter namnet (utan tid): ["uppe vänster", "L"],
 * ["2 Prata lågt"], ["Av"]. `state` = { runtime, mic } — skyltens
 * körtillstånd och mikrofonens { status, owner }.
 */
export function rowMeta(w, form = "lesson", { runtime = null, mic: m = null } = {}) {
  const parts = [];
  if (form === "morning" && countdownTitle(w)) parts.push(typeName(widgetType(w.type), form));
  if (w.type === "sound-sign") {
    const level = signLevelOf(runtime);
    parts.push(`${level} ${normalizeNames(w.cfg?.names)[level]}`);
  } else if (w.type === "sound-meter") {
    parts.push((m?.owner === w.id && METER_TEXT[m.status]) || "Av");
  }
  if (form === "morning" && SLOT_SHORT[w.slot]) parts.push(SLOT_SHORT[w.slot], SIZE_LABELS[w.size] ?? "");
  return parts.filter(Boolean);
}

/**
 * Timerns tid på raden, eller null: { text, status, label }. `runtime` =
 * nedräkningens körtillstånd, `lesson` = { date, start, end }.
 */
export function rowTime(w, form = "lesson", { runtime = null, lesson = null, now = serverNow() } = {}) {
  let v;
  if (w.type === "countdown") v = countdownView(normalizeCountdownCfg(w.cfg ?? {}), runtime, now);
  else if (w.type === "time-left") {
    v = form === "morning" ? untilView(normalizeTimeLeftCfg(w.cfg ?? {}).until, now) : lessonLeftView(lesson, now);
  } else return null;
  const label = v.status === "done" ? "Tiden är ute" : v.status === "paused" ? "Pausad" : "";
  return { text: v.text, status: v.status, label };
}

/** Radens enda timerknapp för ett läge: ▶ eller ⏸. */
export function playButton(status) {
  if (status === "running") return { act: "pause", label: "Pausa", icon: "pause" };
  if (status === "paused") return { act: "resume", label: "Fortsätt", icon: "play" };
  if (status === "done") return { act: "start", label: "Starta igen", icon: "play" };
  return { act: "start", label: "Starta", icon: "play" };
}

/**
 * Lägg till-knappens läge: { disabled, text }. Lektionen: högst MAX_CHIPS
 * brickor; Morgonskärmen: ett hörn per widget.
 */
export function addState(list, form = "lesson") {
  const all = list ?? [];
  if (form === "morning") {
    return freeSlot(all) ? { disabled: false, text: "Lägg till widget" } : { disabled: true, text: "Alla hörn är upptagna" };
  }
  const shown = all.filter((w) => widgetType(w.type)).length;
  return shown >= MAX_CHIPS ? { disabled: true, text: `Högst ${MAX_CHIPS} i lektionen` } : { disabled: false, text: "Lägg till widget" };
}

/** Menyns val: [{ id, name, icon, disabled }] — en typ som bara får finnas en gång är avstängd när den finns. */
export function addMenuItems(list, form = "lesson") {
  const all = list ?? [];
  return widgetTypes().map((t) => ({
    id: t.id,
    name: typeName(t, form),
    icon: t.icon,
    disabled: !t.multiple && all.some((w) => w.type === t.id),
  }));
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
  const isMorning = form === "morning";
  const hintCls = HINT[form] ?? HINT.lesson;
  const group = `wset-${++uid}`;
  const bodyId = (id) => `${group}-body-${id}`;
  let bound = []; // cleanup från typernas bindSettings
  let watches = []; // körtillståndslyssnare för raderna
  let placement = new Map();
  let studentPlacement = null; // elevskärmens platser när den är öppen (#119)
  let dockCovered = new Set(); // widgets som Elevskärm-dockan skymmer i lärarvyn (#120)
  let openId = null; // widgeten vars inställningar är utfällda (⚙)
  let undo = null; // { w, index, name, after, timer } — senast borttagna
  let menu = null; // "+ Lägg till widget" (createMenuButton)

  const list = () => (Array.isArray(get()) ? get() : []);
  const idsOf = (l) => l.map((w) => w.id).join("|");
  // ctx till typernas settingsHTML/bindSettings. siblings() = alla widgets i
  // listan (#118: ljudmätaren letar upp ljudnivåskylten den kan kopplas till).
  const ownCtx = (w) => ({ ...ctx, form, widgetId: w.id, siblings: () => list().map(({ id, type, cfg }) => ({ id, type, cfg })) });
  const rtOf = (id) => readRuntime(ctx.classId ?? null, id);
  const sel = (attr, id) => `[${attr}="${CSS.escape(id)}"]`;

  function slotPicker(w, all) {
    const taken = new Map(all.filter((x) => x.id !== w.id).map((x) => [x.slot, x]));
    return `<div class="wset__slots" role="radiogroup" aria-label="Plats">
      ${SLOTS.map((s) => {
        const other = taken.get(s);
        // Ett upptaget hörn går att välja — widgetarna byter plats (#119).
        const title = other ? `${SLOT_LABELS[s]} — byter plats med ${rowLabel(other, form, all)}` : SLOT_LABELS[s];
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

  /** Den utfällda delen under raden (⚙): plats + storlek + typens egna inställningar. */
  function bodyHTML(type, w, all) {
    const own = typeof type.settingsHTML === "function" ? type.settingsHTML(w.cfg, ownCtx(w)) : "";
    const place = isMorning
      ? `<div class="wset__place">
          <span class="wset__label">Plats</span>${slotPicker(w, all)}
          <span class="wset__label">Storlek</span>${sizePicker(w)}
        </div>`
      : "";
    return `<div class="wrow__body" id="${esc(bodyId(w.id))}">${place}${own ? `<div class="wset__own">${own}</div>` : ""}</div>`;
  }

  function rowHTML(type, w, all) {
    const label = rowLabel(w, form, all);
    const open = openId === w.id;
    const timer = w.type === "countdown" || w.type === "time-left";
    const btn = (attr, ico, text, extra = "") =>
      `<button type="button" class="wrow__btn" ${attr}="${esc(w.id)}" title="${esc(text)}" aria-label="${esc(`${text}: ${label}`)}"${extra}>${icon(ico)}</button>`;
    return `<li class="wrow${open ? " is-open" : ""}" data-wid="${esc(w.id)}">
      <div class="wrow__line">
        <span class="wrow__icon" aria-hidden="true">${icon(type.icon)}</span>
        <span class="wrow__name" title="${esc(label)}">${esc(rowName(w, form, all))}</span>
        ${timer ? `<span class="wrow__time" data-wtime="${esc(w.id)}"></span>` : ""}
        <span class="wrow__btns">
          ${w.type === "countdown" ? btn("data-wplay", "play", "Starta") : ""}
          ${btn("data-wexpand", "settings", "Inställningar", ` aria-expanded="${open}" aria-controls="${esc(bodyId(w.id))}"`)}
          ${btn("data-wremove", "x", "Ta bort")}
        </span>
      </div>
      <div class="wrow__sub" data-wmeta="${esc(w.id)}" hidden></div>
      <p class="${hintCls} wset__placed" data-wplaced="${esc(w.id)}" hidden></p>
      ${open ? bodyHTML(type, w, all) : ""}
    </li>`;
  }

  function html() {
    const all = list();
    const rows = all.map((w) => [widgetType(w.type), w]).filter(([t]) => t);
    const add = addState(all, form);
    const items = addMenuItems(all, form).map((it) => `<button type="button" role="menuitem" class="plan-more__item" data-wadd="${esc(it.id)}"${
      it.disabled ? ` aria-disabled="true" title="Finns redan"` : ""}>${icon(it.icon)} ${esc(it.name)}</button>`).join("");

    let hint = isMorning ? "Visas i det hörn du väljer" : "Visas i rubrikraden";
    hint = `<p class="${hintCls}">${hint}</p>`;
    const shown = all.filter((w) => widgetType(w.type)).length;
    if (!isMorning && shown > MAX_CHIPS) {
      hint += `<p class="${hintCls} wset__warn" role="status">Bara de ${MAX_CHIPS} första visas på tavlan.</p>`;
    }
    return `${rows.length ? `<ul class="wset-list" aria-label="Widgets">${rows.map(([t, w]) => rowHTML(t, w, all)).join("")}</ul>` : ""}
      <div class="wset-add" data-wadd-root>
        <button type="button" class="btn wset-add__btn" data-wmenu-btn${add.disabled ? " disabled" : ""}>${add.disabled ? "" : icon("plus")}<span>${esc(add.text)}</span></button>
        <div class="plan-more__menu wset-add__menu" data-wmenu aria-label="Lägg till widget">${items}</div>
      </div>
      ${hint}`;
  }

  function bindOwn() {
    for (const off of bound) { try { off?.(); } catch { /* ok */ } }
    bound = [];
    const w = openId && list().find((x) => x.id === openId);
    const type = w && widgetType(w.type);
    const own = w && root.querySelector(`${sel("data-wid", w.id)} .wset__own`);
    if (!type || !own || typeof type.bindSettings !== "function") return;
    bound.push(type.bindSettings(own, w.cfg, (cfg) => {
      // Egna inställningar sparas utan att sektionen byggs om (fokus behålls).
      void set(list().map((x) => (x.id === w.id ? { ...x, cfg: normalizeCfg(x.type, cfg) } : x)));
      paintLive(); // namnet/tiden på raden följer (rubrik, minuter)
      const nameEl = root.querySelector(`${sel("data-wid", w.id)} .wrow__name`);
      const cur = list().find((x) => x.id === w.id);
      if (nameEl && cur) { nameEl.textContent = rowName(cur, form, list()); nameEl.title = rowLabel(cur, form, list()); }
    }, ownCtx(w)));
  }

  function bindMenu() {
    menu?.close();
    menu = null;
    const addRoot = root.querySelector("[data-wadd-root]");
    const button = addRoot?.querySelector("[data-wmenu-btn]");
    if (!button || button.disabled) {
      const m = addRoot?.querySelector("[data-wmenu]");
      if (m) m.hidden = true;
      return;
    }
    menu = createMenuButton({ root: addRoot, button, menu: addRoot.querySelector("[data-wmenu]") });
  }

  function watchRows() {
    for (const off of watches) { try { off(); } catch { /* ok */ } }
    watches = [];
    for (const w of list()) {
      if (w.type === "countdown" || w.type === "sound-sign") watches.push(watchRuntime(ctx.classId ?? null, w.id, () => paintLive()));
    }
  }

  /** Raden som fokus står på (eller i), så att den kan få tillbaka fokus efter en omritning. */
  function focusKey() {
    const a = document.activeElement;
    if (!a || !root.contains(a)) return null;
    for (const attr of ["data-wplay", "data-wexpand", "data-wremove"]) {
      if (a.hasAttribute(attr)) return sel(attr, a.getAttribute(attr));
    }
    if (a.dataset.wslot) return `${sel("data-wslot", a.dataset.wslot)}[value="${a.value}"]`;
    if (a.dataset.wsize) return `${sel("data-wsize", a.dataset.wsize)}[value="${a.value}"]`;
    if (a.closest("[data-wadd-root]")) return "[data-wmenu-btn]";
    return null;
  }

  function render({ focus } = {}) {
    const keep = focus === undefined ? focusKey() : null;
    const all = list();
    if (openId && !all.some((w) => w.id === openId)) openId = null;
    // Listan bytt utifrån (annan planering, annat fönster) → "Ångra" gäller inte längre.
    if (undo && undo.after !== idsOf(all)) clearUndo();
    menu?.close();
    content.innerHTML = html();
    bindOwn();
    bindMenu();
    watchRows();
    applyPlacement();
    paintLive();
    paintUndo();
    const target = focus ?? keep;
    if (target) {
      const el = root.querySelector(target) ?? (focus ? root.querySelector("[data-wmenu-btn]") : null);
      el?.focus();
    }
  }

  /** Radernas levande del: timrarnas tid och knapp, skyltens nivå, mätarens läge. */
  function paintLive() {
    const all = list();
    const lesson = typeof ctx.lesson === "function" ? ctx.lesson() : null;
    const micSnap = { status: mic.status, owner: mic.owner };
    const now = serverNow();
    for (const w of all) {
      const metaEl = root.querySelector(sel("data-wmeta", w.id));
      if (!metaEl) continue;
      const rt = w.type === "countdown" || w.type === "sound-sign" ? rtOf(w.id) : null;
      const meta = rowMeta(w, form, { runtime: rt, mic: micSnap });
      const metaText = meta.join(" · ");
      if (metaEl.textContent !== metaText) { metaEl.textContent = metaText; metaEl.hidden = !metaText; }
      const timeEl = root.querySelector(sel("data-wtime", w.id));
      const t = timeEl && rowTime(w, form, { runtime: rt, lesson, now });
      if (t) {
        if (timeEl.textContent !== t.text) timeEl.textContent = t.text;
        timeEl.dataset.status = t.status;
        timeEl.title = t.label;
      }
      const play = root.querySelector(sel("data-wplay", w.id));
      if (play && t && play.dataset.act !== `${t.status}`) {
        const b = playButton(t.status);
        play.dataset.act = t.status;
        play.dataset.wact = b.act;
        play.innerHTML = icon(b.icon);
        play.title = b.label;
        play.setAttribute("aria-label", `${b.label}: ${rowLabel(w, form, all)}`);
      }
    }
  }

  function applyPlacement() {
    for (const p of root.querySelectorAll("[data-wplaced]")) {
      const w = list().find((x) => x.id === p.dataset.wplaced);
      const lines = w && placementLines(w, placement.get(w.id), studentPlacement?.get(w.id) ?? null, !!studentPlacement);
      const text = w && ([lines, dockCovered.has(w.id) && DOCK_COVERED_TEXT].filter(Boolean).join("\n") || null);
      p.hidden = !text;
      p.textContent = text ?? "";
    }
  }

  function clearUndo() {
    if (undo) clearTimeout(undo.timer);
    undo = null;
  }

  function paintUndo() {
    const el = undoEl;
    if (!undo) { if (el.textContent) el.textContent = ""; return; }
    if (el.querySelector("[data-wundo-btn]")) return;
    el.innerHTML = `<span>${esc(undo.name)} borttagen.</span> <button type="button" class="wset__undo-btn" data-wundo-btn>${icon("undo")}<span>Ångra</span></button>`;
  }

  async function commit(next, opts) {
    await set(next);
    render(opts);
  }

  const create = (type, all) => (isMorning ? createMorningWidget(type, all) : createLessonWidget(type));

  function onChange(e) {
    const t = e.target;
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

  function remove(id) {
    const all = list();
    const index = all.findIndex((w) => w.id === id);
    if (index < 0) return;
    const w = all[index];
    const next = all.filter((x) => x.id !== id);
    // Fokus: nästa rad (annars föregående), annars "+ Lägg till widget".
    const near = next[index] ?? next[index - 1];
    clearUndo();
    undo = { w, index, name: rowLabel(w, form, all), after: idsOf(next), timer: setTimeout(() => { undo = null; paintUndo(); }, UNDO_MS) };
    if (openId === id) openId = null;
    void commit(next, { focus: near ? sel("data-wexpand", near.id) : "[data-wmenu-btn]" });
  }

  function restore() {
    if (!undo) return;
    const { w, index } = undo;
    clearUndo();
    const all = list();
    if (all.some((x) => x.id === w.id)) { render(); return; }
    const next = [...all];
    next.splice(Math.min(index, next.length), 0, w);
    void commit(next, { focus: sel("data-wexpand", w.id) });
  }

  function onClick(e) {
    const add = e.target.closest("[data-wadd]");
    if (add) {
      if (add.getAttribute("aria-disabled") === "true") return;
      const all = list();
      const w = create(add.dataset.wadd, all);
      if (!w) return;
      openId = w.id; // en nytillagd widget öppnas utfälld
      void commit([...all, w], { focus: sel("data-wexpand", w.id) });
      return;
    }
    const exp = e.target.closest("[data-wexpand]");
    if (exp) {
      const id = exp.dataset.wexpand;
      openId = openId === id ? null : id;
      render({ focus: sel("data-wexpand", id) });
      return;
    }
    const rm = e.target.closest("[data-wremove]");
    if (rm) { remove(rm.dataset.wremove); return; }
    const play = e.target.closest("[data-wplay]");
    if (play) {
      const w = list().find((x) => x.id === play.dataset.wplay);
      if (!w) return;
      const rt = { read: () => rtOf(w.id), write: (s) => writeRuntime(ctx.classId ?? null, w.id, s) };
      countdownAct(play.dataset.wact ?? "start", normalizeCountdownCfg(w.cfg ?? {}), rt);
      paintLive();
      return;
    }
    if (e.target.closest("[data-wundo-btn]")) restore();
  }

  // Innehållet ritas om; statusraden ("… borttagen. Ångra") står kvar, så
  // att skärmläsaren läser upp den när texten byts.
  root.innerHTML = `<div class="wset" data-wcontent></div><p class="${hintCls} wset__undo" role="status" data-wundo></p>`;
  const content = root.querySelector("[data-wcontent]");
  const undoEl = root.querySelector("[data-wundo]");
  root.addEventListener("change", onChange);
  root.addEventListener("click", onClick);
  // Timrarnas tid tickar i takt med klockan; mikrofonens läge kommer från tjänsten.
  const stopTick = createClockTicker(() => paintLive(), { periodMs: 250 });
  const offMic = mic.subscribe(() => paintLive());
  render();

  return {
    render,
    setPlacement(map) { placement = map ?? new Map(); applyPlacement(); },
    /** Elevskärmens platser (null = ingen elevskärm öppen). */
    setStudentPlacement(map) { studentPlacement = map ?? null; applyPlacement(); },
    /** Id:n som Elevskärm-dockan skymmer här (js/lib/dock.js) — bara när den inte kunde lyftas. */
    setDockCovered(ids) { dockCovered = new Set(ids ?? []); applyPlacement(); },
    destroy() {
      root.removeEventListener("change", onChange);
      root.removeEventListener("click", onClick);
      stopTick();
      offMic();
      clearUndo();
      menu?.close();
      menu = null;
      for (const off of [...bound, ...watches]) { try { off?.(); } catch { /* ok */ } }
      bound = [];
      watches = [];
    },
  };
}
