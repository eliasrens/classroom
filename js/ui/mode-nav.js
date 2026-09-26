/**
 * ÖVERMENYN — fästa lägen + "Verktyg ▾" + "Lärare ▾" (issue #45, #52).
 * Byggs helt ur js/modes/registry.js.
 *
 *   ☀ Morgon  ▤ Lektion  ◉ Trafikljus  │  Verktyg ▾  │  Lärare ▾
 *
 *  - FÄSTA LÄGEN: de rutiner/verktyg som läraren fäst (js/lib/menu-pins.js,
 *    privat per lärare i teachers/{uid}/settings/menu), med ikon + kort
 *    namn, i listans ordning. Aktivt läge har aria-current="page".
 *  - "Verktyg ▾": STARTLISTAN med alla rutiner och verktyg under två
 *    rubriker. Klick/Enter på en rad öppnar läget och stänger listan.
 *    Nålen längst till höger fäster/lossar läget i övermenyn (listan
 *    förblir öppen). Tangentbord: → eller Tab från raden når nålen,
 *    ← / Shift+Tab tillbaka; P fäster/lossar raden direkt.
 *    Står man i ett läge som INTE är fäst visar knappen det:
 *    "Verktyg: Lottning ▾".
 *  - "Lärare ▾": lärarlägena + åtgärder. "Lärare: Elevlista ▾".
 *
 * RESPONSIVT. Menyn får den plats som blir över i topbaren (klassväljare,
 * elevskärmsknapp, synkstatus m.m. trängs aldrig ut). Ryms den inte
 * komprimeras den ett steg i taget tills den gör det:
 *   0  ikon + namn
 *   1  de fästa lägena bara som ikoner (tooltip + aria-label)
 *   2  rullgardinsknapparna kortade ("Lottning ▾" i st.f. "Verktyg: Lottning ▾")
 *   3  rullgardinsknappen för det aktiva läget bara ikon ▾
 * Ryms den inte ens då får menyn en egen rad under topbaren (data-wrap)
 * och komprimeras där på samma sätt; räcker inte heller det bryts raden
 * (data-crowded). Alla lägen finns alltid i "Verktyg ▾", så inget
 * "Mer ▾" behövs. Nivån räknas om när menyns bredd ändras
 * (ResizeObserver), vid lägesbyte och när de fästa lägena ändras.
 */

import { icon } from "../lib/icons.js";
import { NAV_GROUPS, modesInGroup, shortTitle } from "../modes/registry.js";
import {
  MENU_SETTINGS_DOC, menuSettingsPath, pinnedIds, togglePinned,
} from "../lib/menu-pins.js";
import { currentUid } from "../data/plans.js";
import { createMenuButton } from "./menu-button.js";

/** Högsta komprimeringsnivån (se ovan). */
const MAX_LEVEL = 3;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const chevron = () => `<span class="mode-nav__chevron" aria-hidden="true">${icon("chevron-down", { size: 14 })}</span>`;

const menuItem = (m) => `
  <a class="mode-nav__item" role="menuitem" tabindex="-1" href="#/${m.id}" data-mode="${m.id}">
    ${icon(m.icon)}<span>${esc(m.title)}</span></a>`;

/** Rad i "Verktyg ▾": öppna läget + nål som fäster/lossar det. */
const pinRow = (m) => `
  <div class="mode-nav__pinrow" role="none">
    ${menuItem(m)}
    <button type="button" class="mode-nav__pin" tabindex="-1" data-pin="${m.id}">${icon("pin", { size: 16 })}</button>
  </div>`;

/** Åtgärd (inte ett läge) sist i "Lärare ▾", t.ex. "Byt lösenord" (issue #49). */
const actionItem = (a) => `
  <button type="button" class="mode-nav__item mode-nav__action" role="menuitem" tabindex="-1" data-action="${esc(a.id)}">
    ${icon(a.icon)}<span>${esc(a.title)}</span></button>`;

