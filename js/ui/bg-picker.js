/**
 * "VÄLJ BILD" — miniatyrväljare för morgonskärmens bakgrund (issue #64).
 *
 * En enkel dialog med flikar per kategori (Höst · Vinter · Vår · Sommar ·
 * Platser i världen, och "Egna" bara om det finns egna bilder). Årstidens
 * flik är förvald, bilden som används är markerad och ett klick sätter
 * bakgrunden direkt och stänger dialogen.
 *
 * Tangentbord: pil vänster/höger (Home/End) byter flik, Tab går mellan
 * miniatyrerna, Enter/mellanslag väljer och Esc stänger. Fokus stannar i
 * dialogen och går tillbaka till "Välj bild" när den stängs.
 *
 * Bara lärarvyn — elevskärmen följer med via datalagret som vanligt.
 */

import { icon } from "../lib/icons.js";
import { BG_CATEGORIES, thumbUrl, unsplashUrl } from "../lib/backgrounds.js";

let active = null; // { root, close }

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Flikarna: katalogens kategorier + "Egna" om det finns egna bilder. */
function tabsFor(extraUrls) {
  const tabs = BG_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    items: c.images.map((img) => ({ url: unsplashUrl(img.id), alt: img.alt, label: img.place ?? "" })),
  }));
  const own = (extraUrls ?? []).filter(Boolean);
  if (own.length) {
    tabs.push({
      id: "egna",
      label: "Egna",
      items: own.map((url, i) => ({ url, alt: `Egen bild ${i + 1}`, label: "" })),
    });
  }
  return tabs;
}

export function closeBgPicker() {
  active?.close();
}

/**
 * @param {object} o
 * @param {string} o.current     bakgrunden som används nu
 * @param {string[]} o.extraUrls egna bilder (background.extraUrls)
 * @param {string} o.season      årstidens kategori-id (förvald flik)
 * @param {HTMLElement} o.container  där dialogen läggs (morgonvyn)
 * @param {HTMLElement} [o.returnFocus]
 * @param {(url: string) => void} o.onPick
 */
export function openBgPicker({ current, extraUrls, season, container, returnFocus, onPick }) {
  closeBgPicker();
  const tabs = tabsFor(extraUrls);
  // Förvald flik: årstiden (spec). Finns den inte, första fliken.
  let tabId = tabs.some((t) => t.id === season) ? season : tabs[0].id;

  const root = document.createElement("div");
  root.className = "bgpicker teacher-only";
  root.innerHTML = `
    <div class="bgpicker__scrim" data-close></div>
    <div class="bgpicker__box" role="dialog" aria-modal="true" aria-labelledby="bgpicker-title">
      <header class="bgpicker__head">
        <strong id="bgpicker-title">${icon("image")} Välj bakgrundsbild</strong>
        <button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Stäng">${icon("x")}</button>
      </header>
      <div class="bgpicker__tabs" role="tablist" aria-label="Kategorier">
        ${tabs.map((t) => `
          <button type="button" role="tab" class="bgpicker__tab" id="bgpicker-tab-${t.id}"
            data-tab="${t.id}" aria-controls="bgpicker-grid">${esc(t.label)}</button>`).join("")}
      </div>
      <div class="bgpicker__grid" id="bgpicker-grid" role="tabpanel"></div>
    </div>`;
  container.append(root);

  const box = root.querySelector(".bgpicker__box");
  const grid = root.querySelector(".bgpicker__grid");
  const tabBtns = [...root.querySelectorAll(".bgpicker__tab")];

  function renderTab() {
    const tab = tabs.find((t) => t.id === tabId);
    for (const b of tabBtns) {
      const on = b.dataset.tab === tabId;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    grid.setAttribute("aria-labelledby", `bgpicker-tab-${tabId}`);
    grid.innerHTML = tab.items.map((it) => {
      const on = it.url === current;
      return `
        <button type="button" class="bgpicker__item" data-url="${esc(it.url)}" aria-pressed="${on}"
          title="${esc(it.alt)}">
          <img src="${esc(thumbUrl(it.url))}" alt="${esc(it.alt)}" loading="lazy" decoding="async">
          ${on ? `<span class="bgpicker__check" aria-hidden="true">${icon("check")}</span>` : ""}
          ${it.label ? `<span class="bgpicker__label">${esc(it.label)}</span>` : ""}
        </button>`;
    }).join("");
    grid.scrollTop = 0;
  }

  function selectTab(id, focus = false) {
    tabId = id;
    renderTab();
    if (focus) tabBtns.find((b) => b.dataset.tab === id)?.focus();
  }

  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { close(); return; }
    const tab = e.target.closest(".bgpicker__tab");
    if (tab) { selectTab(tab.dataset.tab); return; }
    const item = e.target.closest(".bgpicker__item");
    if (item) {
      const url = item.dataset.url;
      close();
      onPick(url);
    }
  });

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    const tab = e.target.closest?.(".bgpicker__tab");
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const i = tabBtns.indexOf(tab);
      const n = tabBtns.length;
      const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1
        : (i + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
      selectTab(tabBtns[j].dataset.tab, true);
      return;
    }
    if (e.key === "Tab") {
      // Håll fokus i dialogen.
      const focusables = [...box.querySelectorAll('button:not([tabindex="-1"])')];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  function close() {
    if (!root.isConnected) { active = null; return; }
    root.remove();
    active = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  active = { root, close };
  renderTab();
  // Fokus på den markerade bilden om den finns i fliken, annars på fliken.
  (grid.querySelector('.bgpicker__item[aria-pressed="true"]')
    ?? tabBtns.find((b) => b.dataset.tab === tabId))?.focus();
}

