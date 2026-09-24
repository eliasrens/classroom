/**
 * Flik: ELEVKORT & SÖK — tidslinje per elev, fritextsök över alla
 * elever, uppföljningsfilter och uttag för vald period (t.ex. inför
 * utvecklingssamtal). Anteckningar kan redigeras och raderas.
 *
 * Här loggas också INSATSER: vad läraren gjorde åt saken och om det
 * hjälpte — så att historiken visar arbete, inte bara problem.
 */

import { icon } from "../../lib/icons.js";
import { studentLabel } from "../../lib/names.js";
import {
  notesPath, activeStudents, escapeHtml, noteTypeById,
  createNote, fmtTime, fmtDateTime, todayISO, teacherLabel,
} from "./shared.js";
import { startOfWeek } from "../../lib/week.js";

export function renderCard(el, api) {
  const students = activeStudents(api.students);
  const query = (api._cardSearch ?? "").trim().toLocaleLowerCase("sv");
  const followOnly = Boolean(api._cardFollowOnly);
  const selected = api.studentById(api.cardStudentId);

  // Sökträffar över ALLA elever (fritext + ev. uppföljningsfilter)
  const hits = (query || followOnly)
    ? api.notes.filter((n) =>
        (!followOnly || n.followUp) &&
        (!query || String(n.text ?? "").toLocaleLowerCase("sv").includes(query)))
    : [];

  el.innerHTML = `
    <section class="ekort">
      <aside class="ekort__side card">
        <div class="ekort__search">
          <label class="sr-only" for="ekort-q">Sök i anteckningar</label>
          <input id="ekort-q" type="search" placeholder="Sök i fritext — alla elever"
            value="${escapeHtml(api._cardSearch ?? "")}" autocomplete="off">
          <label class="ekort__follow">
            <input type="checkbox" data-followonly ${followOnly ? "checked" : ""}>
            ${icon("flag")} Endast uppföljning
          </label>
        </div>

        ${(query || followOnly) ? `
          <div class="ekort__hits">
            <h3>${hits.length} träffar</h3>
            ${hits.length === 0 ? `<p class="ekort__empty">Inget matchar.</p>` : `
            <ul>${hits.slice(0, 60).map((n) => {
              const s = api.studentById(n.studentId);
              return `<li><button data-open="${n.studentId ?? ""}">
                <strong>${s ? api.label(s) : "?"}</strong>
                <span>${fmtDateTime(n.createdAt)}</span>
                <em>${escapeHtml(String(n.text ?? "").slice(0, 90))}</em>
              </button></li>`;
            }).join("")}</ul>`}
          </div>` : `
          <ul class="ekort__students">
            ${students.map((s) => `
              <li><button data-open="${s.id}" ${s.id === api.cardStudentId ? 'aria-current="true"' : ""}>
                ${api.label(s)}
              </button></li>`).join("")}
          </ul>`}
      </aside>

      <div class="ekort__main">
        ${selected ? cardHtml(selected, api) : `
          <div class="mode-placeholder"><p>Välj en elev — eller sök i fritexten till vänster.</p></div>`}
      </div>
    </section>`;

  // ---- Sök & val ----
  const q = el.querySelector("#ekort-q");
  q.addEventListener("input", () => {
    api._cardSearch = q.value;
    const pos = q.selectionStart;
    api.refresh();
    queueMicrotask(() => {
      const nq = el.querySelector("#ekort-q");
      if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
    });
  });
  el.querySelector("[data-followonly]").addEventListener("change", (e) => {
    api._cardFollowOnly = e.target.checked;
    api.refresh();
  });
  el.querySelector(".ekort__side").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-open]");
    if (btn && btn.dataset.open) {
      api.cardStudentId = btn.dataset.open;
      api._cardSearch = "";
      api._cardFollowOnly = false;
      api.refresh();
    }
  });

  if (!selected) return;
  const main = el.querySelector(".ekort__main");
  const path = notesPath(api.cid);

  // ---- Insatsformulär ----
  main.querySelector("[data-show-older]")?.addEventListener("click", () => {
    api._cardShowOlder = !api._cardShowOlder;
    api.refresh();
  });

  main.querySelector("[data-insats-open]")?.addEventListener("click", () => {
    api._cardInsats = !api._cardInsats;
    api.refresh();
  });
  main.querySelector("[data-insatsform]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = e.target.querySelector("[name=text]").value.trim();
    if (!text) return;
    const helped = e.target.querySelector("[name=helped]").value || null;
    void createNote(api.data, api.cid, {
      studentId: selected.id, kind: "insats", text, helped,
    }).then(() => {
      api._cardInsats = false;
      api.toast("Insats loggad.");
      api.refresh();
    });
  });

  // ---- Uttag ----
  main.querySelector("[data-exportform]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    api._cardFrom = e.target.querySelector("[name=from]").value;
    api._cardTo = e.target.querySelector("[name=to]").value;
    api._cardExport = buildExport(selected, api);
    api.refresh();
  });
  main.querySelector("[data-copy]")?.addEventListener("click", (e) => {
    void navigator.clipboard?.writeText(api._cardExport ?? "")
      .then(() => api.toast("Uttaget kopierat."))
      .catch(() => api.toast("Kunde inte kopiera — markera texten manuellt."));
  });
  main.querySelector("[data-export-close]")?.addEventListener("click", () => {
    api._cardExport = null;
    api.refresh();
  });

  // ---- Tidslinjens åtgärder ----
  main.querySelector(".ekort__timeline")?.addEventListener("click", (e) => {
    const flag = e.target.closest("[data-flag]");
    if (flag) {
      const n = api.notes.find((x) => x.id === flag.dataset.flag);
      void api.data.patch(path, flag.dataset.flag, { followUp: !n?.followUp }).then(() => api.refresh());
      return;
    }
    const edit = e.target.closest("[data-editnote]");
    if (edit) { api._cardEditingNote = edit.dataset.editnote; api.refresh(); return; }

    const cancel = e.target.closest("[data-editcancel]");
    if (cancel) { api._cardEditingNote = null; api.refresh(); return; }

    const del = e.target.closest("[data-delnote]");
    if (del && confirm("Radera noteringen? Det går inte att ångra.")) {
      void api.data.remove(path, del.dataset.delnote).then(() => api.refresh());
    }
  });
  main.querySelector("[data-editnoteform]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = e.target.dataset.editnoteform;
    const text = e.target.querySelector("[name=text]").value.trim();
    void api.data.patch(path, id, { text }).then(() => {
      api._cardEditingNote = null;
      api.refresh();
    });
  });
}

