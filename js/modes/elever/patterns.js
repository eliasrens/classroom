/**
 * Flik: MÖNSTER — översikt över noteringar över tid.
 *
 * Det viktigaste i hela läget: NÄR faller noteringarna (moment i
 * lektionen, veckodag, tid på dagen, ämne) — så att läraren ser om
 * en elev tappar det vid samma moment, eller om stöket i klassen
 * är koncentrerat till vissa moment snarare än vissa elever.
 *
 * MEDVETET: ingen rangordning av elever, inga topplistor, inga
 * trösklar eller varningsnivåer. Klassvyn visar mönster per moment/
 * tid/ämne — aldrig "värsta eleven".
 */

import { icon } from "../../lib/icons.js";
import {
  activeStudents, escapeHtml, noteTypeById, NOTE_TYPES,
  MOMENT_BUCKETS, momentOf, weekdayOf, hourOf, WEEKDAYS, fmtDateTime,
} from "./shared.js";
import { startOfWeek } from "../../lib/week.js";
import { serverNow } from "../../lib/clock.js";

// Veckorytm: "Denna vecka" är standard — mönstren börjar om varje måndag.
// Längre perioder väljs aktivt (och gäller bara tills läget lämnas);
// enskilda tidigare veckor finns i arkivet under Statistik.
const RANGES = [
  { id: "vecka", name: "Denna vecka", week: true },
  { id: "2v", name: "2 veckor", days: 14 },
  { id: "4v", name: "4 veckor", days: 28 },
  { id: "allt", name: "Hela historiken", days: null },
];

export function renderPatterns(el, api) {
  const students = activeStudents(api.students);
  const scope = api._patScope ?? "class"; // "class" | studentId
  const rangeId = api._patRange ?? "vecka";
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[0];
  const cutoff = range.week ? startOfWeek() : range.days ? serverNow() - range.days * 864e5 : 0;

  const student = scope === "class" ? null : api.studentById(scope);
  const inScope = api.notes.filter((n) =>
    n.createdAt >= cutoff && (student ? n.studentId === student.id : true));

  const typNotes = inScope.filter((n) => n.kind === "typ");
  const negNotes = typNotes.filter((n) => !n.positive);
  const posCount = typNotes.length - negNotes.length;
  const insatser = inScope.filter((n) => n.kind === "insats")
    .sort((a, b) => b.createdAt - a.createdAt);

  el.innerHTML = `
    <section class="pat">
      <div class="pat__toolbar card">
        <label>Visa:
          <select data-scope>
            <option value="class" ${scope === "class" ? "selected" : ""}>Hela klassen</option>
            ${students.map((s) => `
              <option value="${s.id}" ${scope === s.id ? "selected" : ""}>${api.label(s)}</option>`).join("")}
          </select>
        </label>
        <label>Period:
          <select data-range>
            ${RANGES.map((r) => `<option value="${r.id}" ${r.id === rangeId ? "selected" : ""}>${r.name}</option>`).join("")}
          </select>
        </label>
        <span class="pat__sum">${negNotes.length} noteringar, ${posCount} positiva${student ? "" : " — mönster per moment, inte per elev"}</span>
        <a class="pat__archive" href="#/statistik">Tidigare veckor i Statistik</a>
      </div>

      ${negNotes.length === 0 && posCount === 0 ? `
        <div class="mode-placeholder"><p>Inga noteringar i perioden${student ? ` för ${api.label(student)}` : ""}.</p></div>` : `
      <div class="pat__grid">
        ${barCard("När i lektionen", icon("clock"), tally(negNotes, momentOf, MOMENT_BUCKETS),
          student ? "Tappar det vid samma moment?" : "Är stöket koncentrerat till vissa moment — snarare än vissa elever?")}
        ${barCard("Veckodag", icon("chart"), tally(negNotes, weekdayOf, WEEKDAYS.filter((d, i) => i < 5 || negNotes.some((n) => weekdayOf(n) === d))))}
        ${barCard("Tid på dagen", icon("clock"), tally(negNotes, hourOf, hourKeys(negNotes)))}
        ${barCard("Ämne", icon("book"), tally(negNotes, subjectOf, subjectKeys(negNotes)))}
        ${student ? barCard("Typ av notering", icon("check"),
          tally(typNotes, (n) => noteTypeById(n.typeId)?.name ?? "Annat",
            NOTE_TYPES.map((t) => t.name).filter((name) => typNotes.some((n) => (noteTypeById(n.typeId)?.name ?? "Annat") === name)))) : ""}
      </div>`}

      <section class="pat__insatser card">
        <h2>${icon("pen")} Insatser${student ? ` — ${api.label(student)}` : ""}</h2>
        <p class="pat__insatser-sub">Vad gjordes åt saken och hjälpte det? Loggas på elevkortet
          (Elevkort &amp; sök → Logga insats).</p>
        ${insatser.length === 0 ? `<p class="ekort__empty">Inga insatser loggade i perioden.</p>` : `
        <ul class="pat__insats-list">
          ${insatser.slice(0, 20).map((n) => {
            const s = api.studentById(n.studentId);
            return `<li>
              <span class="pat__insats-meta">${fmtDateTime(n.createdAt)} — ${s ? api.label(s) : "?"}</span>
              <span class="pat__insats-text">${escapeHtml(n.text)}</span>
              ${n.helped ? `<span class="chip ${n.helped === "ja" ? "chip--pos" : ""}">hjälpte: ${escapeHtml(n.helped)}</span>` : ""}
            </li>`;
          }).join("")}
        </ul>`}
      </section>
    </section>`;

  el.querySelector("[data-scope]").addEventListener("change", (e) => {
    api._patScope = e.target.value;
    api.refresh();
  });
  el.querySelector("[data-range]").addEventListener("change", (e) => {
    api._patRange = e.target.value;
    api.refresh();
  });
}

// ---- Hjälpare ----

function tally(notes, keyFn, orderedKeys) {
  const counts = new Map(orderedKeys.map((k) => [k, 0]));
  for (const n of notes) {
    const k = keyFn(n);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

function subjectOf(n) {
  return n.lesson ? (n.lesson.title || n.lesson.subjectId || "Lektion utan ämne") : "Utanför lektion";
}

const subjectKeys = (notes) => [...new Set(notes.map(subjectOf))].sort((a, b) => a.localeCompare(b, "sv"));
const hourKeys = (notes) => [...new Set(notes.map(hourOf))].sort();

function barCard(title, iconHtml, rows, sub = "") {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return `
    <section class="pat__card card">
      <h2>${iconHtml} ${escapeHtml(title)}</h2>
      ${sub ? `<p class="pat__card-sub">${escapeHtml(sub)}</p>` : ""}
      <ul class="pat__bars">
        ${rows.map((r) => `
          <li>
            <span class="pat__bar-label">${escapeHtml(r.label)}</span>
            <span class="pat__bar-track"><span class="pat__bar" style="width:${(r.count / max) * 100}%"></span></span>
            <span class="pat__bar-count">${r.count}</span>
          </li>`).join("")}
      </ul>
    </section>`;
}
