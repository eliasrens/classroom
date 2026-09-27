/**
 * "VÄLJ MINA KLASSER" — dialog (issue #102, samma mönster som Mina ämnen #81).
 *
 * En kryssruta per klass, sorterad på namn. Sparar lärarens PRIVATA val
 * (teachers/{uid}/settings/classes → mine, js/lib/my-classes.js).
 *
 * Inget ikryssat = inget val → alla klasser visas (standardläget).
 * Nås från klassväljaren i topbaren och från Översikt › Inställningar.
 */

import { icon } from "../lib/icons.js";
import { saveMyClasses } from "../lib/my-classes.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let current = null;

export function closeMyClassesDialog() {
  if (!current) return;
  window.removeEventListener("keydown", current.onKey, true);
  current.root.remove();
  const { resolve: done, opener } = current;
  current = null;
  // Tillbaka till knappen/väljaren som öppnade dialogen (om den finns kvar).
  if (opener?.isConnected) opener.focus?.();
  done?.();
}

/**
 * openMyClassesDialog({ data, classes, mine })
 *  classes: alla klasser ({ id, name }).
 *  mine: lärarens nuvarande val ([id, …] eller null = inget val).
 * Sparar via js/lib/my-classes.js. Promise löses när dialogen stängts.
 */
export function openMyClassesDialog({ data, classes, mine = null }) {
  closeMyClassesDialog();
  const opener = document.activeElement;
  const chosen = new Set(mine ?? []);
  const sorted = [...classes].sort((a, b) => String(a.name).localeCompare(String(b.name), "sv"));

  const root = document.createElement("div");
  root.className = "ms-modal mc-modal teacher-only";
  root.innerHTML = `
    <form class="ms-dialog" role="dialog" aria-modal="true" aria-labelledby="mc-dialog-title" novalidate>
      <h2 id="mc-dialog-title">${icon("check")} Välj mina klasser</h2>
      <p class="ms-lead">Kryssa i klasserna du undervisar i — klassväljaren visar
        sedan bara dem. Inget ikryssat = alla klasser visas.</p>
      <div class="ms-list">${sorted.length
        ? sorted.map((c) => `<label class="ms-row">
            <input type="checkbox" data-class-id="${esc(c.id)}" ${chosen.has(c.id) ? "checked" : ""}>
            <span>${esc(c.name)}</span>
          </label>`).join("")
        : `<p class="ms-lead">Inga klasser ännu.</p>`}</div>
      <p class="ms-count" aria-live="polite"></p>
      <div class="ms-actions">
        <button class="btn" type="button" data-cancel>Avbryt</button>
        <button class="btn btn--primary" type="submit">${icon("save")}<span>Spara</span></button>
      </div>
    </form>`;
  document.body.append(root);

  const form = root.querySelector("form");
  const boxes = () => [...form.querySelectorAll("[data-class-id]")];
  const countEl = form.querySelector(".ms-count");
  const updateCount = () => {
    const n = boxes().filter((b) => b.checked).length;
    countEl.textContent = n === 0
      ? "Inget valt — alla klasser visas."
      : `${n} ${n === 1 ? "klass vald" : "klasser valda"}.`;
  };
  updateCount();

  // Dialogen äger tangenterna (samma mönster som Mina ämnen): lägenas
  // genvägar får inte slå igenom medan läraren kryssar.
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeMyClassesDialog(); return; }
    if (root.contains(e.target)) e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  root.addEventListener("mousedown", (e) => { if (e.target === root) closeMyClassesDialog(); });

  form.addEventListener("change", updateCount);
  form.querySelector("[data-cancel]").addEventListener("click", closeMyClassesDialog);

  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    try {
      // Bara klasser som finns sparas — borttagna klasser städas bort här.
      // Inget ikryssat betyder "inget val" (alla visas).
      await saveMyClasses(data, boxes().filter((b) => b.checked).map((b) => b.dataset.classId));
      closeMyClassesDialog();
    } catch (err) {
      busy = false;
      console.warn("[mina klasser] kunde inte spara:", err);
    }
  });

  (boxes()[0] ?? form.querySelector("[type=submit]")).focus();
  return new Promise((resolve) => { current = { root, onKey, resolve, opener }; });
}
