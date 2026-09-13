/**
 * "BRA JOBBAT" — snabbknapp nåbar från ANDRA lägen.
 *
 * Låter läraren uppmärksamma en elev i stunden — utan att byta till
 * Morgonskärmen. Skriver till samma namntavlelista (morningScreen i
 * klassens inställningar, js/lib/morning.js), så morgonskärmen och
 * elevskärmen speglar ändringen direkt via datalagret.
 *
 * Visas bara i lärarvyn och bara i andra lägen än Morgonskärmen (där
 * finns namntavlan redan i panelen). En flytande knapp nere till
 * vänster som fäller ut en liten popover med klassens elevlista.
 */

import { icon } from "../lib/icons.js";
import { studentLabel } from "../lib/names.js";
import { loadMorning, saveMorning, togglePraiseStudent } from "../lib/morning.js";

export function initPraise({ store, data }) {
  const wrap = document.createElement("div");
  wrap.className = "praise teacher-only";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="praise__pop card" hidden role="dialog" aria-label="Bra jobbat">
      <header class="praise__head">
        <strong>${icon("star")} Bra jobbat!</strong>
        <button class="btn btn--ghost btn--icon praise__clear" title="Töm namntavlan" aria-label="Töm namntavlan">${icon("trash")}</button>
      </header>
      <div class="praise__list" role="group" aria-label="Elever"></div>
      <div class="praise__free">
        <input class="praise__free-input" type="text" placeholder="Fritext…" autocomplete="off" aria-label="Fritext">
        <button class="btn btn--icon praise__free-btn" title="Lägg till" aria-label="Lägg till fritext">${icon("plus")}</button>
      </div>
      <p class="praise__hint">Syns direkt på morgonskärmen och elevskärmen.</p>
    </div>
    <button class="praise__fab" aria-expanded="false" title="Kryssa Bra jobbat på en elev">
      ${icon("star")}<span>Bra jobbat</span>
    </button>`;
  document.getElementById("app").appendChild(wrap);

  const fab = wrap.querySelector(".praise__fab");
  const pop = wrap.querySelector(".praise__pop");
  const list = wrap.querySelector(".praise__list");
  const freeInput = wrap.querySelector(".praise__free-input");

  const classId = () => store.get().classId;

  async function refresh() {
    const id = classId();
    if (!id) { list.innerHTML = `<p class="praise__hint">Välj en klass först.</p>`; return; }
    const [students, settings, disp] = await Promise.all([
      data.list(`classes/${id}/students`),
      loadMorning(data, id),
      data.get(`classes/${id}/settings`, "display"),
    ]);
    const initials = disp?.value?.nameDisplay === "initials";
    const active = students.filter((s) => s.active !== false)
      .sort((a, b) => String(a.firstName).localeCompare(String(b.firstName), "sv"));
    if (!active.length) {
      list.innerHTML = `<p class="praise__hint">Inga elever i klassen ännu.</p>`;
      return;
    }
    list.innerHTML = active.map((s) => {
      const on = settings.praise.some((p) => p.kind === "student" && p.studentId === s.id);
      return `<label class="praise__item">
        <input type="checkbox" data-student="${esc(s.id)}"${on ? " checked" : ""}>
        <span>${esc(studentLabel(s, { initials }))}</span>
      </label>`;
    }).join("");
  }

  function setOpen(open) {
    pop.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    if (open) refresh();
  }

  fab.addEventListener("click", () => setOpen(pop.hidden));
  list.addEventListener("change", async (e) => {
    const cb = e.target.closest("input[data-student]");
    if (!cb) return;
    await togglePraiseStudent(data, classId(), cb.dataset.student);
  });
  const addFree = async () => {
    const id = classId();
    const text = freeInput.value.trim();
    if (!id || !text) return;
    const s = await loadMorning(data, id);
    s.praise.push({ id: crypto.randomUUID?.() ?? String(Date.now()), kind: "free", text });
    s.showNametavla = true;
    freeInput.value = "";
    await saveMorning(data, id, s);
  };
  wrap.querySelector(".praise__free-btn").addEventListener("click", addFree);
  freeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addFree(); } });
  wrap.querySelector(".praise__clear").addEventListener("click", async () => {
    const id = classId();
    if (!id) return;
    const s = await loadMorning(data, id);
    s.praise = [];
    await saveMorning(data, id, s);
    refresh();
  });

  // Stäng vid klick utanför / Esc
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !wrap.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) setOpen(false); });

  // Synlighet: bara lärarvy, bara i ANDRA lägen än morgonskärmen.
  store.subscribe(["view", "modeId", "classId"], ({ view, modeId }) => {
    const show = view === "teacher" && modeId !== "morgon";
    wrap.hidden = !show;
    if (!show) setOpen(false);
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
