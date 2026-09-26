/**
 * "VÄLJ MINA ÄMNEN" — dialog (issue #81).
 *
 * Kryssrutor för alla ämnen (inbyggda + klassens egna), grupperade som
 * skolans schema: SO-ämnena under rubriken "SO-ämnen" med knappen
 * "Alla SO", NO-ämnena likadant. Sparar lärarens PRIVATA val
 * (teachers/{uid}/settings/subjects → mine, js/lib/my-subjects.js).
 *
 * Inget ikryssat = inget val → alla ämnen visas (standardläget).
 * Nås från ämnesväljaren i lektionsplaneringen och från
 * Översikt › Inställningar.
 */

import { icon } from "../lib/icons.js";
import { groupedSubjects, SUBJECT_GROUPS } from "../lib/color.js";
import { myIds, saveMine } from "../lib/my-subjects.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let current = null;

export function closeMySubjectsDialog() {
  if (!current) return;
  window.removeEventListener("keydown", current.onKey, true);
  current.root.remove();
  const done = current.resolve;
  current = null;
  done?.();
}

function rowHTML(s, checked) {
  return `<label class="ms-row">
    <input type="checkbox" data-subject="${esc(s.id)}" ${checked ? "checked" : ""}>
    <span class="ms-dot" style="background:${esc(s.color ?? "#d7d3cb")}"></span>
    <span>${esc(s.name)}</span>
  </label>`;
}

/**
 * openMySubjectsDialog({ data, subjects, mine })
 *  subjects: hela ämneslistan (inbyggda + ev. egna, se mergedSubjects).
 *  mine: lärarens nuvarande val ([id, …] eller null = inget val).
 * Sparar via js/lib/my-subjects.js. Promise löses när dialogen stängts.
 */
export function openMySubjectsDialog({ data, subjects, mine = null }) {
  closeMySubjectsDialog();
  const chosen = new Set(mine ?? []);

  const groups = groupedSubjects(subjects);
  const body = groups.map((g) => {
    if (!g.group) return g.subjects.map((s) => rowHTML(s, chosen.has(s.id))).join("");
    const label = SUBJECT_GROUPS.find((x) => x.id === g.group.id)?.name ?? g.group.name;
    return `<fieldset class="ms-group" data-group="${esc(g.group.id)}">
      <legend>${esc(label)}
        <button type="button" class="btn btn--ghost ms-group__all" data-group-all="${esc(g.group.id)}">Alla ${esc(g.group.id.toUpperCase())}</button>
      </legend>
      ${g.subjects.map((s) => rowHTML(s, chosen.has(s.id))).join("")}
    </fieldset>`;
  }).join("");

  const root = document.createElement("div");
  root.className = "ms-modal teacher-only";
  root.innerHTML = `
    <form class="ms-dialog" role="dialog" aria-modal="true" aria-labelledby="ms-dialog-title" novalidate>
      <h2 id="ms-dialog-title">${icon("check")} Välj mina ämnen</h2>
      <p class="ms-lead">Kryssa i ämnena du undervisar i — ämnesväljaren och ämnesfiltret
        visar sedan bara dem. Inget ikryssat = alla ämnen visas.</p>
      <div class="ms-list">${body}</div>
      <p class="ms-count" aria-live="polite"></p>
      <div class="ms-actions">
        <button class="btn" type="button" data-cancel>Avbryt</button>
        <button class="btn btn--primary" type="submit">${icon("save")}<span>Spara</span></button>
      </div>
    </form>`;
  document.body.append(root);

  const form = root.querySelector("form");
  const boxes = () => [...form.querySelectorAll("[data-subject]")];
  const countEl = form.querySelector(".ms-count");
  const updateCount = () => {
    const n = boxes().filter((b) => b.checked).length;
    countEl.textContent = n === 0
      ? "Inget valt — alla ämnen visas."
      : `${n} ${n === 1 ? "ämne valt" : "ämnen valda"}.`;
  };
  updateCount();

  // Dialogen äger tangenterna (samma mönster som klassåtgärdsdialogen):
  // lägenas genvägar får inte slå igenom medan läraren kryssar.
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeMySubjectsDialog(); return; }
    if (root.contains(e.target)) e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  root.addEventListener("mousedown", (e) => { if (e.target === root) closeMySubjectsDialog(); });

  form.addEventListener("change", updateCount);
  form.addEventListener("click", (e) => {
    const groupId = e.target.closest("[data-group-all]")?.dataset.groupAll;
    if (groupId) {
      const inGroup = [...form.querySelectorAll(`[data-group="${groupId}"] [data-subject]`)];
      const allOn = inGroup.every((b) => b.checked);
      for (const b of inGroup) b.checked = !allOn;
      updateCount();
    }
  });
  form.querySelector("[data-cancel]").addEventListener("click", closeMySubjectsDialog);

  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    try {
      await saveMine(data, boxes().filter((b) => b.checked).map((b) => b.dataset.subject));
      closeMySubjectsDialog();
    } catch (err) {
      busy = false;
      console.warn("[mina ämnen] kunde inte spara:", err);
    }
  });

  return new Promise((resolve) => { current = { root, onKey, resolve }; });
}

/** Nuvarande val ur settingsdokumenten — bekvämt för anroparna. */
export { myIds };
