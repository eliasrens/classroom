/**
 * ÖVERMENYN — två grupper (issue #45). Byggs helt ur js/modes/registry.js.
 *
 *   [I klassrummet]  Morgon · Lektion · Trafikljus · … · [Mer ▾]   |   [Lärare ▾]
 *
 *  - "I klassrummet": lägena som kan visas för eleverna (group:
 *    "classroom"), var och ett med ikon + kort namn. Aktivt läge har
 *    aria-current="page" och markeras tydligt.
 *  - "Lärare ▾": rullgardin med lärarlägena (group: "teacher"). Står man
 *    i ett lärarläge visar knappen det: "Lärare: Elevlista ▾".
 *
 * RESPONSIVT. Menyn får den plats som blir över i topbaren (klassväljare,
 * elevskärmsknapp, synkstatus m.m. trängs aldrig ut). Ryms den inte
 * komprimeras den ett steg i taget tills den gör det:
 *   0  gruppetikett + ikon + namn
 *   1  utan gruppetikett
 *   2  klassrumslägena bara som ikoner (tooltip + aria-label)
 *   3  lärarknappen kortad ("Elevlista ▾" i stället för "Lärare: Elevlista ▾")
 *   4… de minst prioriterade klassrumslägena (högst `priority`) flyttas,
 *      ett i taget, till "Mer ▾". Fler än MAX_INLINE lägen flyttas alltid.
 * Nivån räknas om när menyns bredd ändras (ResizeObserver) och vid lägesbyte.
 */

import { icon } from "../lib/icons.js";
import { NAV_GROUPS, modesInGroup, shortTitle } from "../modes/registry.js";
import { createMenuButton } from "./menu-button.js";

/** Så många klassrumslägen får stå i raden innan resten alltid går till "Mer ▾". */
export const MAX_INLINE = 8;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const chevron = () => `<span class="mode-nav__chevron" aria-hidden="true">${icon("chevron-down", { size: 14 })}</span>`;

const menuItem = (m) => `
  <a class="mode-nav__item" role="menuitem" tabindex="-1" href="#/${m.id}" data-mode="${m.id}">
    ${icon(m.icon)}<span>${esc(m.title)}</span></a>`;

export function initModeNav({ el, store }) {
  const classroom = modesInGroup("classroom");
  const teacher = modesInGroup("teacher");

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
      <span class="mode-nav__divider" aria-hidden="true"></span>
      <div class="mode-nav__menu mode-nav__teacher">
        <button type="button" class="mode-nav__btn" id="mode-nav-teacher-btn"
          aria-controls="mode-nav-teacher-menu">
          <span class="mode-nav__btn-icon"></span>
          <span class="mode-nav__teacher-label"></span>${chevron()}</button>
        <div class="mode-nav__popup mode-nav__popup--end" id="mode-nav-teacher-menu" aria-labelledby="mode-nav-teacher-btn">
          ${teacher.map(menuItem).join("")}
        </div>
      </div>
    </div>`;

  const rowEl = el.querySelector(".mode-nav__row");
  const moreEl = el.querySelector(".mode-nav__more");
  const moreBtn = moreEl.querySelector("button");
  const teacherEl = el.querySelector(".mode-nav__teacher");
  const teacherBtn = teacherEl.querySelector("button");
  const teacherLabel = teacherEl.querySelector(".mode-nav__teacher-label");

  createMenuButton({ root: moreEl, button: moreBtn, menu: moreEl.querySelector(".mode-nav__popup") });
  createMenuButton({ root: teacherEl, button: teacherBtn, menu: teacherEl.querySelector(".mode-nav__popup") });

  // ---- Aktivt läge ----

  function renderActive() {
    const { modeId } = store.get();
    for (const a of el.querySelectorAll("[data-mode]")) {
      if (a.dataset.mode === modeId) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }

    // Lärarknappen: "Lärare ▾" — eller "Lärare: Elevlista ▾" i ett lärarläge.
    const t = teacher.find((m) => m.id === modeId);
    teacherEl.dataset.current = String(!!t);
    teacherEl.querySelector(".mode-nav__btn-icon").innerHTML = t ? icon(t.icon) : "";
    teacherLabel.innerHTML = t
      ? `<span class="mode-nav__teacher-prefix">${esc(NAV_GROUPS.teacher.label)}: </span>${esc(shortTitle(t))}`
      : esc(NAV_GROUPS.teacher.label);
    teacherBtn.setAttribute("aria-label", t ? `${NAV_GROUPS.teacher.label}: ${t.title} — fler lärarlägen` : `${NAV_GROUPS.teacher.label} — lärarlägen`);
    teacherBtn.title = teacherBtn.getAttribute("aria-label");
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

  let lastWidth = -1;
  function layout() {
    if (!el.isConnected || el.clientWidth === 0) return; // dold (t.ex. elevvy)
    lastWidth = el.clientWidth;
    const maxLevel = 3 + classroom.length;
    let level = 0;
    apply(level);
    while (!fits() && level < maxLevel) apply(++level);
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
