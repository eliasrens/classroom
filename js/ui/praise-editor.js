/**
 * "BRA JOBBAT"-REDIGERAREN — elevkryssrutor, fritext med +-knapp och
 * "Töm Bra jobbat" (issue #112).
 *
 * Används av Morgonskärmens panel och Lektionsplaneringens fält "Visa
 * Bra jobbat" — samma LOKALA lista (classes/{id}/praise → "board",
 * elevdata, aldrig i molnet). Vad knapparna gör med listan ligger i
 * js/lib/praise-edit.js; SPARANDET gör vyn via `edit` (Morgonskärmen
 * sparar sitt sammanslagna tillstånd, Lektionen bara listan).
 *
 * Markupen är tre syskon (lista, fritextrad, töm-knapp) — värden lägger
 * dem där de ska stå och monterar sedan på en förälder:
 *
 *   parent.innerHTML = praiseEditorHTML();
 *   const editor = mountPraiseEditor(parent, { edit, onAdded });
 *   editor.setStudents(students);   // vid ändrad elevlista
 *   editor.setPraise(currentPraise); // vid ändrad Bra jobbat-lista
 *   editor.destroy();
 */

import { icon } from "../lib/icons.js";
import { studentLabel } from "../lib/names.js";
import { hasPraiseStudent, togglePraiseStudent, addPraiseFree } from "../lib/praise-edit.js";

export const PRAISE_EMPTY_STUDENTS = "Inga elever i klassen ännu — lägg till dem i Elevlista, eller skriv fritext nedan.";

export function praiseEditorHTML() {
  return `
        <div class="praise-editor__students" role="group" aria-label="Elever"></div>
        <div class="praise-editor__add">
          <input class="praise-editor__free" type="text" placeholder="Fritext, t.ex. hela bordsgrupp 3…" autocomplete="off" aria-label="Fritext till Bra jobbat">
          <button class="btn btn--icon praise-editor__free-btn" title="Lägg till" aria-label="Lägg till fritext">${icon("plus")}</button>
        </div>
        <button class="btn btn--ghost praise-editor__clear">${icon("trash")}<span>Töm Bra jobbat</span></button>`;
}

/**
 * @param {Element}  root  förälder som innehåller praiseEditorHTML()
 * @param {object}   opts
 * @param {Function} opts.edit     (fn) => Promise — kör fn(next) på ett färskt
 *                                 tillstånd och spara (se editPraise i praise-edit.js)
 * @param {Function} [opts.onAdded] (next) => void när ett namn LAGTS TILL (inte
 *                                 kryssats ur/tömts) — t.ex. visa tavlan
 */
export function mountPraiseEditor(root, { edit, onAdded = () => {} }) {
  const list = root.querySelector(".praise-editor__students");
  const free = root.querySelector(".praise-editor__free");
  let students = [];
  let praise = [];

  const onChange = (e) => {
    const cb = e.target.closest("input[data-student]");
    if (!cb) return;
    const id = cb.dataset.student;
    void edit((next) => {
      const r = togglePraiseStudent(next.praise, id);
      next.praise = r.praise;
      if (r.added) onAdded(next);
    });
  };
  const addFree = () => {
    const text = free.value.trim();
    if (!text) return;
    free.value = "";
    void edit((next) => {
      next.praise = addPraiseFree(next.praise, text);
      onAdded(next);
    });
    free.focus();
  };
  const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); addFree(); } };
  const clear = () => edit((next) => { next.praise = []; });
  const onClear = () => void clear();

  const addBtn = root.querySelector(".praise-editor__free-btn");
  const clearBtn = root.querySelector(".praise-editor__clear");
  list.addEventListener("change", onChange);
  addBtn.addEventListener("click", addFree);
  free.addEventListener("keydown", onKey);
  clearBtn.addEventListener("click", onClear);

  function syncChecks() {
    list.querySelectorAll("input[data-student]").forEach((cb) => {
      cb.checked = hasPraiseStudent(praise, cb.dataset.student);
    });
  }
  function renderStudents() {
    if (!list.isConnected) return;
    if (!students.length) {
      list.innerHTML = `<p class="praise-editor__empty">${PRAISE_EMPTY_STUDENTS}</p>`;
      return;
    }
    list.innerHTML = students.map((s) => `
          <label class="praise-editor__student">
            <input type="checkbox" data-student="${esc(s.id)}">
            <span>${esc(studentLabel(s))}</span>
          </label>`).join("");
    syncChecks();
  }

  return {
    /** Aktiva elever; sorteras på förnamn som på Morgonskärmen. */
    setStudents(next) {
      students = [...(next ?? [])].sort((a, b) => String(a.firstName).localeCompare(String(b.firstName), "sv"));
      renderStudents();
    },
    /** Listan som visas NU (currentPraise — tom om den hör till förra veckan). */
    setPraise(next) {
      praise = next ?? [];
      syncChecks();
    },
    clear,
    destroy() {
      list.removeEventListener("change", onChange);
      addBtn.removeEventListener("click", addFree);
      free.removeEventListener("keydown", onKey);
      clearBtn.removeEventListener("click", onClear);
    },
  };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
