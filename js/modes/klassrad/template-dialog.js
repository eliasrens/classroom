/**
 * "REDIGERA MALL…" — klassrådets mall (issue #125). Samma modal-mönster
 * som Mina ämnen och Klasser (css/ui/my-subjects.css → .ms-*).
 *
 * En rad per punkt: ikon (klick byter), rubrik, hjälpfrågor (en per rad)
 * och anteckningsfältets rubrik, plus Numrerad, ↑ ↓ och Ta bort.
 * "+ Lägg till punkt" och "Återställ standardmall" (med bekräftelse).
 * Spara lämnar mallen till anroparen (js/modes/klassrad.js), som sparar den
 * PRIVAT per lärare (teachers/{uid}/settings/klassrad). Mallen påverkar bara
 * NYA klassråd — ett påbörjat möte behåller sina punkter.
 */

import { icon } from "../../lib/icons.js";
import {
  defaultTemplate, normalizeTemplate, newPointId, POINT_ICONS, DEFAULT_NOTES_LABEL,
  MAX_POINTS, MAX_PROMPTS, MAX_TITLE, MAX_PROMPT, MAX_LABEL,
} from "../../lib/klassrad.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const ROLE_NOTES = {
  previous: "Här visas automatiskt det som skrevs under Till nästa klassråd och Till elevrådet förra gången.",
  council: "Följs upp på nästa klassråd.",
  followup: "Följs upp på nästa klassråd.",
};

let current = null;

export function closeTemplateDialog() {
  if (!current) return;
  window.removeEventListener("keydown", current.onKey, true);
  current.root.remove();
  const done = current.resolve;
  current = null;
  done?.();
}

function rowHTML(p, i, n) {
  return `<li class="krt-row" data-row="${i}">
    <button type="button" class="btn btn--ghost btn--icon krt-icon" data-icon title="Byt ikon" aria-label="Byt ikon för punkten">${icon(p.icon, { size: 22 })}</button>
    <div class="krt-fields">
      <label class="krt-field"><span>Rubrik</span>
        <input type="text" data-f="title" maxlength="${MAX_TITLE}" value="${esc(p.title)}" autocomplete="off" placeholder="t.ex. Vi startar"></label>
      <label class="krt-field"><span>Hjälpfrågor <em>(en per rad)</em></span>
        <textarea data-f="prompts" rows="${Math.max(1, Math.min(4, p.prompts.length || 1))}" maxlength="${MAX_PROMPTS * (MAX_PROMPT + 1)}">${esc(p.prompts.join("\n"))}</textarea></label>
      <div class="krt-line">
        <label class="krt-field krt-field--label"><span>Anteckningsfältets rubrik</span>
          <input type="text" data-f="notesLabel" maxlength="${MAX_LABEL}" value="${esc(p.notesLabel)}" autocomplete="off" placeholder="${DEFAULT_NOTES_LABEL}"></label>
        <label class="krt-check"><input type="checkbox" data-f="numbered" ${p.numbered ? "checked" : ""}> Numrerad</label>
      </div>
      ${p.role ? `<p class="krt-role">${esc(ROLE_NOTES[p.role])}</p>` : ""}
    </div>
    <div class="krt-tools">
      <button type="button" class="btn btn--ghost btn--icon" data-move="-1" ${i === 0 ? "disabled" : ""} title="Flytta upp" aria-label="Flytta upp">${icon("chevron-up")}</button>
      <button type="button" class="btn btn--ghost btn--icon" data-move="1" ${i === n - 1 ? "disabled" : ""} title="Flytta ned" aria-label="Flytta ned">${icon("chevron-down")}</button>
      <button type="button" class="btn btn--ghost btn--icon" data-remove ${n <= 1 ? "disabled" : ""} title="Ta bort punkten" aria-label="Ta bort punkten">${icon("trash")}</button>
    </div>
  </li>`;
}

/**
 * openTemplateDialog({ template, onSave })
 *  template: nuvarande mall ({ points }), onSave(mall) när läraren sparar.
 * Promise löses när dialogen stängts.
 */
