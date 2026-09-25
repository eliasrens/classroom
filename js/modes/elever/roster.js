/**
 * Flik: ELEVER — lägg in, redigera, arkivera, kortkommandon, initialer.
 *
 * INTEGRITET: endast FÖRNAMN matas in och lagras. Det finns inget
 * efternamnsfält, och vid inklistring av en lista kapas allt efter
 * första mellanslaget. Delar två elever förnamn skiljs de åt med den
 * valfria korta särskiljaren (tag) — aldrig med efternamn.
 */

import { icon } from "../../lib/icons.js";
import { initialsFor } from "../../lib/names.js";
import {
  studentsPath, activeStudents, escapeHtml, isAssignableKey,
  saveNameDisplay,
} from "./shared.js";

export function renderRoster(el, api) {
  api._rosterCaptureOff?.(); // släpp ev. pågående tangentfångst från förra omritningen
  api._rosterCaptureOff = null;
  const active = activeStudents(api.students);
  const archived = api.students
    .filter((s) => s.active === false)
    .sort((a, b) => String(a.firstName).localeCompare(String(b.firstName), "sv"));

  // Förnamn som delas av flera → föreslå särskiljare
  const nameCount = new Map();
  for (const s of active) {
    const k = String(s.firstName).toLocaleLowerCase("sv");
    nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  }
  const duplicates = active.filter(
    (s) => nameCount.get(String(s.firstName).toLocaleLowerCase("sv")) > 1 && !s.tag
  );

  const editingId = api._rosterEditing ?? null;
  const capturingId = api._rosterCapturing ?? null;

  el.innerHTML = `
    <section class="roster">
      <div class="roster__top card">
        <form class="roster__add" data-add>
          <label class="sr-only" for="roster-name">Förnamn</label>
          <input id="roster-name" type="text" placeholder="Elevens förnamn" autocomplete="off" required>
          <button class="btn btn--primary" type="submit">${icon("plus")}Lägg till</button>
        </form>
        <label class="roster__initials">
          <input type="checkbox" data-initials ${api.initials ? "checked" : ""}>
          Visa initialer i stället för förnamn (gäller hela lärarvyn)
        </label>
        <p class="roster__local-note">Elevlistan och noteringarna sparas <strong>bara på den här
          datorn</strong> — ingenting om enskilda elever lämnar den. Det som ska sparas
          långsiktigt dokumenteras i skolans system.</p>
      </div>

      <details class="roster__paste card">
        <summary>${icon("plus")} Klistra in en lista</summary>
        <p class="roster__paste-hint">En elev per rad. <strong>Endast förnamnet sparas</strong> —
          allt efter första mellanslaget ignoreras (integritet).</p>
        <textarea data-paste rows="6" placeholder="Erik&#10;Anna-Lena&#10;Sam"></textarea>
        <button class="btn btn--primary" data-import>Lägg till alla</button>
      </details>

      ${duplicates.length > 0 ? `
        <p class="roster__dupes">${icon("flag")} ${duplicates.map((s) => escapeHtml(s.firstName)).join(", ")}
          delar förnamn med någon annan — sätt en kort särskiljare (bokstav/siffra/emoji) så går de
          att skilja åt. Efternamn behövs aldrig.</p>` : ""}

      ${active.length === 0 ? `<p class="roster__empty">Inga elever ännu.</p>` : `
      <ul class="roster__list card">
        ${active.map((s) => rowHtml(s, api, { editingId, capturingId })).join("")}
      </ul>`}

      ${archived.length > 0 ? `
        <details class="roster__archived">
          <summary>Arkiverade elever (${archived.length})</summary>
          <ul class="roster__list card">
            ${archived.map((s) => `
              <li class="roster__row roster__row--archived" data-id="${s.id}">
                <span class="roster__name">${api.label(s)}</span>
                <span class="roster__spacer"></span>
                <button class="btn btn--ghost" data-restore="${s.id}">Återställ</button>
              </li>`).join("")}
          </ul>
        </details>` : ""}
    </section>`;

  const path = studentsPath(api.cid);

  // ---- Lägg till (en i taget) ----
  el.querySelector("[data-add]").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = el.querySelector("#roster-name");
    const firstName = onlyFirstName(input.value);
    if (!firstName) return;
    void api.data.put(path, { firstName, active: true }).then(() => {
      input.value = "";
      input.focus();
      api.refresh();
    });
  });

  // ---- Klistra in lista ----
  el.querySelector("[data-import]")?.addEventListener("click", async () => {
    const ta = el.querySelector("[data-paste]");
    const names = ta.value.split(/[\n,;]+/).map(onlyFirstName).filter(Boolean);
    for (const firstName of names) {
      await api.data.put(path, { firstName, active: true });
    }
    ta.value = "";
    api.toast(`${names.length} elever tillagda (endast förnamn).`);
    api.refresh();
  });

  // ---- Initial-toggle ----
  el.querySelector("[data-initials]").addEventListener("change", (e) => {
    void saveNameDisplay(api.data, api.cid, e.target.checked);
  });

  // ---- Radåtgärder ----
  el.querySelector(".roster__list")?.addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) { api._rosterEditing = edit.dataset.edit; api.refresh(); return; }

    const cancel = e.target.closest("[data-cancel]");
    if (cancel) { api._rosterEditing = null; api.refresh(); return; }

    const archive = e.target.closest("[data-archive]");
    if (archive) {
      void api.data.patch(path, archive.dataset.archive, { active: false, hotkey: null })
        .then(() => api.refresh());
      return;
    }

    const keyBtn = e.target.closest("[data-assign]");
    if (keyBtn) { api._rosterCapturing = keyBtn.dataset.assign; api.refresh(); return; }

    const clearKey = e.target.closest("[data-clearkey]");
    if (clearKey) {
      void api.data.patch(path, clearKey.dataset.clearkey, { hotkey: null }).then(() => api.refresh());
    }
  });

  el.querySelector(".roster")?.addEventListener("click", (e) => {
    const restore = e.target.closest("[data-restore]");
    if (restore) void api.data.patch(path, restore.dataset.restore, { active: true }).then(() => api.refresh());
  });

  // ---- Spara inline-redigering ----
  el.querySelector("[data-editform]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = e.target.dataset.editform;
    const firstName = onlyFirstName(e.target.querySelector("[name=firstName]").value);
    const tag = e.target.querySelector("[name=tag]").value.trim().slice(0, 4);
    if (!firstName) return;
    void api.data.patch(path, id, { firstName, tag: tag || null }).then(() => {
      api._rosterEditing = null;
      api.refresh();
    });
  });

  // ---- Tangentfångst för kortkommando ----
  if (capturingId) {
    const onCapture = (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener("keydown", onCapture, true);
      if (e.key === "Escape") { api._rosterCapturing = null; api.refresh(); return; }
      if (e.key === "Backspace" || e.key === "Delete") {
        api._rosterCapturing = null;
        void api.data.patch(path, capturingId, { hotkey: null }).then(() => api.refresh());
        return;
      }
      const key = e.key.toLowerCase();
      if (!isAssignableKey(key) || e.ctrlKey || e.metaKey || e.altKey) {
        api.toast("Välj en vanlig bokstav eller siffra (utan Ctrl/Alt).");
        window.addEventListener("keydown", onCapture, true);
        return;
      }
      const taken = activeStudents(api.students).find((s) => s.hotkey === key && s.id !== capturingId);
      if (taken) {
        // KROCK: appen gissar aldrig — läraren väljer en annan tangent.
        api.toast(`Tangenten "${key}" används redan av ${taken.firstName} — välj en annan.`);
        window.addEventListener("keydown", onCapture, true);
        return;
      }
      api._rosterCapturing = null;
      void api.data.patch(path, capturingId, { hotkey: key }).then(() => api.refresh());
    };
    window.addEventListener("keydown", onCapture, true);
    api._rosterCaptureOff = () => window.removeEventListener("keydown", onCapture, true);
  }
}

