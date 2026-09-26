/**
 * ÖVERMENYN — rutiner + två rullgardiner (issue #45, #52). Byggs helt ur
 * js/modes/registry.js.
 *
 *   ☀ Morgon  ▤ Lektion  ◉ Trafikljus  ★ Veckan  [Mer ▾] │ Verktyg ▾ │ Lärare ▾
 *
 *  - Rutiner (group: "classroom"): alltid i raden, var och en med ikon +
 *    kort namn. Aktivt läge har aria-current="page" och markeras tydligt.
 *  - "Verktyg ▾" (group: "tools"): Skrivtavla, Lottning … Står man i ett
 *    verktyg visar knappen det: "Verktyg: Lottning ▾". Ett nytt verktyg
 *    behöver bara `group: "tools"` i registret.
 *  - "Lärare ▾" (group: "teacher"): samma komponent. "Lärare: Elevlista ▾".
 *
 * RESPONSIVT. Menyn får den plats som blir över i topbaren (klassväljare,
 * elevskärmsknapp, synkstatus m.m. trängs aldrig ut). Ryms den inte
 * komprimeras den ett steg i taget tills den gör det:
 *   0  gruppetikett + ikon + namn
 *   1  utan gruppetikett
 *   2  rutinerna bara som ikoner (tooltip + aria-label)
 *   3  rullgardinsknapparna kortade ("Lottning ▾" i stället för
 *      "Verktyg: Lottning ▾")
 *   4… de minst prioriterade rutinerna (högst `priority`) flyttas,
 *      ett i taget, till "Mer ▾". Fler än MAX_INLINE lägen flyttas alltid.
 * Skulle färre än MIN_INLINE rutiner stå kvar (mycket smalt fönster)
 * får menyn i stället en egen rad under topbaren (data-wrap) och
 * komprimeras där på samma sätt.
 * Nivån räknas om när menyns bredd ändras (ResizeObserver) och vid lägesbyte.
 */

import { icon } from "../lib/icons.js";
import { NAV_GROUPS, NAV_GROUP_ORDER, modesInGroup, shortTitle } from "../modes/registry.js";
import { createMenuButton } from "./menu-button.js";

/** Så många rutiner får stå i raden innan resten alltid går till "Mer ▾". */
export const MAX_INLINE = 8;
/** Ryms inte så här många i topbaren får menyn en egen rad. */
const MIN_INLINE = 3;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const chevron = () => `<span class="mode-nav__chevron" aria-hidden="true">${icon("chevron-down", { size: 14 })}</span>`;

const menuItem = (m) => `
  <a class="mode-nav__item" role="menuitem" tabindex="-1" href="#/${m.id}" data-mode="${m.id}">
    ${icon(m.icon)}<span>${esc(m.title)}</span></a>`;

/** Åtgärd (inte ett läge) sist i "Lärare ▾", t.ex. "Byt lösenord" (issue #49). */
const actionItem = (a) => `
  <button type="button" class="mode-nav__item mode-nav__action" role="menuitem" tabindex="-1" data-action="${esc(a.id)}">
    ${icon(a.icon)}<span>${esc(a.title)}</span></button>`;

/**
 * En grupps rullgardin ("Verktyg ▾", "Lärare ▾"). Knappens etikett
 * sätts i renderActive(). `end` = menyn öppnas åt vänster (sist i raden).
 */
const groupMenu = (group, modes, { end = false, extra = "" } = {}) => `
  <span class="mode-nav__divider" aria-hidden="true"></span>
  <div class="mode-nav__menu mode-nav__dropdown mode-nav__${group}" data-group="${group}">
    <button type="button" class="mode-nav__btn" id="mode-nav-${group}-btn"
      aria-controls="mode-nav-${group}-menu">
      <span class="mode-nav__btn-icon"></span>
      <span class="mode-nav__btn-label"></span>${chevron()}</button>
    <div class="mode-nav__popup${end ? " mode-nav__popup--end" : ""}" id="mode-nav-${group}-menu" aria-labelledby="mode-nav-${group}-btn">
      ${modes.map(menuItem).join("")}
      ${extra}
    </div>
  </div>`;

/** Vad knappen säger om gruppen, t.ex. "lärarlägen" i aria-label. */
const GROUP_NOUN = { tools: "verktyg", teacher: "lärarlägen" };

/**
 * @param actions  [{id, title, icon, run}] — lärarens åtgärder, efter en
 *                 avdelare i "Lärare ▾". Menyn visas aldrig på elevskärmen.
 */
