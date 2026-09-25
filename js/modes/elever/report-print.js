/**
 * ELEVRAPPORTER — utskrift/PDF (issue #33). ENDAST LÄRARVY.
 *
 * Visar rapporten som ett A4-ark ovanpå lärarvyn och skriver ut via
 * webbläsarens egen utskrift (där PDF väljs som skrivare). Under
 * utskriften döljs allt annat (css/modes/rapport.css → body.rp-printing).
 *
 * Utskriften/PDF:en är OKRYPTERAD — den är bara till för att föra över
 * uppföljningar till skolans dokumentationssystem. Varningen står både i
 * verktygsraden och överst på själva arket.
 *
 * Lagret ligger utanför lägets element och märks .teacher-only; det
 * stängs vid Esc, med Stäng, när fliken byts och när läget lämnas.
 */

import { icon } from "../../lib/icons.js";

let current = null; // { root, onKey, prevTitle }

export function closePrintView() {
  if (!current) return;
  window.removeEventListener("keydown", current.onKey, true);
  current.root.remove();
  document.body.classList.remove("rp-printing");
  document.title = current.prevTitle;
  current = null;
}

/**
 * Öppna förhandsvisningen. onPrint anropas när läraren väljer Skriv ut.
 * title blir dokumenttiteln under tiden = PDF:ens förslag på filnamn —
 * ge den därför UTAN elevnamn (t.ex. "Elevrapport 4A v.38").
 */
export function openPrintView({ title, html, onPrint = null }) {
  closePrintView();
  const root = document.createElement("div");
  root.className = "rp-print teacher-only";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Utskrift");
  root.innerHTML = `
    <div class="rp-print__bar">
      <p class="rp-print__warn">${icon("shield")}<span><strong>Utskriften/PDF:en är okrypterad — spara den inte löst på datorn.</strong>
        Den är till för att föra över uppföljningar till skolans dokumentationssystem.</span></p>
      <div class="rp-print__actions">
        <button class="btn btn--primary" data-rp-print>${icon("printer")}Skriv ut / spara som PDF</button>
        <button class="btn" data-rp-close>${icon("x")}Stäng</button>
      </div>
    </div>
    <div class="rp-print__paper">
      <div class="rp-doc">${html}</div>
    </div>`;
  document.body.append(root);
  document.body.classList.add("rp-printing");
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePrintView(); }
  };
  window.addEventListener("keydown", onKey, true);
  current = { root, onKey, prevTitle: document.title };
  document.title = title;
  root.querySelector("[data-rp-close]").addEventListener("click", closePrintView);
  root.querySelector("[data-rp-print]").addEventListener("click", () => {
    try { onPrint?.(); } catch (err) { console.warn("[rapport] onPrint:", err); }
    window.print();
  });
  root.querySelector("[data-rp-print]").focus();
}