function cardHtml(student, api) {
  const all = api.notes.filter((n) => n.studentId === student.id); // redan nyast först
  // Veckorytm: tidslinjen visar innevarande vecka; äldre veckor fälls ut
  // på begäran (gäller tills läget lämnas). Sök och uttag omfattar allt.
  const weekStart = startOfWeek();
  const older = all.filter((n) => (n.createdAt ?? 0) < weekStart);
  const notes = api._cardShowOlder ? all : all.filter((n) => (n.createdAt ?? 0) >= weekStart);
  const editing = api._cardEditingNote ?? null;
  const from = api._cardFrom ?? todayISO(new Date(Date.now() - 28 * 864e5));
  const to = api._cardTo ?? todayISO();

  return `
    <article class="ekort__card card">
      <header class="ekort__head">
        <h2>${api.label(student)}</h2>
        <div class="ekort__head-actions">
          <button class="btn" data-insats-open>${icon("pen")}Logga insats</button>
        </div>
      </header>

      ${api._cardInsats ? `
        <form class="ekort__insats" data-insatsform>
          <p class="ekort__insats-hint">Vad gjorde du åt saken — och hjälpte det?
            Historiken blir en logg över insatser, inte bara problem.</p>
          <textarea name="text" rows="2" required placeholder="T.ex. bytte plats närmare tavlan under genomgångar"></textarea>
          <div class="ekort__insats-row">
            <label>Hjälpte det?
              <select name="helped">
                <option value="">Vet inte ännu</option>
                <option value="ja">Ja</option>
                <option value="delvis">Delvis</option>
                <option value="nej">Nej</option>
              </select>
            </label>
            <button class="btn btn--primary" type="submit">Spara insats</button>
          </div>
        </form>` : ""}

      <form class="ekort__export" data-exportform>
        <span>${icon("download")}Uttag för period:</span>
        <input type="date" name="from" value="${escapeHtml(from)}" aria-label="Från">
        <span>–</span>
        <input type="date" name="to" value="${escapeHtml(to)}" aria-label="Till">
        <button class="btn" type="submit">Visa uttag</button>
      </form>

      ${api._cardExport != null ? `
        <div class="ekort__exportout">
          <div class="ekort__exportout-bar">
            <button class="btn" data-copy>${icon("copy")}Kopiera</button>
            <button class="btn btn--ghost" data-export-close>${icon("x")}Stäng</button>
          </div>
          <pre>${escapeHtml(api._cardExport)}</pre>
        </div>` : ""}

      ${notes.length === 0 ? `<p class="ekort__empty">Inga noteringar om ${api.label(student)} ${older.length ? "den här veckan" : "ännu"}.</p>` : `
      <ol class="ekort__timeline">
        ${notes.map((n) => n.id === editing ? editHtml(n) : noteHtml(n, api)).join("")}
      </ol>`}
      ${older.length ? `
        <button class="btn btn--ghost ekort__older" data-show-older aria-expanded="${!!api._cardShowOlder}">
          ${icon(api._cardShowOlder ? "chevron-up" : "chevron-down")}${api._cardShowOlder
            ? "Visa bara den här veckan"
            : `Visa tidigare veckor (${older.length} ${older.length === 1 ? "notering" : "noteringar"})`}
        </button>` : ""}
    </article>`;
}