export function initModeNav({ el, store, actions = [] }) {
  const classroom = modesInGroup("classroom");
  // Rullgardinerna efter rutinerna, i menyordning. Tomma grupper visas inte
  // (Lärare ▾ visas alltid — där står även lärarens åtgärder).
  const dropdowns = NAV_GROUP_ORDER
    .filter((g) => g !== "classroom")
    .map((group) => ({ group, modes: modesInGroup(group) }))
    .filter((d) => d.modes.length || (d.group === "teacher" && actions.length));

  // Överflödsordning: minst prioriterade först (högst priority; lika → sist i menyn först).
  const overflowOrder = classroom
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (b.m.priority ?? 99) - (a.m.priority ?? 99) || b.i - a.i)
    .map(({ m }) => m.id);

  el.innerHTML = `
    <div class="mode-nav__row">
      <div class="mode-nav__group" role="group" aria-label="${esc(NAV_GROUPS.classroom.label)}">
        <span class="mode-nav__caption" aria-hidden="true">${esc(NAV_GROUPS.classroom.label)}</span>
        ${classroom.map((m) => `
          <a class="mode-nav__link" href="#/${m.id}" data-mode="${m.id}"
            title="${esc(m.title)}" aria-label="${esc(m.title)}">
            ${icon(m.icon)}<span class="mode-nav__label">${esc(shortTitle(m))}</span></a>`).join("")}
        <div class="mode-nav__menu mode-nav__more" hidden>
          <button type="button" class="mode-nav__btn" id="mode-nav-more-btn"
            aria-controls="mode-nav-more-menu" title="Fler lägen">
            <span class="mode-nav__btn-icon"></span><span>Mer</span>${chevron()}</button>
          <div class="mode-nav__popup" id="mode-nav-more-menu" aria-labelledby="mode-nav-more-btn">
            ${classroom.map(menuItem).join("")}
          </div>
        </div>
      </div>
      ${dropdowns.map(({ group, modes }, i) => groupMenu(group, modes, {
        end: i === dropdowns.length - 1,
        extra: group === "teacher" && actions.length
          ? `<div class="mode-nav__sep" role="separator"></div>${actions.map(actionItem).join("")}` : "",
      })).join("")}
    </div>`;

  const rowEl = el.querySelector(".mode-nav__row");
  const moreEl = el.querySelector(".mode-nav__more");
  const moreBtn = moreEl.querySelector("button");
  createMenuButton({ root: moreEl, button: moreBtn, menu: moreEl.querySelector(".mode-nav__popup") });

  for (const d of dropdowns) {
    d.el = el.querySelector(`.mode-nav__dropdown[data-group="${d.group}"]`);
    d.btn = d.el.querySelector("button");
    d.label = d.el.querySelector(".mode-nav__btn-label");
    createMenuButton({ root: d.el, button: d.btn, menu: d.el.querySelector(".mode-nav__popup") });
  }

  // Åtgärderna: lyssna på el (bubblar EFTER menyns egen stängning, som
  // lämnar fokus på knappen) — så att en dialog kan ta fokus själv.
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn) actions.find((a) => a.id === btn.dataset.action)?.run();
  });

  // ---- Aktivt läge ----

  function renderActive() {
    const { modeId } = store.get();
    for (const a of el.querySelectorAll("[data-mode]")) {
      if (a.dataset.mode === modeId) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }

    // Rullgardinsknapparna: "Verktyg ▾" — eller "Verktyg: Lottning ▾" när
    // man står i ett av gruppens lägen (likadant "Lärare: Elevlista ▾").
    for (const d of dropdowns) {
      const name = NAV_GROUPS[d.group].label;
      const noun = GROUP_NOUN[d.group] ?? "lägen";
      const cur = d.modes.find((m) => m.id === modeId);
      d.el.dataset.current = String(!!cur);
      d.el.querySelector(".mode-nav__btn-icon").innerHTML = cur ? icon(cur.icon) : "";
      d.label.innerHTML = cur
        ? `<span class="mode-nav__btn-prefix">${esc(name)}: </span>${esc(shortTitle(cur))}`
        : esc(name);
      d.btn.setAttribute("aria-label", cur ? `${name}: ${cur.title} — fler ${noun}` : `${name} — ${noun}`);
      d.btn.title = d.btn.getAttribute("aria-label");
    }
    renderMoreButton();
  }

  // ---- Komprimering + "Mer ▾" ----

  let overflow = new Set();

  function renderMoreButton() {
    const { modeId } = store.get();
    const hiddenActive = overflow.has(modeId) ? classroom.find((m) => m.id === modeId) : null;
    moreEl.hidden = overflow.size === 0;
    moreEl.dataset.current = String(!!hiddenActive);
    moreEl.querySelector(".mode-nav__btn-icon").innerHTML = hiddenActive ? icon(hiddenActive.icon) : "";
    moreBtn.setAttribute("aria-label", hiddenActive ? `Mer: ${hiddenActive.title} — fler lägen` : "Fler lägen");
    moreBtn.title = moreBtn.getAttribute("aria-label");
  }

  function apply(level) {
    el.dataset.level = String(Math.min(level, 3));
    const n = Math.max(level - 3, 0, classroom.length - MAX_INLINE);
    overflow = new Set(overflowOrder.slice(0, Math.min(n, classroom.length)));
    for (const a of el.querySelectorAll(".mode-nav__link")) a.hidden = overflow.has(a.dataset.mode);
    for (const a of moreEl.querySelectorAll(".mode-nav__item")) a.hidden = !overflow.has(a.dataset.mode);
    renderMoreButton();
  }

  const fits = () => rowEl.getBoundingClientRect().width <= el.clientWidth + 0.5;

  /** Lägsta nivå som ryms (högst `maxLevel`); false om ingen gör det. */
  function fitLevel(maxLevel) {
    let level = 0;
    apply(level);
    while (!fits() && level < maxLevel) apply(++level);
    return fits();
  }

  let lastWidth = -1;
  function layout() {
    if (!el.isConnected || !el.getClientRects().length) return; // dold (t.ex. elevvy)
    const minInline = Math.min(MIN_INLINE, classroom.length);
    delete el.dataset.wrap;
    if (!fitLevel(3 + classroom.length - minInline)) {
      el.dataset.wrap = "true"; // egen rad under topbaren
      fitLevel(3 + classroom.length);
    }
    lastWidth = el.clientWidth;
  }

  store.subscribe(["modeId"], () => { renderActive(); layout(); }); // ritar även direkt

  // Menyns bredd styrs av topbaren (resten av raden) — räkna om när den ändras.
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => { if (el.clientWidth !== lastWidth) layout(); }).observe(el);
  } else {
    window.addEventListener("resize", layout);
  }
  // Webbfonter kan ändra textbredden efter första mätningen.
  document.fonts?.ready?.then(layout).catch(() => {});

  return { layout };
}
