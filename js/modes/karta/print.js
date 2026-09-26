/**
 * TANKEKARTA — utskrift (issue #53). ENDAST LÄRARVY.
 *
 * Webbläsarens egen utskrift (window.print(), där "Spara som PDF" också
 * finns) — inget bibliotek, inget nätverk: bubblorna kan innehålla
 * elevnamn och lämnar aldrig datorn.
 *
 * Papper: A3 liggande (standard), A3 stående, A4 liggande, A4 stående.
 * Kartan räknas om till papperets yta (samma scen som på skärmen,
 * js/modes/karta/scene.js, med papperets bildformat) — ingen bubbla kan
 * hamna utanför sidan.
 *
 * Marginalerna (som Skrivtavlan, issue #55): @page har marginal 0 och
 * arket är en EGEN box, en aning mindre än papperet (så att avrundning
 * aldrig ger en tom extrasida), med 15 mm VIT padding runt om. Det blir
 * alltså alltid vitt runt kartan, vad läraren än väljer under "Marginaler"
 * i utskriftsdialogen ("Standard", "Minimum", "Inga").
 *
 * Färgerna skrivs ut (print-color-adjust: exact). Inget UI följer med —
 * bara ett litet sidhuvud (klass, datum) och kartan med sin rubrik.
 */

import { createScene } from "./scene.js";

/** Papperen. w × h = arket i mm (en aning under papperet, se ovan). */
export const PAPERS = [
  { id: "a3-landscape", label: "A3 liggande", size: "A3 landscape", orientation: "landscape", w: 419, h: 296.5 },
  { id: "a3-portrait", label: "A3 stående", size: "A3 portrait", orientation: "portrait", w: 296.5, h: 419 },
  { id: "a4-landscape", label: "A4 liggande", size: "A4 landscape", orientation: "landscape", w: 296.5, h: 209 },
  { id: "a4-portrait", label: "A4 stående", size: "A4 portrait", orientation: "portrait", w: 209, h: 296.5 },
];
export const DEFAULT_PAPER = "a3-landscape";
export const isPaper = (id) => PAPERS.some((p) => p.id === id);
const paperOf = (id) => PAPERS.find((p) => p.id === id) ?? PAPERS[0];

const PAD_MM = 15;
const MM = 96 / 25.4; // CSS-px per mm

let current = null; // { root, pageStyle, scene, onAfter, prevTitle }

/** Ta bort arket och återställ sidan (efter utskrift, eller vid unmount). */
export function closeKartaPrint() {
  if (!current) return;
  window.removeEventListener("afterprint", current.onAfter);
  current.scene?.destroy();
  current.root.remove();
  current.pageStyle.remove();
  document.documentElement.classList.remove("kt-printing");
  document.body.classList.remove("kt-printing");
  document.title = current.prevTitle;
  current = null;
}

const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const longDate = (d) => d.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Bygg arket (synkront) för map = { title, bubbles } på valt papper.
 * @returns {HTMLElement} arkets rot
 */
export function buildKartaPrint({ map, className, paper }) {
  closeKartaPrint();
  const p = paperOf(paper);
  const root = el("div", "kt-print teacher-only");
  root.setAttribute("aria-hidden", "true");
  const sheet = el("section", "kt-print__sheet");
  sheet.style.width = `${p.w}mm`;
  sheet.style.height = `${p.h}mm`;
  sheet.style.padding = `${PAD_MM}mm`;
  const head = el("div", "kt-print__head");
  head.append(el("strong", "kt-print__class", className || ""), el("span", "kt-print__date", longDate(new Date())));
  const area = el("div", "kt-print__area kt-stage theme-student");
  sheet.append(head, area);
  root.append(sheet);
  document.body.append(root);

  // Utskriftens sidstorlek, sist i <head> så att den vinner över appens
  // övriga @page (rapport.css har 12 mm marginal — då skulle arket krympas).
  const pageStyle = el("style", null, `@page { size: ${p.size}; margin: 0; }`);
  document.head.append(pageStyle);
  const onAfter = () => closeKartaPrint();
  current = { root, pageStyle, scene: null, onAfter, prevTitle: document.title }; // städas även vid fel

  // Kartans yta = arket innanför paddingen, minus sidhuvudet.
  const innerW = (p.w - 2 * PAD_MM) * MM;
  const innerH = (p.h - 2 * PAD_MM) * MM;
  const headH = head.getBoundingClientRect().height + parseFloat(getComputedStyle(head).marginBottom || "0");
  const width = Math.floor(innerW);
  const height = Math.floor(innerH - headH);
  area.style.width = `${width}px`;
  area.style.height = `${height}px`;
  const scene = createScene(area, { animate: false, width, height });
  current.scene = scene;
  scene.render(map, { animate: false });

  // Dokumenttiteln = PDF:ens förslag på filnamn.
  const name = (map?.title || "").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 40);
  document.title = `Tankekarta ${className || ""} ${name} ${isoDate(new Date())}`.replace(/\s+/g, " ").trim();
  document.documentElement.classList.add("kt-printing");
  document.body.classList.add("kt-printing");
  window.addEventListener("afterprint", onAfter);
  return root;
}

/** Bygg arket och öppna webbläsarens utskrift. */
export async function printKarta(opts) {
  buildKartaPrint(opts);
  window.print();
}

/** Har utskriften redan ett ark (t.ex. byggt innan Ctrl+P)? */
export const hasKartaPrint = () => current !== null;
