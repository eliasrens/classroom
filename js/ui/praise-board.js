/**
 * "BRA JOBBAT"-TAVLAN — återanvändbar komponent.
 *
 * Visar en lista namn i en ruta som ALDRIG scrollar. När namnen inte
 * får plats på höjden läggs en kolumn till bredvid (rutan blir bredare);
 * blir rutan då bredare än `maxWidth()` krymper texten stegvis ner mot
 * en läsbar minsta storlek. Alla namn syns alltid.
 *
 * Används av morgonskärmen och lektionsplaneringen — samma data: den
 * LOKALA Bra jobbat-listan (classes/{id}/praise → "board", issue #32),
 * per dator och klass — aldrig i molnet.
 * Komponenten rör ingen data: anroparen matar in färdiga visningsnamn.
 *
 * Storlekar styrs från CSS (css/ui/praise-board.css) via custom properties
 * på rutan eller någon förälder:
 *   --praise-font-max   startstorlek för namnen (får vara clamp()/vw)
 *   --praise-font-min   läsbar minsta storlek innan rutan tillåts bli bredare
 *   --praise-fit: off   stäng av kolumnanpassningen (t.ex. när rutan inte
 *                       har en fast höjd, som på smala skärmar)
 *
 * Rutan behöver en BEGRÄNSAD höjd (t.ex. position:absolute med top+bottom,
 * eller en flex-/grid-cell) — det är höjden som avgör var kolumnerna bryts.
 *
 *   const board = createPraiseBoard({ clearable: true, onClear, maxWidth: () => 600,
 *                                     onLayout: (w) => … });
 *   parent.append(board.el);
 *   board.setNames(["Elsa", "Hugo"], { emptyText: "Kryssa i elever →" });
 *   board.destroy();
 */

import { icon } from "../lib/icons.js";

// Absolut golv om inte ens minsta storleken räcker inom maxWidth —
// hellre lite mindre text än ett namn som inte syns.
const HARD_MIN_RATIO = 0.7;
const STEP = 0.92;

/**
 * @param {object}   [opts]
 * @param {string}   [opts.title]      rubrik (default "⭐ Bra jobbat!")
 * @param {boolean}  [opts.clearable]  visa töm-knapp (lärarvy)
 * @param {Function} [opts.onClear]    klick på töm-knappen
 * @param {Function} [opts.maxWidth]   () => px, hur bred rutan högst får bli
 * @param {Function} [opts.onLayout]   (widthPx) => void efter varje anpassning
 * @param {string}   [opts.className]  extra klasser på rutan
 * @param {string}   [opts.tag]        elementtyp (default "aside")
 */
export function createPraiseBoard(opts = {}) {
  const {
    title = "⭐ Bra jobbat!",
    clearable = false,
    onClear = null,
    maxWidth = () => Infinity,
    onLayout = null,
    className = "",
    tag = "aside",
  } = opts;

  const el = document.createElement(tag);
  el.className = `praise-board ${className}`.trim();
  el.setAttribute("aria-label", "Bra jobbat");
  el.innerHTML = `
    <header class="praise-board__head">
      <h2 class="praise-board__title">${escapeHtml(title)}</h2>
      ${clearable ? `<button class="praise-board__clear teacher-only btn btn--ghost btn--icon" title="Töm namntavlan" aria-label="Töm namntavlan">${icon("trash")}</button>` : ""}
    </header>
    <ul class="praise-board__names"></ul>`;
  const list = el.querySelector(".praise-board__names");
  if (clearable && onClear) el.querySelector(".praise-board__clear").addEventListener("click", onClear);

  let names = [];
  let frame = 0;

  function setNames(next, { emptyText = "" } = {}) {
    names = [...next];
    list.innerHTML = names.length
      ? names.map((n) => `<li>${escapeHtml(n)}</li>`).join("")
      : emptyText ? `<li class="praise-board__empty">${escapeHtml(emptyText)}</li>` : "";
    fit();
  }

  /** Lägg ut namnen: flest rader som ryms → kolumner → ev. mindre text. */
  function fit() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!el.isConnected || el.hidden) return;

    list.style.fontSize = "";
    list.style.removeProperty("--praise-rows");
    delete list.dataset.flow;

    const off = getComputedStyle(el).getPropertyValue("--praise-fit").trim() === "off";
    if (off || !names.length) { report(); return; }

    const fMax = parseFloat(getComputedStyle(list).fontSize);
    list.style.fontSize = "var(--praise-font-min)";
    const fMin = Math.min(parseFloat(getComputedStyle(list).fontSize) || fMax, fMax);
    const floor = fMin * HARD_MIN_RATIO;
    const limit = Math.max(0, Number(maxWidth()) || Infinity);

    list.dataset.flow = "columns";
    let f = fMax;
    for (;;) {
      layoutAt(f);
      const fits = el.offsetWidth <= limit && list.scrollHeight <= list.clientHeight + 1;
      if (fits || f <= floor) break;
      // Ner till minsta storleken i jämna steg; därunder bara om det krävs.
      f = f > fMin ? Math.max(fMin, f * STEP) : Math.max(floor, f * STEP);
    }
    report();
  }

  function layoutAt(f) {
    list.style.fontSize = `${f}px`;
    list.style.setProperty("--praise-rows", String(names.length)); // mät en rad i taget
    const first = list.firstElementChild;
    const rowH = first ? first.getBoundingClientRect().height : f * 1.2;
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    const avail = list.clientHeight;
    const maxRows = Math.max(1, Math.min(names.length, Math.floor((avail + gap) / (rowH + gap))));
    // Jämna kolumner (10/10/10 i stället för 14/14/2) — samma antal kolumner, lägre höjd.
    const cols = Math.ceil(names.length / maxRows);
    list.style.setProperty("--praise-rows", String(Math.ceil(names.length / cols)));
  }

  function report() {
    onLayout?.(el.hidden ? 0 : el.offsetWidth);
  }

  /** Samla ihop flera ändringar (resize, typsnitt) till en anpassning per bildruta. */
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; fit(); });
  }

  // Storleken på omgivningen styr — observera föräldern, inte rutan själv
  // (rutans bredd ändras ju av anpassningen).
  let observed = null;
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  function observe() {
    const target = el.parentElement;
    if (!ro || !target || target === observed) return;
    if (observed) ro.unobserve(observed);
    ro.observe(target);
    observed = target;
  }
  const onWinResize = () => schedule();
  window.addEventListener("resize", onWinResize);
  document.fonts?.ready?.then(() => schedule());

  return {
    el,
    setNames(next, o) { observe(); setNames(next, o); },
    /** Anpassa om, t.ex. när maxWidth ändrats eller rutan visats. */
    fit() { observe(); fit(); },
    destroy() {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener("resize", onWinResize);
    },
  };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
