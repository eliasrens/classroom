/**
 * SNABBANTECKNING — liten diskret ruta som öppnas med F9 i ALLA lägen
 * (lärarens minnesstöd, Läge 4). Välj elev (skriv några bokstäver
 * eller elevens tilldelade tangent), skriv, spara med Enter eller
 * Ctrl+Enter, stäng med Esc.
 *
 * Anteckningen får automatiskt datum, tid och pågående lektion —
 * läraren fyller aldrig i det. Frivillig egen etikett (ett fält +
 * Enter skapar en ny).
 *
 * INTEGRITETSSPÄRR: rutan finns ÖVER HUVUD TAGET inte i ett fönster
 * som visar elevvyn — den öppnas inte där, och växlar fönstret till
 * elevvy stängs den omedelbart (den kan aldrig "fastna" på
 * elevskärmen).
 */

import { icon } from "../lib/icons.js";
import { studentLabel } from "../lib/names.js";
import {
  studentsPath, activeStudents, escapeHtml, createNote,
  loadModeSettings, saveModeSettings, loadNameDisplay, LABEL_COLORS,
} from "../modes/elever/shared.js";

export const QUICK_NOTE_KEY = "F9";

export function initQuickNote({ store, data }) {
  let root = null;        // DOM-roten när rutan är öppen
  let students = [];
  let settings = null;
  let initials = false;
  let selected = null;    // valt elevdokument
  let labelId = null;

  const isStudentWindow = () =>
    store.get().view === "student" ||
    document.documentElement.dataset.theme === "student";

  // Stäng OMEDELBART om fönstret växlar till elevvy (spärren)
  store.subscribe(["view"], ({ view }) => {
    if (view === "student") close();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== QUICK_NOTE_KEY) return;
    e.preventDefault();
    if (root) { close(); return; }
    void open();
  });

  async function open() {
    if (isStudentWindow()) return; // aldrig på elevskärmen
    const { classId } = store.get();
    selected = null;
    labelId = null;
    root = document.createElement("div");
    root.className = "quick-note";
    root.dataset.open = "true";
    document.body.append(root);

    if (!classId) {
      root.innerHTML = `<div class="quick-note__box card">
        <p>Ingen klass vald — välj klass i topbaren först.</p>
        <p class="quick-note__hint">Esc stänger.</p></div>`;
      bindGlobalKeys();
      return;
    }

    [students, settings, initials] = await Promise.all([
      data.list(studentsPath(classId)).then(activeStudents),
      loadModeSettings(data, classId),
      loadNameDisplay(data, classId),
    ]);
    if (!root) return; // hann stängas
    render();
  }

  function close() {
    root?.remove();
    root = null;
  }

  const label = (s) => escapeHtml(studentLabel(s, { initials }));

  function render(filter = "") {
    if (!root) return;
    const q = filter.trim().toLocaleLowerCase("sv");
    let matches = students.filter((s) =>
      String(s.firstName).toLocaleLowerCase("sv").startsWith(q));
    // Elevens tilldelade tangent: ett enda tecken som träffar en hotkey
    // lägger den eleven först.
    if (q.length === 1) {
      const byKey = students.find((s) => s.hotkey === q);
      if (byKey) matches = [byKey, ...matches.filter((s) => s.id !== byKey.id)];
    }

    root.innerHTML = `
      <div class="quick-note__box card" role="dialog" aria-label="Snabbanteckning">
        <header class="quick-note__head">
          <strong>${icon("pen")} Snabbanteckning</strong>
          <span class="quick-note__hint">Esc stänger · Enter sparar</span>
        </header>

        ${selected ? `
          <div class="quick-note__student">
            <span>${label(selected)}</span>
            <button class="btn btn--ghost" data-change>Byt elev</button>
          </div>

          <textarea data-text rows="3" placeholder="Vad hände? Datum, tid och lektion sätts automatiskt."></textarea>

          <div class="quick-note__labels">
            ${(settings.labels ?? []).map((l) => `
              <button class="chip chip--label ${l.id === labelId ? "chip--active" : ""}"
                style="--label-color:${escapeHtml(l.color)}" data-label="${l.id}">${escapeHtml(l.name)}</button>`).join("")}
            <input data-newlabel type="text" placeholder="Ny etikett + Enter" autocomplete="off">
          </div>

          <p class="quick-note__reminder">Skriv sakligt, och om det som rör skolarbetet.</p>
          <div class="quick-note__actions">
            <button class="btn btn--primary" data-save>Spara</button>
          </div>` : `

          <input data-pick type="text" autocomplete="off"
            placeholder="Elev: skriv några bokstäver — eller elevens tangent">
          <div class="quick-note__matches">
            ${students.length === 0 ? `<p class="quick-note__hint">Inga elever i klassen ännu.</p>`
              : matches.slice(0, 12).map((s, i) => `
                <button class="chip ${i === 0 && q ? "chip--active" : ""}" data-pickstudent="${s.id}">
                  ${label(s)}${s.hotkey ? ` <kbd>${escapeHtml(s.hotkey)}</kbd>` : ""}</button>`).join("")}
          </div>`}
      </div>`;

    // ---- Händelser ----
    const pick = root.querySelector("[data-pick]");
    if (pick) {
      pick.value = filter;
      pick.focus();
      pick.setSelectionRange(filter.length, filter.length);
      pick.addEventListener("input", () => render(pick.value));
      pick.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const first = root.querySelector("[data-pickstudent]");
          if (first) selectStudent(first.dataset.pickstudent);
        }
      });
    }
    root.querySelectorAll("[data-pickstudent]").forEach((b) =>
      b.addEventListener("click", () => selectStudent(b.dataset.pickstudent)));

    root.querySelector("[data-change]")?.addEventListener("click", () => {
      selected = null;
      render();
    });

    const text = root.querySelector("[data-text]");
    if (text) {
      text.focus();
      text.addEventListener("keydown", (e) => {
        // Enter sparar (Shift+Enter = ny rad, Ctrl+Enter sparar också)
        if (e.key === "Enter" && (!e.shiftKey || e.ctrlKey)) {
          e.preventDefault();
          void save();
        }
      });
    }

    root.querySelectorAll("[data-label]").forEach((b) =>
      b.addEventListener("click", () => {
        labelId = labelId === b.dataset.label ? null : b.dataset.label;
        const txt = root.querySelector("[data-text]")?.value ?? "";
        render();
        const ta = root.querySelector("[data-text]");
        if (ta) { ta.value = txt; ta.focus(); }
      }));

    root.querySelector("[data-newlabel]")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const name = e.target.value.trim();
      if (!name) return;
      const newLabel = {
        id: `l${Date.now().toString(36)}`,
        name,
        color: LABEL_COLORS[(settings.labels?.length ?? 0) % LABEL_COLORS.length],
      };
      settings = { ...settings, labels: [...(settings.labels ?? []), newLabel] };
      labelId = newLabel.id;
      const { classId } = store.get();
      void saveModeSettings(data, classId, settings);
      const txt = root.querySelector("[data-text]")?.value ?? "";
      render();
      const ta = root.querySelector("[data-text]");
      if (ta) { ta.value = txt; ta.focus(); }
    });

    root.querySelector("[data-save]")?.addEventListener("click", () => void save());

    bindGlobalKeys();
  }

  function selectStudent(id) {
    selected = students.find((s) => s.id === id) ?? null;
    render();
  }

  async function save() {
    const text = root?.querySelector("[data-text]")?.value.trim();
    if (!selected || !text) return;
    const { classId } = store.get();
    await createNote(data, classId, {
      studentId: selected.id,
      kind: "text",
      text,
      labelId,
    });
    close();
  }

  function bindGlobalKeys() {
    root?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    });
  }
}
