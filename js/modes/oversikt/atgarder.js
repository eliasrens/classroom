/**
 * ÖVERSIKT › KLASSÅTGÄRDER (issue #34, egen flik sedan issue #45).
 *
 * Lärarnas delade logg över arbetssätt de testat och hur det gick, med
 * lektionens klasstatistik bredvid. Här möts det som tidigare låg på två
 * ställen: Översiktens "senaste" (filter per lärare och kategori) och
 * Statistiks lista per vecka. Filtren: lärare, vecka (eller alla) och
 * kategori. Klassåtgärder följer inte måndagsrensningen.
 *
 * Delas med alla lärare — om klassen, ALDRIG om enskilda elever
 * (namnspärren sitter i dialogen, js/ui/class-actions.js).
 */

import { icon } from "../../lib/icons.js";
import { startOfWeek, inWeek, weekLabel, weekRangeLabel } from "../../lib/week.js";
import { mergedSubjects } from "../../lib/trafikljus-stats.js";
import { noteStatsPath } from "../elever/shared.js";
import { teacherOptions, teacherFilterFn, validTeacherFilter } from "../../lib/teacher-filter.js";
import {
  classActionsPath, classActionRepliesPath, categoryKey, categoryOptions, lessonIndex,
} from "../../lib/class-actions.js";
import { renderClassActionList, handleClassActionClick, addButton } from "../../ui/class-actions.js";
import { esc } from "./shared.js";

// Valen överlever byte av flik/läge under sessionen. week: "all" eller
// veckans start (ms) som sträng.
const ui = { teacher: "all", category: "all", week: "all" };

export function mountAtgarder(el, ctx) {
  const offs = [];

  if (!ctx.activeClass) {
    el.innerHTML = `
      <div class="mode-placeholder">
        <div class="mode-placeholder__icon">${icon("bulb", { size: 44, strokeWidth: 1.4 })}</div>
        <h1>Klassåtgärder</h1>
        <p>Välj en klass i topbaren för att se och dela klassåtgärder.</p>
      </div>`;
    return offs;
  }

  const { data } = ctx;
  const cid = ctx.activeClass.id;
  let actions = [];
  let replies = [];
  let noteStats = [];
  let sessions = [];
  let settingsDocs = [];

  /** Veckor med klassåtgärder (+ innevarande), nyast först, med antal. */
  function weekOptions() {
    const cur = startOfWeek();
    const counts = new Map([[cur, 0]]);
    for (const a of actions) {
      const ws = startOfWeek(a.createdAt ?? 0);
      counts.set(ws, (counts.get(ws) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[0] - a[0])
      .map(([ws, n]) => ({
        value: String(ws),
        name: `${ws === cur ? "Denna vecka" : weekLabel(ws)} · ${weekRangeLabel(ws)}${n ? ` · ${n} st` : ""}`,
      }));
  }

  function render() {
    const others = teacherOptions(actions);
    ui.teacher = validTeacherFilter(ui.teacher, others);
    const weeks = weekOptions();
    if (ui.week !== "all" && !weeks.some((w) => w.value === ui.week)) ui.week = "all";

    const tf = teacherFilterFn(ui.teacher);
    const byTeacher = tf ? actions.filter(tf) : actions;
    const byWeek = ui.week === "all" ? byTeacher : byTeacher.filter((a) => inWeek(a.createdAt ?? 0, Number(ui.week)));
    const cats = categoryOptions(byWeek);
    if (ui.category !== "all" && !cats.some((c) => c.value === ui.category)) ui.category = "all";
    const shown = ui.category === "all" ? byWeek : byWeek.filter((a) => categoryKey(a.category) === ui.category);
    const filtered = ui.teacher !== "all" || ui.week !== "all" || ui.category !== "all";

    const opt = (key, value, name) =>
      `<option value="${esc(value)}"${ui[key] === value ? " selected" : ""}>${esc(name)}</option>`;

    el.innerHTML = `
      <section class="ov-section ca-section teacher-only" aria-label="Klassåtgärder">
        <div class="ca-section__head">
          <h1 class="ov-section__title ov-section__title--page">${icon("bulb")} Klassåtgärder</h1>
          <select data-ca-teacher data-focus="teacher" aria-label="Lärare">
            ${opt("teacher", "all", "Alla lärare")}${opt("teacher", "mine", "Mina")}
            ${others.map((o) => opt("teacher", o.value, o.name)).join("")}
          </select>
          <select data-ca-week data-focus="week" aria-label="Vecka">
            ${opt("week", "all", "Alla veckor")}${weeks.map((w) => opt("week", w.value, w.name)).join("")}
          </select>
          ${cats.length ? `<select data-ca-cat data-focus="cat" aria-label="Kategori">
            ${opt("category", "all", "Alla kategorier")}${cats.map((c) => opt("category", c.value, c.name)).join("")}
          </select>` : ""}
          ${addButton()}
        </div>
        ${renderClassActionList(shown, {
          replies, index: lessonIndex(noteStats, sessions), subjects: mergedSubjects(settingsDocs),
          empty: actions.length
            ? `Inga klassåtgärder${filtered ? " för det här urvalet" : ""}.`
            : "Inga klassåtgärder ännu. Testade ni ett nytt arbetssätt? Dela hur det gick med de andra lärarna.",
        })}
        <p class="ov-week__foot">Delas med alla lärare — om klassen, aldrig om enskilda elever.
          Klassåtgärder rensas inte på måndagar.</p>
      </section>`;
  }

  // Omritning i microtask och med fokus bevarat (en annan lärare kan
  // spara något medan man står i en lista).
  let queued = false;
  function scheduleRender() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!el.isConnected) return;
      const focusKey = el.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
      render();
      if (focusKey) el.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus();
    });
  }

  el.addEventListener("click", (e) => { handleClassActionClick(e, { data, cid, actions, replies }); });
  el.addEventListener("change", (e) => {
    if (e.target.matches("[data-ca-teacher]")) ui.teacher = e.target.value;
    else if (e.target.matches("[data-ca-week]")) ui.week = e.target.value;
    else if (e.target.matches("[data-ca-cat]")) ui.category = e.target.value;
    else return;
    scheduleRender();
  });

  offs.push(data.watch(classActionsPath(cid), (docs) => { actions = docs; scheduleRender(); }));
  offs.push(data.watch(classActionRepliesPath(cid), (docs) => { replies = docs; scheduleRender(); }));
  offs.push(data.watch(noteStatsPath(cid), (docs) => { noteStats = docs; scheduleRender(); }));
  offs.push(data.watch(`classes/${cid}/sessions`, (docs) => { sessions = docs; scheduleRender(); }));
  offs.push(data.watch(`classes/${cid}/settings`, (docs) => { settingsDocs = docs; scheduleRender(); }));

  render();
  return offs;
}