function noteHtml(n, api) {
  const label = (api.settings.labels ?? []).find((l) => l.id === n.labelId);
  return `
    <li class="ekort__note ${n.positive ? "ekort__note--pos" : ""} ${n.kind === "insats" ? "ekort__note--insats" : ""}">
      <div class="ekort__note-meta">
        <time>${fmtDateTime(n.createdAt)}</time>
        <span class="ekort__note-teacher">${escapeHtml(teacherLabel(n))}</span>
        ${chipFor(n)}
        ${label ? `<span class="chip chip--label" style="--label-color:${escapeHtml(label.color)}">${escapeHtml(label.name)}</span>` : ""}
        ${n.followUp ? `<span class="chip chip--follow">${icon("flag")}Uppföljning</span>` : ""}
        ${n.lesson ? `<span class="ekort__note-lesson">${escapeHtml(n.lesson.title || n.lesson.subjectId || "")} ${escapeHtml(n.lesson.start ?? "")}–${escapeHtml(n.lesson.end ?? "")}</span>` : ""}
      </div>
      ${n.text ? `<p class="ekort__note-text">${escapeHtml(n.text)}</p>` : ""}
      ${n.kind === "insats" && n.helped ? `<p class="ekort__note-helped">Hjälpte det: ${escapeHtml(n.helped)}</p>` : ""}
      <div class="ekort__note-actions">
        <button class="btn btn--ghost" data-flag="${n.id}" title="Växla uppföljning">${icon("flag")}</button>
        <button class="btn btn--ghost" data-editnote="${n.id}" title="Ändra text">${icon("pen")}</button>
        <button class="btn btn--ghost" data-delnote="${n.id}" title="Radera">${icon("x")}</button>
      </div>
    </li>`;
}

function editHtml(n) {
  return `
    <li class="ekort__note ekort__note--editing">
      <form data-editnoteform="${n.id}">
        <textarea name="text" rows="3">${escapeHtml(n.text ?? "")}</textarea>
        <div class="ekort__note-actions">
          <button class="btn btn--primary" type="submit">Spara</button>
          <button class="btn" type="button" data-editcancel>Avbryt</button>
        </div>
      </form>
    </li>`;
}

function chipFor(n) {
  if (n.kind === "typ") {
    const t = noteTypeById(n.typeId);
    return `<span class="chip ${t?.positive ? "chip--pos" : ""}">${escapeHtml(t?.name ?? "Notering")}</span>`;
  }
  if (n.kind === "insats") return `<span class="chip chip--insats">Insats</span>`;
  return `<span class="chip">Anteckning</span>`;
}

/** Ren text för uttag under vald period — enkel att klistra in var som helst. */
function buildExport(student, api) {
  const from = new Date(`${api._cardFrom}T00:00:00`).getTime();
  const to = new Date(`${api._cardTo}T23:59:59`).getTime();
  const rows = api.notes
    .filter((n) => n.studentId === student.id && n.createdAt >= from && n.createdAt <= to)
    .sort((a, b) => a.createdAt - b.createdAt);
  const name = studentLabel(student, { initials: api.initials });
  const lines = [
    `Uttag: ${name} — ${api._cardFrom} till ${api._cardTo}`,
    `${rows.length} noteringar`,
    "",
    ...rows.map((n) => {
      const when = new Date(n.createdAt).toLocaleString("sv-SE", {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      });
      const kind = n.kind === "typ"
        ? (noteTypeById(n.typeId)?.name ?? "Notering")
        : n.kind === "insats" ? "Insats" : "Anteckning";
      const label = (api.settings.labels ?? []).find((l) => l.id === n.labelId)?.name;
      const parts = [
        `${when}  ${kind}${n.positive ? " (+)" : ""}`,
        label ? `[${label}]` : "",
        n.followUp ? "[uppföljning]" : "",
        n.lesson ? `(${n.lesson.title || n.lesson.subjectId || "lektion"} ${n.lesson.start}–${n.lesson.end})` : "",
        n.text ? `— ${n.text}` : "",
        n.kind === "insats" && n.helped ? `— hjälpte det: ${n.helped}` : "",
      ].filter(Boolean);
      return parts.join(" ");
    }),
  ];
  return lines.join("\n");
}
