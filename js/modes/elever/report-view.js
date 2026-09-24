/**
 * ELEVRAPPORTER — rendering (issue #33). ENDAST LÄRARVY.
 *
 * HTML-strängar för en rapport eller en sammanställning — samma markup
 * används i sammanställningsvyn på skärmen och i utskriften (A4, se
 * css/modes/rapport.css). Allt innehåll escapas.
 *
 * Input är alltid "sammanslagen form" (report-data.js → mergeReports):
 * även en vanlig rapport från den egna datorn renderas som en
 * sammanställning med en enda källa. Varje notering är färgmärkt per
 * lärare (teachers[].color).
 */

import { icon } from "../../lib/icons.js";
import { escapeHtml, fmtDate, fmtTime } from "./shared.js";
import { weekLabel, weekStartFromKey } from "../../lib/week.js";
import {
  analyzeNotes, classSummary, interventionLine, kindName, lessonName, periodLabel, genitive,
} from "./report-data.js";

const esc = escapeHtml;

const fmtFull = (ms) => new Date(ms).toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" });
const dayName = (ms) => new Date(ms).toLocaleDateString("sv-SE", { weekday: "short" }).replace(/\.$/, "");

function teacherOf(merged, n) {
  return merged.teachers.find((t) => t.uid === n.createdBy) ?? { name: n.createdByName ?? "okänd lärare", color: "#888" };
}

const teacherDot = (t) => `<span class="rp-dot" style="--t-color:${esc(t.color)}" aria-hidden="true"></span>`;
const teacherTag = (t) => `<span class="rp-teacher" style="--t-color:${esc(t.color)}">${teacherDot(t)}${esc(t.name)}</span>`;

export function studentName(s) {
  return `${s.name}${s.tag ? ` ${s.tag}` : ""}`;
}

function bars(title, rows, sub = "", { wide = false } = {}) {
  if (!rows.length || rows.every((r) => r.count === 0)) return "";
  const max = Math.max(1, ...rows.map((r) => r.count));
  return `
    <section class="rp-box${wide ? " rp-box--wide" : ""}">
      <h4>${esc(title)}</h4>
      ${sub ? `<p class="rp-sub">${esc(sub)}</p>` : ""}
      <ul class="rp-bars">
        ${rows.map((r) => `
          <li><span class="rp-bars__label">${esc(r.label)}</span>
            <span class="rp-bars__track"><span class="rp-bars__bar" style="width:${(r.count / max) * 100}%"></span></span>
            <span class="rp-bars__n">${r.count}</span></li>`).join("")}
      </ul>
    </section>`;
}

const tile = (n, label) => `<li class="rp-tile"><span class="rp-tile__n">${n}</span><span class="rp-tile__l">${esc(label)}</span></li>`;

