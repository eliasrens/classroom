/**
 * Flik: REGISTRERA — snabb registrering under lektion + minneslista.
 *
 * Ett klick på en elev = en notering med standardtypen. Elever med
 * tilldelad tangent noteras med ett tangenttryck (Shift = positivt).
 * Minneslistan längst ner är passets sammanställning — den räknar
 * ALDRIG ut någon åtgärd och rangordnar inte elever (alfabetisk
 * ordning, alltid).
 */

import { icon } from "../../lib/icons.js";
import {
  NOTE_TYPES, noteTypeById, activeStudents, escapeHtml,
  createNote, currentLessonBlock, fmtTime,
} from "./shared.js";
import { startOfWeek } from "../../lib/week.js";

const startOfToday = () => new Date(new Date(Date.now()).setHours(0, 0, 0, 0)).getTime();

export function renderRegister(el, api) {
  const students = activeStudents(api.students);
  // Veckorytm: minneslistan börjar aldrig före måndag 00:00 — en
  // nollställning i fredags visar alltså inte fredagens noteringar på måndag.
  const sessionStart = Math.max(api.settings.sessionStart ?? startOfToday(), startOfWeek());
  const sessionNotes = api.notes.filter((n) => (n.createdAt ?? 0) >= sessionStart);
  const anyHotkeys = students.some((s) => s.hotkey);

  const countsFor = (sid) => {
    const mine = sessionNotes.filter((n) => n.studentId === sid && n.kind === "typ");
    return { pos: mine.filter((n) => n.positive).length, neg: mine.filter((n) => !n.positive).length };
  };

  el.innerHTML = `
    <section class="reg">
      <div class="reg__toolbar card">
        <div class="reg__types" role="group" aria-label="Standardtyp för ett tryck">
          <span class="reg__types-label">Standardtyp:</span>
          ${NOTE_TYPES.filter((t) => !t.positive).map((t) => `
            <button class="chip ${t.id === api.settings.defaultTypeId ? "chip--active" : ""}"
              data-type="${t.id}">${escapeHtml(t.name)}</button>`).join("")}
        </div>
        <div class="reg__toolbar-right">
          <span class="reg__lesson" data-lesson>${icon("clock")}<span>…</span></span>
          <button class="btn" data-undo title="Ctrl+Z">${icon("undo")}Ångra senaste</button>
        </div>
      </div>

      ${students.length === 0 ? `
        <div class="mode-placeholder">
          <p>Inga elever ännu — lägg till dem under fliken <strong>Elever</strong>.</p>
        </div>` : `
        <p class="reg__hint">
          Klick på en elev = en notering (${escapeHtml(noteTypeById(api.settings.defaultTypeId)?.name ?? "")}).
          Knappen <strong>+</strong> noterar något som går bra.${anyHotkeys
            ? " Tilldelad tangent = samma sak med ett tryck, Shift + tangent = positivt."
            : ""}
        </p>
        <div class="reg__grid">
          ${students.map((s) => {
            const c = countsFor(s.id);
            return `
            <div class="reg__student" data-student="${s.id}">
              <button class="reg__tap" data-tap="${s.id}" title="En notering: ${escapeHtml(noteTypeById(api.settings.defaultTypeId)?.name ?? "")}">
                <span class="reg__name">${api.label(s)}</span>
                ${s.hotkey ? `<kbd class="reg__key">${escapeHtml(s.hotkey)}</kbd>` : ""}
                <span class="reg__counts">
                  ${c.neg > 0 ? `<span class="reg__count">${c.neg}</span>` : ""}
                  ${c.pos > 0 ? `<span class="reg__count reg__count--pos">+${c.pos}</span>` : ""}
                </span>
              </button>
              <button class="reg__pos" data-pos="${s.id}" title="Notera något som går bra">+</button>
            </div>`;
          }).join("")}
        </div>`}

      <section class="reg__session card">
        <header class="reg__session-head">
          <h2>Minneslista — passets noteringar</h2>
          <button class="btn" data-reset>${icon("undo")}Nollställ inför nästa lektion</button>
        </header>
        <p class="reg__session-sub">Sedan ${fmtTime(sessionStart)}. Att titta på sista minuterna —
          uppföljning är alltid ditt eget beslut och sätts som egen anteckning.</p>
        ${renderSessionList(sessionNotes, api)}
      </section>
    </section>`;

  // Pågående lektion (asynkront — fyll i när svaret kommer)
  void currentLessonBlock(api.data, api.cid).then((l) => {
    const slot = el.querySelector("[data-lesson] span");
    if (slot) slot.textContent = l ? `Pågår: ${l.title || l.subjectId || "lektion"} ${l.start}–${l.end}` : "Ingen pågående lektion i planeringen";
  });

  el.querySelector(".reg__types")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-type]");
    if (!btn) return;
    void api.saveSettings({ defaultTypeId: btn.dataset.type }).then(() => api.refresh());
  });

  el.querySelector("[data-undo]")?.addEventListener("click", () => void api.undoLast());

  el.querySelector(".reg__grid")?.addEventListener("click", (e) => {
    const tap = e.target.closest("[data-tap]");
    if (tap) { void api.quickNote(tap.dataset.tap); return; }
    const pos = e.target.closest("[data-pos]");
    if (pos) void api.quickNote(pos.dataset.pos, { positive: true });
  });

  el.querySelector("[data-reset]")?.addEventListener("click", () => {
    void api.saveSettings({ sessionStart: Date.now() }).then(() => api.refresh());
  });

  el.querySelector(".reg__session")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-followup]");
    if (!btn) return;
    const s = api.studentById(btn.dataset.followup);
    const text = prompt(`Uppföljning för ${s ? s.firstName : "eleven"} — din egen anteckning (sakligt, om skolarbetet):`);
    if (text == null || text.trim() === "") return;
    void createNote(api.data, api.cid, {
      studentId: btn.dataset.followup,
      kind: "text",
      text: text.trim(),
      followUp: true,
    }).then(() => api.toast("Uppföljningsanteckning sparad."));
  });
}

function renderSessionList(sessionNotes, api) {
  const byStudent = new Map();
  for (const n of sessionNotes) {
    if (!n.studentId) continue;
    if (!byStudent.has(n.studentId)) byStudent.set(n.studentId, []);
    byStudent.get(n.studentId).push(n);
  }
  if (byStudent.size === 0) return `<p class="reg__empty">Inga noteringar under passet ännu.</p>`;

  // ALFABETISK ordning — medvetet ingen sortering på antal (ingen rangordning).
  const rows = [...byStudent.entries()]
    .map(([sid, notes]) => ({ student: api.studentById(sid), notes }))
    .filter((r) => r.student)
    .sort((a, b) => String(a.student.firstName).localeCompare(String(b.student.firstName), "sv"));

  return `<ul class="reg__list">${rows.map(({ student, notes }) => `
    <li class="reg__row">
      <span class="reg__row-name">${api.label(student)}</span>
      <span class="reg__row-notes">${notes
        .slice().sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .map((n) => `<span class="reg__event ${n.positive ? "reg__event--pos" : ""}">
            ${fmtTime(n.createdAt)} ${escapeHtml(labelForNote(n))}</span>`).join("")}
      </span>
      <button class="btn btn--ghost reg__row-follow" data-followup="${student.id}">
        ${icon("flag")}Uppföljning</button>
    </li>`).join("")}</ul>`;
}

function labelForNote(n) {
  if (n.kind === "typ") return noteTypeById(n.typeId)?.name ?? "Notering";
  if (n.kind === "insats") return "Insats";
  return n.followUp ? "Uppföljning" : "Anteckning";
}
