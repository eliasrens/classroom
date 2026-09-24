/**
 * STATISTIK — veckoarkivet (issue #29). ENDAST LÄRARVY.
 *
 * Veckorytmen gör de andra vyerna rena varje måndag (de filtrerar på
 * innevarande vecka). Här finns alla veckor: välj "Denna vecka" eller en
 * tidigare vecka och se
 *   - trafikljuspass per typ (övergång / datorer) med lärare och lektion,
 *     veckoresultat (snitt, bästa, total), om veckomålet nåddes och en
 *     trendrad över de senaste veckorna (issue #35, js/lib/week-goal.js),
 *   - noteringar och elevstatistik per elev (alfabetiskt — aldrig rangordnat),
 *   - veckans Bra jobbat (ögonblicksbilden i praiseArchive, se week-rhythm.js).
 * Filter per lärare: Alla, Mina eller en viss lärare. Allt är delat mellan
 * lärarna — samma data (Firestore) och därmed samma arkiv för alla.
 *
 * Prestanda: samlingarna speglas redan lokalt av datalagret (en lyssnare
 * per samling och session); veckan filtreras på klienten. Ingenting här
 * läser om hela samlingen från servern.
 *
 * INTEGRITETSSPÄRR: står inte i STUDENT_MODE_IDS, så routern monterar det
 * aldrig på elevskärmen — och skulle det ändå ske renderas en neutral
 * skärm utan att ett enda elev- eller noteringsdokument läses.
 */

import { icon } from "../lib/icons.js";
import { studentLabel } from "../lib/names.js";
import {
  startOfWeek, addWeeks, inWeek, weekKey, weekStartFromKey, weekLabel, weekRangeLabel,
} from "../lib/week.js";
import {
  KINDS, KIND_KEYS, computeStats, sessionTime, fmtMMSS, fmtWhen, lessonLabel, mergedSubjects,
} from "../lib/trafikljus-stats.js";
import { teacherOptions, teacherFilterFn, validTeacherFilter } from "../lib/teacher-filter.js";
import { GOAL_METRICS, normalizeGoalSettings, weekGoalStatus, goalTrend, fmtSec } from "../lib/week-goal.js";
import { MORNING_KEY, normalize as normalizeMorning, currentPraise } from "../lib/morning.js";
import { praiseArchivePath } from "../lib/week-rhythm.js";
import { escapeHtml, noteTypeById, teacherLabel } from "./elever/shared.js";

const PASS_PAGE = 10; // pass per typ innan "Visa alla"

// Valen överlever byte av läge under sessionen. weekStart null = "Denna
// vecka" — följer alltså med när en ny vecka börjar.
const ui = { weekStart: null, teacher: "all", openStudent: null, allPasses: new Set() };