function noteLine(merged, n, { withText = true } = {}) {
  const t = teacherOf(merged, n);
  return `
    <li class="rp-note${n.positive ? " rp-note--pos" : ""}${n.kind === "insats" ? " rp-note--insats" : ""}" style="--t-color:${esc(t.color)}">
      <span class="rp-note__when">${esc(dayName(n.createdAt))} ${esc(fmtDate(n.createdAt))} ${esc(fmtTime(n.createdAt))}</span>
      <span class="rp-note__kind">${esc(kindName(n))}${n.positive ? " (+)" : ""}</span>
      ${n.followUp ? `<span class="rp-flag">${icon("flag")}Uppföljning</span>` : ""}
      ${n.label ? `<span class="rp-label" style="--l-color:${esc(n.label.color || "#888")}">${esc(n.label.name)}</span>` : ""}
      <span class="rp-note__lesson">${esc(lessonName(n))}</span>
      ${teacherTag(t)}
      ${withText && n.text ? `<span class="rp-note__text">${esc(n.text)}</span>` : ""}
      ${n.kind === "insats" && n.helped ? `<span class="rp-note__helped">Hjälpte det: ${esc(n.helped)}</span>` : ""}
    </li>`;
}

/** En elevs rapport/sammanställning. */
export function renderStudentReport(student, merged, { className = "", now } = {}) {
  const a = analyzeNotes(student.notes, { teachers: merged.teachers, period: merged.period });
  const teachersHere = merged.teachers.filter((t) => student.notes.some((n) => n.createdBy === t.uid) || student.praise.some((p) => p.by === t.uid));
  const multi = merged.teachers.length > 1;

  const tst = a.typeSubjectTeacher.map((row) => `
    <li><strong>${esc(row.typeName)}:</strong> ${row.parts.map((p) =>
      `${p.count} i ${esc(p.subject)}${multi ? ` (${esc(p.teacherName)})` : ""}`).join(", ")}</li>`).join("");

  const weeks = a.weeks.length > 1 ? `
    <section class="rp-box rp-box--wide">
      <h4>Vecka för vecka</h4>
      <div class="rp-scroll"><table class="rp-table">
        <thead><tr><th>Vecka</th><th>Noteringar</th><th>Positiva</th><th>Anteckningar</th><th>Insatser</th><th>Uppföljningar</th></tr></thead>
        <tbody>${a.weeks.map((w) => `<tr><td>${esc(w.label)} <span class="rp-sub">${esc(w.range)}</span></td><td>${w.neg}</td><td>${w.pos}</td><td>${w.text}</td><td>${w.insats}</td><td>${w.followUps}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>` : "";

  const praise = student.praise.length ? `<p class="rp-praise">${icon("star")} Bra jobbat: ${student.praise.map((p) => {
    const t = merged.teachers.find((x) => x.uid === p.by);
    const ws = weekStartFromKey(p.weekOf);
    return `${esc(ws != null ? weekLabel(ws, now) : p.weekOf)}${multi && t ? ` (${esc(t.name)})` : ""}`;
  }).join(", ")}</p>` : "";

  return `
    <article class="rp-student" data-rp-student="${esc(student.key)}">
      <header class="rp-student__head">
        <h2>${esc(studentName(student))}</h2>
        <p class="rp-meta">${esc(className)} · ${esc(periodLabel(merged.period, now))}
          ${teachersHere.length ? ` · ${teachersHere.map(teacherTag).join(" ")}` : ""}</p>
        ${student.aliases.length > 1 ? `<p class="rp-sub">Sammanslagen från: ${student.aliases.map(esc).join(" · ")}</p>` : ""}
        ${student.fromFile ? `<p class="rp-sub">Ingen av dina elever — visas som i ${esc(genitive(student.fromFile))} fil.</p>` : ""}
      </header>

      <section class="rp-follow">
        <h3>${icon("flag")} Uppföljningar (${a.followUps.length})</h3>
        ${a.followUps.length ? `<ol class="rp-notes">${a.followUps.map((n) => noteLine(merged, n)).join("")}</ol>`
          : `<p class="rp-empty">Inga uppföljningar i perioden.</p>`}
      </section>

      ${a.counts.total === 0 && !student.praise.length ? `<p class="rp-empty">Inga noteringar i perioden.</p>` : `
      <ul class="rp-tiles">
        ${tile(a.counts.neg, "noteringar")}
        ${tile(a.counts.pos, "positiva")}
        ${tile(a.counts.text, "anteckningar")}
        ${tile(a.counts.insats, "insatser")}
        ${tile(a.counts.followUps, "uppföljningar")}
      </ul>
      ${praise}

      ${tst ? `<section class="rp-box rp-box--wide"><h4>Per ${multi ? "typ, ämne och lärare" : "typ och ämne"}</h4><ul class="rp-list">${tst}</ul></section>` : ""}

      <div class="rp-grid">
        ${bars("Typ av notering", a.byType)}
        ${multi ? bars("Per lärare", a.byTeacher.map((t) => ({ label: t.name, count: t.total }))) : ""}
        ${bars("Veckodag", a.byWeekday)}
        ${bars("Tid på dagen", a.byHour)}
        ${bars("När i lektionen", a.byMoment)}
        ${bars("Per lektion", a.byLesson, "", { wide: true })}
      </div>

      <section class="rp-box rp-box--wide">
        <h4>${icon("pen")} Insatser — och vad som hjälpte</h4>
        ${a.interventions.length ? `<ul class="rp-list">${a.interventions.map((g) => `
          <li><strong>${esc(g.text)}:</strong> ${esc(interventionLine(g))}${multi ? ` <span class="rp-sub">(${g.teachers.map(esc).join(", ")})</span>` : ""}</li>`).join("")}</ul>`
          : `<p class="rp-empty">Inga insatser loggade i perioden.</p>`}
      </section>

      ${weeks}

      <section class="rp-all">
        <h3>Alla noteringar i tidsordning (${a.counts.total})</h3>
        ${a.counts.total ? `<ol class="rp-notes">${student.notes.map((n) => noteLine(merged, n)).join("")}</ol>`
          : `<p class="rp-empty">Inga noteringar.</p>`}
      </section>`}
    </article>`;
}

/** Klassens sammanfattning överst. */
export function renderClassSummary(merged, { className = "", now } = {}) {
  const sum = classSummary(merged);
  const multi = merged.teachers.length > 1;
  const a = sum.analysis;
  return `
    <section class="rp-classsum">
      <h2>${esc(className)} — ${esc(periodLabel(merged.period, now))}</h2>
      <p class="rp-lead"><strong>${sum.withFollowUps} ${sum.withFollowUps === 1 ? "elev" : "elever"} med öppna uppföljningar</strong>${
        sum.withFollowUps ? `: ${sum.followUpNames.map(esc).join(", ")}` : ""}.</p>
      <ul class="rp-tiles">
        ${tile(sum.students, "elever")}
        ${tile(a.counts.neg, "noteringar")}
        ${tile(a.counts.pos, "positiva")}
        ${tile(a.counts.insats, "insatser")}
        ${tile(sum.followUps, "uppföljningar")}
      </ul>
      ${merged.teachers.length ? `<p class="rp-meta">Lärare: ${merged.teachers.map(teacherTag).join(" ")}</p>` : ""}
      <div class="rp-grid">
        ${multi ? bars("Per lärare", a.byTeacher.map((t) => ({ label: t.name, count: t.total }))) : ""}
        ${bars("Per ämne", a.bySubject, "Noteringar (utan positiva)")}
        ${bars("Veckodag", a.byWeekday)}
        ${bars("Tid på dagen", a.byHour)}
      </div>
    </section>`;
}

/** Källorna i en sammanställning (vilka filer och lärare). */
export function renderSources(merged, { now } = {}) {
  if (!merged.sources.length) return "";
  return `<p class="rp-sources">Källor: ${merged.sources.map((s) =>
    s.thisComputer
      ? `${esc(s.teacherName ?? "?")} (egna noteringar från den här datorn)`
      : `${esc(s.teacherName ?? "?")} (${esc(s.className ?? "")}, ${esc(s.period?.label || periodLabel(s.period, now))}, exporterad ${esc(fmtDate(s.exportedAt))})`).join(" · ")}</p>`;
}

/**
 * Hela dokumentet för utskrift/PDF.
 * studentKey null = hela klassen (sammanfattning + varje elev med noteringar).
 */
export function renderReportDocument(merged, { className = "", studentKey = null, now, title = "Elevrapport" } = {}) {
  const students = studentKey ? merged.students.filter((s) => s.key === studentKey) : merged.students;
  const hasData = (s) => s.notes.length || s.praise.length;
  const withData = studentKey ? students : students.filter(hasData);
  const without = studentKey ? [] : students.filter((s) => !hasData(s));
  return `
    <header class="rp-doc__head">
      <p class="rp-doc__kicker">${icon("lock")} ${esc(title)} · Klassrumsverktyget · utskriven ${esc(fmtFull(now))}</p>
      <p class="rp-doc__warn">Innehåller personuppgifter. Utskriften/PDF:en är okrypterad — för överföring till skolans dokumentationssystem. Spara den inte löst på datorn.</p>
      ${renderSources(merged, { now })}
    </header>
    ${studentKey ? "" : renderClassSummary(merged, { className, now })}
    ${withData.map((s) => renderStudentReport(s, merged, { className, now })).join("")}
    ${without.length ? `<p class="rp-empty rp-doc__none">Inga noteringar i perioden: ${without.map((s) => esc(studentName(s))).join(", ")}.</p>` : ""}`;
}