/** Rullgardin med knapp; innehållet i listan och `end` (öppnas åt vänster). */
const dropdown = (group, body, { end = false } = {}) => `
  <div class="mode-nav__menu mode-nav__dropdown mode-nav__${group}" data-group="${group}">
    <button type="button" class="mode-nav__btn" id="mode-nav-${group}-btn"
      aria-controls="mode-nav-${group}-menu">
      <span class="mode-nav__btn-icon"></span>
      <span class="mode-nav__btn-label"></span>${chevron()}</button>
    <div class="mode-nav__popup${end ? " mode-nav__popup--end" : ""}" id="mode-nav-${group}-menu" aria-labelledby="mode-nav-${group}-btn">
      ${body}
    </div>
  </div>`;

/** Rubrik + rader för en grupp i "Verktyg ▾". */
const pinSection = (group) => {
  const modes = modesInGroup(group);
  if (!modes.length) return "";
  return `
    <div class="mode-nav__section" role="group" aria-labelledby="mode-nav-h-${group}">
      <div class="mode-nav__heading" id="mode-nav-h-${group}" role="presentation">${esc(NAV_GROUPS[group].label)}</div>
      ${modes.map(pinRow).join("")}
    </div>`;
};

/**
 * @param data     datalagret — de fästa lägena sparas privat per lärare.
 * @param actions  [{id, title, icon, run}] — lärarens åtgärder, efter en
 *                 avdelare i "Lärare ▾". Menyn visas aldrig på elevskärmen.
 */