export function openTemplateDialog({ template, onSave }) {
  closeTemplateDialog();
  let points = normalizeTemplate(template).points.map((p) => ({ ...p, prompts: [...p.prompts] }));

  const root = document.createElement("div");
  root.className = "ms-modal kr-modal teacher-only";
  root.innerHTML = `
    <form class="ms-dialog krt-dialog" role="dialog" aria-modal="true" aria-labelledby="krt-title" novalidate>
      <h2 id="krt-title">${icon("pencil")} Klassrådets mall</h2>
      <p class="ms-lead">Punkterna i ett nytt klassråd. Ändringar gäller nya klassråd — ett påbörjat
        behåller sina punkter, så gamla protokoll ändras aldrig. Mallen sparas bara för dig.</p>
      <ol class="krt-list"></ol>
      <div class="krt-foot">
        <button type="button" class="btn btn--ghost" data-add>${icon("plus")}<span>Lägg till punkt</span></button>
        <span class="krt-reset">
          <button type="button" class="btn btn--ghost" data-reset>${icon("reset")}<span>Återställ standardmall</span></button>
          <span class="krt-confirm" role="group" aria-label="Bekräfta återställning" hidden>
            <span>Ersätta med standardmallen?</span>
            <button type="button" class="btn" data-reset-yes>Återställ</button>
            <button type="button" class="btn btn--ghost" data-reset-no>Avbryt</button>
          </span>
        </span>
      </div>
      <p class="ms-count krt-msg" aria-live="polite"></p>
      <div class="ms-actions">
        <button class="btn" type="button" data-cancel>Avbryt</button>
        <button class="btn btn--primary" type="submit">${icon("save")}<span>Spara</span></button>
      </div>
    </form>`;
  document.body.append(root);

  const form = root.querySelector("form");
  const list = form.querySelector(".krt-list");
  const msg = form.querySelector(".krt-msg");
  const addBtn = form.querySelector("[data-add]");
  const resetBtn = form.querySelector("[data-reset]");
  const resetConfirm = form.querySelector(".krt-confirm");

  /** Läs fälten in i `points` (innan något ritas om). */
  function readRows() {
    for (const row of list.querySelectorAll(".krt-row")) {
      const p = points[Number(row.dataset.row)];
      if (!p) continue;
      p.title = row.querySelector('[data-f="title"]').value;
      p.prompts = row.querySelector('[data-f="prompts"]').value.split("\n");
      p.notesLabel = row.querySelector('[data-f="notesLabel"]').value;
      p.numbered = row.querySelector('[data-f="numbered"]').checked;
    }
  }

  function draw(focus = null) {
    list.innerHTML = points.map((p, i) => rowHTML(p, i, points.length)).join("");
    addBtn.disabled = points.length >= MAX_POINTS;
    msg.textContent = `${points.length} ${points.length === 1 ? "punkt" : "punkter"}.`;
    if (focus) list.querySelector(focus)?.focus();
  }
  draw();

  // Dialogen äger tangenterna (samma mönster som Mina ämnen): lägets
  // genvägar (PageUp/PageDown, F …) får inte slå igenom medan läraren skriver.
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeTemplateDialog(); return; }
    if (root.contains(e.target)) e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  root.addEventListener("mousedown", (e) => { if (e.target === root) closeTemplateDialog(); });

  form.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.type === "submit") return;
    const row = b.closest(".krt-row");
    const i = row ? Number(row.dataset.row) : -1;
    if (b.hasAttribute("data-cancel")) { closeTemplateDialog(); return; }
    readRows();
    if (b.hasAttribute("data-icon")) {
      const p = points[i];
      p.icon = POINT_ICONS[(POINT_ICONS.indexOf(p.icon) + 1) % POINT_ICONS.length];
      draw(`[data-row="${i}"] [data-icon]`);
    } else if (b.dataset.move) {
      const j = i + Number(b.dataset.move);
      if (j < 0 || j >= points.length) return;
      [points[i], points[j]] = [points[j], points[i]];
      draw(`[data-row="${j}"] [data-move="${b.dataset.move}"]:not([disabled])`);
    } else if (b.hasAttribute("data-remove")) {
      if (points.length <= 1) return;
      points.splice(i, 1);
      draw();
    } else if (b.hasAttribute("data-add")) {
      if (points.length >= MAX_POINTS) return;
      // Före "Till nästa klassråd" om den står sist — annars sist.
      const at = points.at(-1)?.role === "followup" ? points.length - 1 : points.length;
      points.splice(at, 0, { id: newPointId(), title: "", prompts: [], notesLabel: DEFAULT_NOTES_LABEL, icon: "chat", numbered: true, role: null });
      draw(`[data-row="${at}"] [data-f="title"]`);
    } else if (b.hasAttribute("data-reset")) {
      resetBtn.hidden = true;
      resetConfirm.hidden = false;
      resetConfirm.querySelector("[data-reset-yes]").focus();
    } else if (b.hasAttribute("data-reset-yes")) {
      points = defaultTemplate().points;
      resetConfirm.hidden = true;
      resetBtn.hidden = false;
      draw();
      msg.textContent = "Standardmallen är tillbaka — tryck Spara för att använda den.";
    } else if (b.hasAttribute("data-reset-no")) {
      resetConfirm.hidden = true;
      resetBtn.hidden = false;
      resetBtn.focus();
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    readRows();
    const named = points.filter((p) => p.title.trim());
    if (!named.length) {
      msg.textContent = "Mallen behöver minst en punkt med rubrik.";
      list.querySelector('[data-f="title"]')?.focus();
      return;
    }
    const next = normalizeTemplate({ points: named });
    try { onSave?.(next); } catch (err) { console.warn("[klassråd] kunde inte spara mallen:", err); }
    closeTemplateDialog();
  });

  return new Promise((resolve) => { current = { root, onKey, resolve }; });
}