function rowHtml(s, api, { editingId, capturingId }) {
  if (s.id === editingId) {
    return `
      <li class="roster__row" data-id="${s.id}">
        <form class="roster__edit" data-editform="${s.id}">
          <input name="firstName" value="${escapeHtml(s.firstName)}" aria-label="Förnamn" required>
          <input name="tag" value="${escapeHtml(s.tag ?? "")}" aria-label="Särskiljare"
            placeholder="Särskiljare" maxlength="4">
          <button class="btn btn--primary" type="submit">Spara</button>
          <button class="btn" type="button" data-cancel>Avbryt</button>
        </form>
      </li>`;
  }
  return `
    <li class="roster__row" data-id="${s.id}">
      <span class="roster__name">${api.label(s)}</span>
      <span class="roster__initials-preview" title="Initialer (reservläget)">${escapeHtml(initialsFor(s.firstName))}${s.tag ? ` ${escapeHtml(s.tag)}` : ""}</span>
      <span class="roster__spacer"></span>
      ${s.id === capturingId
        ? `<span class="roster__capture">Tryck en tangent… (Esc avbryter, Backspace tar bort)</span>`
        : s.hotkey
          ? `<button class="btn btn--ghost roster__keybtn" data-assign="${s.id}"
               title="Byt tangent">${icon("keyboard")}<kbd>${escapeHtml(s.hotkey)}</kbd></button>
             <button class="btn btn--ghost btn--icon" data-clearkey="${s.id}"
               title="Ta bort tangent" aria-label="Ta bort tangent">${icon("x")}</button>`
          : `<button class="btn btn--ghost roster__keybtn roster__keybtn--none" data-assign="${s.id}"
               title="Frivilligt: tilldela en tangent för snabbnotering">${icon("keyboard")}</button>`}
      <button class="btn btn--ghost" data-edit="${s.id}">${icon("pen")}Ändra</button>
      <button class="btn btn--ghost" data-archive="${s.id}">${icon("archive")}Arkivera</button>
    </li>`;
}

/** "Erik Svensson" → "Erik" — endast förnamn lagras någonsin. */
function onlyFirstName(raw) {
  return String(raw ?? "").trim().split(/\s+/)[0] ?? "";
}