export function initModeNav({ el, store, data, actions = [] }) {
  const pinnable = [...modesInGroup("classroom"), ...modesInGroup("tools")];
  const teacher = modesInGroup("teacher");
  const settingsPath = menuSettingsPath(currentUid());
  let pinned = pinnedIds(null); // tills datalagret svarat (svarar direkt ur lokal lagring)

  el.innerHTML = `
    <div class="mode-nav__row">
      <div class="mode-nav__pinned" role="group" aria-label="Fästa lägen"></div>
      <span class="mode-nav__divider mode-nav__divider--pinned" aria-hidden="true"></span>
      ${dropdown("tools", `${pinSection("classroom")}${pinSection("tools")}`)}
      <span class="mode-nav__divider" aria-hidden="true"></span>
      ${dropdown("teacher", `${teacher.map(menuItem).join("")}
        ${actions.length ? `<div class="mode-nav__sep" role="separator"></div>${actions.map(actionItem).join("")}` : ""}`,
        { end: true })}
    </div>`;

  const rowEl = el.querySelector(".mode-nav__row");
  const pinnedEl = el.querySelector(".mode-nav__pinned");
  const pinnedDivider = el.querySelector(".mode-nav__divider--pinned");

  const menus = {};
  for (const group of ["tools", "teacher"]) {
    const root = el.querySelector(`.mode-nav__dropdown[data-group="${group}"]`);
    const btn = root.querySelector("button");
    const popup = root.querySelector(".mode-nav__popup");
    menus[group] = { root, btn, popup, label: root.querySelector(".mode-nav__btn-label") };
    createMenuButton({ root, button: btn, menu: popup });
  }
  const toolsPopup = menus.tools.popup;

  // Åtgärderna: lyssna på el (bubblar EFTER menyns egen stängning, som
  // lämnar fokus på knappen) — så att en dialog kan ta fokus själv.
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn) actions.find((a) => a.id === btn.dataset.action)?.run();
  });

  // ---- Fäst / lossa ----

  function setPinned(next) {
    pinned = next;
    renderPinned();
    renderActive();
    layout();
  }

  function togglePin(id) {
    setPinned(togglePinned(pinned, id));
    void data?.put(settingsPath, { id: MENU_SETTINGS_DOC, pinned });
  }

  // Nålen öppnar ALDRIG läget och listan förblir öppen (den ligger
  // bredvid menyvalet, så menyknappens "val → stäng" slår inte till).
  toolsPopup.addEventListener("click", (e) => {
    const pin = e.target.closest("[data-pin]");
    if (!pin) return;
    e.preventDefault();
    togglePin(pin.dataset.pin);
    pin.focus();
  });

  // Tangentbord i listan — fångas före menyknappens egen hantering.
  toolsPopup.addEventListener("keydown", (e) => {
    const t = e.target;
    const row = t.closest?.(".mode-nav__pinrow");
    if (!row) return;
    const item = row.querySelector('[role="menuitem"]');
    const pin = row.querySelector("[data-pin]");
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (t === item) {
      if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) { stop(); pin.focus(); }
      else if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        stop(); togglePin(pin.dataset.pin);
      }
    } else if (t === pin) {
      if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) { stop(); item.focus(); }
      else if (e.key === "p" || e.key === "P") { stop(); togglePin(pin.dataset.pin); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) item.focus(); // menyknappen flyttar vidare
      else if (e.key === " " || e.key === "Enter") { stop(); pin.click(); }
    }
  }, true);

  // ---- Rendering ----

  function renderPinned() {
    const list = pinnable.filter((m) => pinned.includes(m.id));
    pinnedEl.innerHTML = list.map((m) => `
      <a class="mode-nav__link" href="#/${m.id}" data-mode="${m.id}"
        title="${esc(m.title)}" aria-label="${esc(m.title)}">
        ${icon(m.icon)}<span class="mode-nav__label">${esc(shortTitle(m))}</span></a>`).join("");
    pinnedEl.hidden = pinnedDivider.hidden = list.length === 0;

    for (const pin of toolsPopup.querySelectorAll("[data-pin]")) {
      const m = pinnable.find((x) => x.id === pin.dataset.pin);
      const on = pinned.includes(m.id);
      pin.setAttribute("aria-pressed", String(on));
      pin.setAttribute("aria-label", on ? `Ta bort ${m.title} från menyn` : `Fäst ${m.title} i menyn`);
      pin.title = on ? "Ta bort från menyn" : "Fäst i menyn";
      pin.closest(".mode-nav__pinrow").dataset.pinned = String(on);
    }
  }

  function renderActive() {
    const { modeId } = store.get();
    for (const a of el.querySelectorAll("[data-mode]")) {
      if (a.dataset.mode === modeId) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }

    // "Verktyg: Lottning ▾" när man står i ett läge som inte är fäst;
    // "Lärare: Elevlista ▾" i ett lärarläge.
    const shown = {
      tools: pinned.includes(modeId) ? null : pinnable.find((m) => m.id === modeId),
      teacher: teacher.find((m) => m.id === modeId),
    };
    const noun = { tools: "alla rutiner och verktyg", teacher: "lärarlägen" };
    for (const [group, cur] of Object.entries(shown)) {
      const { root, btn, label } = menus[group];
      const name = NAV_GROUPS[group].label;
      root.dataset.current = String(!!cur);
      root.querySelector(".mode-nav__btn-icon").innerHTML = cur ? icon(cur.icon) : "";
      label.innerHTML = cur
        ? `<span class="mode-nav__btn-prefix">${esc(name)}: </span>${esc(shortTitle(cur))}`
        : esc(name);
      btn.setAttribute("aria-label", cur ? `${name}: ${cur.title} — ${noun[group]}` : `${name} — ${noun[group]}`);
      btn.title = btn.getAttribute("aria-label");
    }
  }

  // ---- Komprimering ----

  const fits = () => rowEl.getBoundingClientRect().width <= el.clientWidth + 0.5;

  /** Lägsta nivå som ryms; false om inte ens MAX_LEVEL gör det. */
  function fitLevel() {
    let level = 0;
    el.dataset.level = "0";
    while (!fits() && level < MAX_LEVEL) el.dataset.level = String(++level);
    return fits();
  }

  let lastWidth = -1;
  function layout() {
    if (!el.isConnected || !el.getClientRects().length) return; // dold (t.ex. elevvy)
    delete el.dataset.wrap;
    delete el.dataset.crowded;
    if (!fitLevel()) {
      el.dataset.wrap = "true"; // egen rad under topbaren
      if (!fitLevel()) el.dataset.crowded = "true"; // bryt raden i sista hand
    }
    lastWidth = el.clientWidth;
  }

  // ---- Data + prenumerationer ----

  renderPinned();
  store.subscribe(["modeId"], () => { renderActive(); layout(); }); // ritar även direkt

  // Lärarens fästa lägen (privat, offline-först; svarar direkt ur lokal
  // lagring och igen när molnet/andra flikar ändrar dem).
  data?.watch(settingsPath, (docs) => {
    const next = pinnedIds(docs.find((d) => d.id === MENU_SETTINGS_DOC) ?? null);
    if (next.join() !== pinned.join()) setPinned(next);
  });

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