export default {
  id: "statistik",
  title: "Statistik",
  icon: "chart",

  async mount(el, ctx) {
    const offs = [];
    this._offs = offs; // städning registreras innan något startas

    if (ctx.view !== "teacher") {
      el.innerHTML = `
        <div class="mode-placeholder">
          <h1>Klassrumsverktyget</h1>
          <p>Statistiken finns bara på lärarens skärm.</p>
        </div>`;
      return;
    }
    if (!ctx.activeClass) {
      el.innerHTML = `
        <div class="mode-placeholder">
          <div class="mode-placeholder__icon">${icon("chart", { size: 44, strokeWidth: 1.4 })}</div>
          <h1>Statistik</h1>
          <p>Välj en klass i topbaren för att se veckans statistik och tidigare veckor.</p>
        </div>`;
      return;
    }

    const { data } = ctx;
    const cid = ctx.activeClass.id;
    let sessions = [];
    let notes = [];
    let students = [];
    let archive = [];
    let settingsDocs = [];
    let subjects = mergedSubjects([]);
    let initials = false;
    let morning = normalizeMorning(null);
    let goalCfg = normalizeGoalSettings(null);

    el.innerHTML = `<div class="stat"></div>`;
    const root = el.querySelector(".stat");

    // ---- Härledningar ----

    const trafikljus = () => sessions.filter((s) => s.type === "trafikljus" && s.result);
    const currentWeek = () => startOfWeek();
    const selectedWeek = () => {
      const cur = currentWeek();
      return ui.weekStart == null || ui.weekStart >= cur ? cur : ui.weekStart;
    };

    /** Veckor med data (+ innevarande och vald), nyast först, med antal poster. */
    function weekIndex(selected) {
      const cur = currentWeek();
      const counts = new Map([[cur, 0], [selected, 0]]);
      const bump = (ws, n = 1) => { if (ws != null && ws <= cur) counts.set(ws, (counts.get(ws) ?? 0) + n); };
      for (const s of trafikljus()) bump(startOfWeek(sessionTime(s)));
      for (const n of notes) if (n.createdAt) bump(startOfWeek(n.createdAt));
      for (const a of archive) bump(weekStartFromKey(a.weekOf ?? a.id), 0);
      return [...counts].sort((a, b) => b[0] - a[0]);
    }

    /** Veckans Bra jobbat: nuvarande lista, eller arkivets ögonblicksbild. */
    function praiseFor(ws) {
      if (ws === currentWeek()) return currentPraise(morning);
      const key = weekKey(ws);
      const snap = archive.find((a) => (a.weekOf ?? a.id) === key);
      if (snap) return normalizeMorning({ praise: snap.praise }).praise;
      // Ännu inte arkiverad (ingen har öppnat appen sedan veckoskiftet).
      return morning.weekOf === key ? morning.praise : [];
    }

    const praiseName = (p) => {
      if (p.kind === "free") return p.text;
      const s = students.find((x) => x.id === p.studentId);
      return s ? studentLabel(s, { initials }) : null;
    };

    // ---- Rendering ----

    function render() {
      const cur = currentWeek();
      const ws = selectedWeek();
      const weeks = weekIndex(ws);
      const oldest = weeks[weeks.length - 1][0];
      const others = teacherOptions([...trafikljus(), ...notes]);
      ui.teacher = validTeacherFilter(ui.teacher, others);
      const filter = teacherFilterFn(ui.teacher);

      const weekNotes = notes
        .filter((n) => inWeek(n.createdAt ?? 0, ws) && (!filter || filter(n)))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      const stats = Object.fromEntries(KIND_KEYS.map((k) => [k, computeStats(sessions, k, { weekStart: ws, filter })]));
      const praise = praiseFor(ws).map(praiseName).filter(Boolean);

      const typ = weekNotes.filter((n) => n.kind === "typ");
      const neg = typ.filter((n) => !n.positive).length;
      const passTotal = KIND_KEYS.reduce((sum, k) => sum + stats[k].weekTotal, 0);

      const weekOpt = ([w, n]) => `
        <option value="${w}"${w === ws ? " selected" : ""}>${escapeHtml(
          `${w === cur ? "Denna vecka" : weekLabel(w)} · ${weekRangeLabel(w)}${n ? ` · ${n} poster` : ""}`)}</option>`;
      const teacherOpt = (value, name) =>
        `<option value="${escapeHtml(value)}"${ui.teacher === value ? " selected" : ""}>${escapeHtml(name)}</option>`;

      root.innerHTML = `
        <header class="stat-head">
          <div class="stat-title">
            <h1>Statistik</h1>
            <p class="stat-sub">${ws === cur ? "Denna vecka" : "Arkiv"} · ${escapeHtml(weekLabel(ws))} · ${escapeHtml(weekRangeLabel(ws))}</p>
          </div>
          <div class="stat-controls">
            <div class="stat-weeknav" role="group" aria-label="Vecka">
              <button type="button" class="btn btn--icon" data-week-step="-1" data-focus="prev"
                title="Föregående vecka" aria-label="Föregående vecka"${ws <= oldest ? " disabled" : ""}>${icon("chevron-left")}</button>
              <select data-week data-focus="week" aria-label="Välj vecka">${weeks.map(weekOpt).join("")}</select>
              <button type="button" class="btn btn--icon" data-week-step="1" data-focus="next"
                title="Nästa vecka" aria-label="Nästa vecka"${ws >= cur ? " disabled" : ""}>${icon("chevron-right")}</button>
              <button type="button" class="btn" data-week-now data-focus="now"${ws === cur ? " disabled" : ""}>Denna vecka</button>
            </div>
            <select data-teacher data-focus="teacher" aria-label="Lärare">
              ${teacherOpt("all", "Alla lärare")}
              ${teacherOpt("mine", "Mina")}
              ${others.map((o) => teacherOpt(o.value, o.name)).join("")}
            </select>
          </div>
        </header>

        <ul class="stat-tiles" aria-label="Veckan i siffror">
          ${tile(neg, "noteringar")}
          ${tile(typ.length - neg, "positiva")}
          ${tile(weekNotes.filter((n) => n.kind === "text").length, "anteckningar")}
          ${tile(weekNotes.filter((n) => n.kind === "insats").length, "insatser")}
          ${tile(passTotal, "trafikljuspass")}
          ${tile(praise.length, "Bra jobbat")}
        </ul>

        <section class="stat-section" aria-label="Trafikljus">
          <h2 class="stat-h2">${icon("signal")} Trafikljus</h2>
          <div class="stat-kinds">${KIND_KEYS.map((k) => kindCard(k, stats[k], ws, cur)).join("")}</div>
        </section>

        <section class="stat-section" aria-label="Noteringar per elev">
          <h2 class="stat-h2">${icon("users")} Noteringar per elev</h2>
          ${studentTable(weekNotes)}
        </section>

        <section class="stat-section" aria-label="Bra jobbat">
          <h2 class="stat-h2">${icon("star")} Bra jobbat</h2>
          <div class="card stat-card">
            ${praise.length === 0
              ? `<p class="stat-empty">Ingen på Bra jobbat-listan ${ws === cur ? "ännu den här veckan" : "den veckan"}.</p>`
              : `<ul class="stat-praise">${praise.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`}
            <p class="stat-note">Listan är klassens gemensamma och påverkas inte av lärarfiltret.</p>
          </div>
        </section>`;
    }

    const tile = (n, label) =>
      `<li class="stat-tile"><span class="stat-tile__n">${n}</span><span class="stat-tile__l">${escapeHtml(label)}</span></li>`;

    /**
     * Veckoresultat + veckomål (issue #35) för en typ och vecka. Hela
     * klassens pass — lärarfiltret gäller inte målet. Måttet är klassens
     * nuvarande val (settings/trafikljus → goalMetric).
     */
    function goalBlock(k, ws, cur) {
      const metric = goalCfg.goalMetric[k];
      const { summary, goal, progress } = weekGoalStatus(sessions, k, metric, ws);
      const trend = goalTrend(sessions, k, metric, ws, 6);
      const field = GOAL_METRICS[metric].field;
      const result = summary
        ? `snitt ${fmtSec(summary.avgSec)} · bästa ${fmtSec(summary.bestSec)} · totalt ${fmtSec(summary.totalSec)} på ${summary.count} pass`
        : "Inga pass";
      let goalLine;
      if (!goal) goalLine = "Inget mål (ingen tidigare vecka med pass).";
      else {
        const from = goal.prev.adjacent ? "förra veckan" : `${weekLabel(goal.prev.weekStart)}, senaste veckan med pass`;
        const verdict = !summary
          ? `<span class="stat-goal-no">— ${ws === cur ? "inga pass ännu" : "inga pass den veckan"}</span>`
          : progress.met
          ? `<span class="stat-goal-ok">${icon("check")} ${ws === cur ? "klarat hittills" : "nått"}</span>`
          : `<span class="stat-goal-no">— ${ws === cur ? "inte klarat än" : "inte nått"}</span>`;
        goalLine = `Mål: ${GOAL_METRICS[metric].short} under ${fmtSec(goal.targetSec)} (${escapeHtml(from)}) ${verdict}`;
      }
      const trendRow = trend.length > 1 ? `
        <ol class="stat-trend" aria-label="Trend, ${GOAL_METRICS[metric].short} per vecka">
          ${trend.map((w) => `<li${w.weekStart === ws ? ` aria-current="true"` : ""}>
            <span class="stat-trend__w">${escapeHtml(weekLabel(w.weekStart))}</span>
            <span class="stat-trend__v">${fmtSec(w.summary[field])}</span>
            <span class="stat-trend__m">${w.progress == null ? "" : w.progress.met ? `<span role="img" aria-label="nått">${icon("check")}</span>` : `<span aria-label="inte nått">—</span>`}</span>
          </li>`).join("")}
        </ol>` : "";
      return `
        <div class="stat-goal">
          <p class="stat-goal__result"><span class="stat-goal__label">Veckoresultat</span> ${result}</p>
          <p class="stat-goal__goal">${goalLine}</p>
          ${trendRow}
          ${ui.teacher !== "all" ? `<p class="stat-note">Veckoresultat och mål gäller hela klassen.</p>` : ""}
        </div>`;
    }

    function kindCard(k, { counts, recordSec, recordId, latest }, ws, cur) {
      const dot = (c) => `<span class="tl-dot" data-phase="${c}"></span>`;
      const all = ui.allPasses.has(k);
      const rows = all ? latest : latest.slice(0, PASS_PAGE);
      return `
        <article class="card stat-card stat-kind">
          <h3>${icon(KINDS[k].icon)} ${KINDS[k].label}</h3>
          ${goalBlock(k, ws, cur)}
          <ul class="tl-tally" aria-label="Avslut ${KINDS[k].label.toLowerCase()}">
            <li>${dot("green")}<span class="tl-tally-n">${counts.green}</span><span class="tl-tally-l">gröna</span></li>
            <li>${dot("yellow")}<span class="tl-tally-n">${counts.yellow}</span><span class="tl-tally-l">gula</span></li>
            <li>${dot("red")}<span class="tl-tally-n">${counts.red}</span><span class="tl-tally-l">röda</span></li>
          </ul>
          <p class="tl-record"><span class="tl-record-label">Veckans rekord</span>
            ${recordSec == null
              ? `<span class="tl-stat-empty">Inget grönt avslut.</span>`
              : `<strong class="tl-record-time">${fmtMMSS(recordSec * 1000)}</strong>`}</p>
          ${latest.length === 0 ? `<p class="stat-empty">Inga pass.</p>` : `
          <ul class="tl-passes">
            ${rows.map((s) => {
              const lesson = lessonLabel(s.lesson, subjects);
              return `<li class="tl-pass${s.id === recordId ? " is-record" : ""}">
                <span class="tl-pass-who">
                  <span class="tl-pass-teacher">${escapeHtml(teacherLabel(s))}</span>
                  <span class="tl-pass-date">${escapeHtml(fmtWhen(sessionTime(s)))}</span>
                  ${lesson ? `<span class="tl-pass-lesson">${escapeHtml(lesson)}</span>` : ""}
                </span>
                <span class="tl-pass-result">${dot(s.result.color)}<span class="tl-pass-time">${fmtMMSS(s.result.durationSec * 1000)}</span></span>
              </li>`;
            }).join("")}
          </ul>
          ${latest.length > PASS_PAGE ? `<button type="button" class="btn btn--ghost tl-more" data-all-passes="${k}" data-focus="more-${k}">
            ${all ? "Visa färre" : `Visa alla ${latest.length}`}</button>` : ""}`}
        </article>`;
    }

    function studentTable(weekNotes) {
      const byStudent = new Map();
      for (const n of weekNotes) {
        if (!n.studentId) continue;
        if (!byStudent.has(n.studentId)) byStudent.set(n.studentId, []);
        byStudent.get(n.studentId).push(n);
      }
      const activeCount = students.filter((s) => s.active !== false).length;
      if (byStudent.size === 0) {
        return `<div class="card stat-card"><p class="stat-empty">Inga noteringar den här veckan${ui.teacher !== "all" ? " för det här urvalet" : ""}.</p></div>`;
      }
      // ALFABETISK ordning — medvetet ingen sortering på antal (ingen rangordning).
      const rows = [...byStudent]
        .map(([sid, list]) => ({ student: students.find((s) => s.id === sid), list }))
        .filter((r) => r.student)
        .sort((a, b) => String(a.student.firstName).localeCompare(String(b.student.firstName), "sv"));
      const without = Math.max(0, activeCount - rows.filter((r) => r.student.active !== false).length);
      const count = (list, fn) => { const n = list.filter(fn).length; return n ? String(n) : `<span class="stat-zero">0</span>`; };

      return `
        <div class="card stat-card stat-table-wrap">
          <table class="stat-table">
            <thead><tr>
              <th scope="col">Elev</th>
              <th scope="col">Noteringar</th>
              <th scope="col">Positiva</th>
              <th scope="col">Anteckningar</th>
              <th scope="col">Insatser</th>
              <th scope="col">Uppföljning</th>
            </tr></thead>
            <tbody>
              ${rows.map(({ student, list }) => {
                const open = ui.openStudent === student.id;
                return `
                <tr class="stat-row${open ? " is-open" : ""}">
                  <th scope="row">
                    <button type="button" class="stat-student" data-student="${escapeHtml(student.id)}"
                      data-focus="s-${escapeHtml(student.id)}" aria-expanded="${open}">
                      ${icon(open ? "chevron-down" : "chevron-right")}${escapeHtml(studentLabel(student, { initials }))}
                    </button>
                  </th>
                  <td>${count(list, (n) => n.kind === "typ" && !n.positive)}</td>
                  <td>${count(list, (n) => n.kind === "typ" && n.positive)}</td>
                  <td>${count(list, (n) => n.kind === "text")}</td>
                  <td>${count(list, (n) => n.kind === "insats")}</td>
                  <td>${count(list, (n) => n.followUp)}</td>
                </tr>
                ${open ? `<tr class="stat-detail"><td colspan="6"><ol class="stat-notes">${list.map(noteRow).join("")}</ol></td></tr>` : ""}`;
              }).join("")}
            </tbody>
          </table>
          ${without > 0 ? `<p class="stat-note">${without} ${without === 1 ? "elev" : "elever"} utan noteringar den här veckan.</p>` : ""}
        </div>`;
    }

    function noteRow(n) {
      const what = n.kind === "typ"
        ? (noteTypeById(n.typeId)?.name ?? "Notering")
        : n.kind === "insats" ? "Insats" : "Anteckning";
      const lesson = lessonLabel(n.lesson, subjects);
      return `
        <li class="stat-noteitem${n.positive ? " is-pos" : ""}">
          <span class="stat-noteitem__meta">
            <span>${escapeHtml(fmtWhen(n.createdAt ?? 0))}</span>
            <span class="chip${n.positive ? " chip--pos" : ""}">${escapeHtml(what)}</span>
            <span>${escapeHtml(teacherLabel(n))}</span>
            ${lesson ? `<span>${escapeHtml(lesson)}</span>` : ""}
            ${n.followUp ? `<span class="chip chip--follow">${icon("flag")}Uppföljning</span>` : ""}
          </span>
          ${n.text ? `<span class="stat-noteitem__text">${escapeHtml(n.text)}</span>` : ""}
          ${n.kind === "insats" && n.helped ? `<span class="stat-noteitem__text">Hjälpte det: ${escapeHtml(n.helped)}</span>` : ""}
        </li>`;
    }

    // Omritning i microtask (flera watch-anrop i rad → en ritning) och
    // med fokus bevarat — ett val i en lista ska inte tappa fokus när
    // en annan lärare sparar något samtidigt.
    let queued = false;
    function scheduleRender() {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!root.isConnected) return;
        const focusKey = root.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
        render();
        if (focusKey) root.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus();
      });
    }

    // ---- Händelser (delegering — markupen ritas om) ----

    root.addEventListener("click", (e) => {
      const step = e.target.closest("[data-week-step]");
      if (step && !step.disabled) {
        ui.weekStart = addWeeks(selectedWeek(), Number(step.dataset.weekStep));
        ui.openStudent = null;
        ui.allPasses.clear();
        scheduleRender();
        return;
      }
      if (e.target.closest("[data-week-now]")) {
        ui.weekStart = null;
        ui.openStudent = null;
        ui.allPasses.clear();
        scheduleRender();
        return;
      }
      const stu = e.target.closest("[data-student]");
      if (stu) {
        ui.openStudent = ui.openStudent === stu.dataset.student ? null : stu.dataset.student;
        scheduleRender();
        return;
      }
      const more = e.target.closest("[data-all-passes]");
      if (more) {
        const k = more.dataset.allPasses;
        if (ui.allPasses.has(k)) ui.allPasses.delete(k); else ui.allPasses.add(k);
        scheduleRender();
      }
    });
    root.addEventListener("change", (e) => {
      if (e.target.matches("[data-week]")) {
        const w = Number(e.target.value);
        ui.weekStart = w >= currentWeek() ? null : w;
        ui.openStudent = null;
        ui.allPasses.clear();
        scheduleRender();
      } else if (e.target.matches("[data-teacher]")) {
        ui.teacher = e.target.value;
        scheduleRender();
      }
    });

    // ---- Datakällor (live, delade mellan lärarna) ----

    offs.push(data.watch(`classes/${cid}/sessions`, (docs) => { sessions = docs; scheduleRender(); }));
    offs.push(data.watch(`classes/${cid}/notes`, (docs) => { notes = docs; scheduleRender(); }));
    offs.push(data.watch(`classes/${cid}/students`, (docs) => { students = docs; scheduleRender(); }));
    offs.push(data.watch(praiseArchivePath(cid), (docs) => { archive = docs; scheduleRender(); }));
    offs.push(data.watch(`classes/${cid}/settings`, (docs) => {
      settingsDocs = docs;
      subjects = mergedSubjects(settingsDocs);
      initials = docs.find((d) => d.id === "display")?.value?.nameDisplay === "initials";
      morning = normalizeMorning(docs.find((d) => d.id === MORNING_KEY)?.value);
      goalCfg = normalizeGoalSettings(docs.find((d) => d.id === "trafikljus")?.value);
      scheduleRender();
    }));

    // Veckoskifte medan vyn står öppen: "Denna vecka" ska följa med.
    let shownWeek = currentWeek();
    const tick = setInterval(() => {
      if (currentWeek() !== shownWeek) { shownWeek = currentWeek(); scheduleRender(); }
    }, 30_000);
    offs.push(() => clearInterval(tick));

    render();
  },

  async unmount() {
    for (const off of this._offs ?? []) { try { off(); } catch { /* ok */ } }
    this._offs = [];
  },
};
