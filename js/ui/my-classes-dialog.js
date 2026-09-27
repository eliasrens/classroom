/**
 * "KLASSER" — dialog (issue #102, utbyggd i #108; samma mönster som Mina ämnen #81).
 *
 * En rad per klass (alla klasser, sorterade på namn):
 *   [kryssruta "min klass"]  Klassnamn            Öppna | Vald
 * Kryssrutorna sparar lärarens PRIVATA val direkt
 * (teachers/{uid}/settings/classes → mine, js/lib/my-classes.js) — ingen
 * Spara-knapp, bara "Klar". "Öppna" byter aktiv klass och stänger.
 * "+ Ny klass" längst ner visar ett inline-fält (ingen prompt()).
 *
 * Inget ikryssat = inget val → alla klasser visas (standardläget).
 * Nås från klassväljaren i topbaren ("Alla klasser…") och från
 * Översikt › Inställningar ("Välj mina klasser…").
 */

import { icon } from "../lib/icons.js";
import { createClass } from "../data/classes.js";
import { saveMyClasses, sortClasses } from "../lib/my-classes.js";
import { setActiveClass } from "./class-picker.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let current = null;

export function closeMyClassesDialog() {
  if (!current) return;
  window.removeEventListener("keydown", current.onKey, true);
  current.off?.();
  current.root.remove();
  const { resolve: done, opener } = current;
  current = null;
  // Tillbaka till knappen/väljaren som öppnade dialogen (om den finns kvar).
  if (opener?.isConnected) opener.focus?.();
  done?.();
}

/**
 * openMyClassesDialog({ data, store, classes, mine })
 *  classes: alla klasser ({ id, name }) — startlistan; dialogen följer
 *    sedan klasserna live (t.ex. en klass som läggs till här).
 *  mine: lärarens nuvarande val ([id, …] eller null = inget val).
 * Sparar via js/lib/my-classes.js. Promise löses när dialogen stängts.
 */
export function openMyClassesDialog({ data, store, classes, mine = null }) {
  closeMyClassesDialog();
  const opener = document.activeElement;
  const chosen = new Set(mine ?? []);
  let list = classes;

  const root = document.createElement("div");
  root.className = "ms-modal mc-modal teacher-only";
  root.innerHTML = `
    <div class="ms-dialog mc-dialog" role="dialog" aria-modal="true" aria-labelledby="mc-dialog-title">
      <h2 id="mc-dialog-title">${icon("users")} Klasser</h2>
      <p class="ms-lead">Kryssa i klasserna du undervisar i — de visas i klassväljaren.</p>
      <div class="ms-list mc-list"></div>
      <p class="ms-count mc-status" aria-live="polite"></p>
      <div class="ms-actions mc-actions">
        <button class="btn btn--ghost mc-add" type="button" data-add>${icon("plus")}<span>Ny klass</span></button>
        <form class="mc-new" hidden novalidate>
          <label class="sr-only" for="mc-new-name">Ny klass</label>
          <input id="mc-new-name" type="text" autocomplete="off" maxlength="40" placeholder="Klassens namn, t.ex. 4A">
          <button class="btn" type="submit">Lägg till</button>
        </form>
        <button class="btn btn--primary" type="button" data-done>Klar</button>
      </div>
    </div>`;
  document.body.append(root);

  const listEl = root.querySelector(".mc-list");
  const statusEl = root.querySelector(".mc-status");
  const newForm = root.querySelector(".mc-new");
  const newInput = newForm.querySelector("input");
  const addBtn = root.querySelector("[data-add]");

  function renderRows() {
    const activeId = store.get().classId ?? null;
    // Behåll fokus på samma rad när listan ritas om (live-uppdatering).
    const focusKey = document.activeElement?.closest?.(".mc-row")?.dataset.row;
    const focusOpen = document.activeElement?.matches?.("[data-open]");
    const sorted = sortClasses(list);
    listEl.innerHTML = sorted.length
      ? sorted.map((c) => `<div class="ms-row mc-row" data-row="${esc(c.id)}">
          <label class="mc-row__pick">
            <input type="checkbox" data-class-id="${esc(c.id)}" ${chosen.has(c.id) ? "checked" : ""}
              aria-label="${esc(c.name)} — min klass">
            <span class="mc-row__name">${esc(c.name)}</span>
          </label>
          ${c.id === activeId
            ? `<span class="mc-row__active">Vald</span>`
            : `<button class="btn btn--ghost mc-row__open" type="button" data-open="${esc(c.id)}"
                aria-label="Öppna ${esc(c.name)}">Öppna</button>`}
        </div>`).join("")
      : `<p class="ms-lead">Inga klasser ännu.</p>`;
    if (focusKey) {
      const row = [...listEl.querySelectorAll(".mc-row")].find((r) => r.dataset.row === focusKey);
      const target = focusOpen ? row?.querySelector("[data-open]") : null;
      (target ?? row?.querySelector("input"))?.focus();
    }
  }

  const boxes = () => [...listEl.querySelectorAll("[data-class-id]")];

  // Sparningar köas så att snabba kryss sparas i rätt ordning.
  let saving = Promise.resolve();
  function save() {
    // Bara klasser som finns sparas — borttagna klasser städas bort här.
    // Inget ikryssat betyder "inget val" (alla visas).
    const ids = boxes().filter((b) => b.checked).map((b) => b.dataset.classId);
    saving = saving
      .then(() => saveMyClasses(data, ids))
      .then(() => {
        statusEl.textContent = ids.length ? "Sparat." : "Sparat — inget valt, alla klasser visas.";
      })
      .catch((err) => {
        statusEl.textContent = "Kunde inte spara.";
        console.warn("[mina klasser] kunde inte spara:", err);
      });
    return saving;
  }

  listEl.addEventListener("change", (e) => {
    const box = e.target.closest("[data-class-id]");
    if (!box) return;
    if (box.checked) chosen.add(box.dataset.classId);
    else chosen.delete(box.dataset.classId);
    void save();
  });

  listEl.addEventListener("click", (e) => {
    const id = e.target.closest("[data-open]")?.dataset.open;
    if (!id) return;
    setActiveClass(store, id);
    closeMyClassesDialog();
  });

  // ---- Ny klass (inline, ingen prompt()) ----
  function showNew(show) {
    newForm.hidden = !show;
    addBtn.hidden = show;
    if (show) { newInput.value = ""; newInput.focus(); }
    else addBtn.focus();
  }
  addBtn.addEventListener("click", () => showNew(true));

  let adding = false;
  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = newInput.value.trim();
    if (!name) { newInput.focus(); return; }
    if (adding) return;
    adding = true;
    try {
      // Dubblettsäkert: samma namn återanvänder befintlig klass (data/classes.js).
      const id = await createClass(data, name);
      if (!id) return;
      if (!list.some((c) => c.id === id)) list = [...list, { id, name }];
      // Har läraren valt sina klasser kommer den nya klassen med automatiskt.
      if (chosen.size > 0 && !chosen.has(id)) {
        chosen.add(id);
        renderRows();
        await save();
      } else {
        renderRows();
      }
      newForm.hidden = true;
      addBtn.hidden = false;
      const row = [...listEl.querySelectorAll(".mc-row")].find((r) => r.dataset.row === id);
      (row?.querySelector("[data-open]") ?? row?.querySelector("input") ?? addBtn).focus();
    } catch (err) {
      statusEl.textContent = "Kunde inte lägga till klassen.";
      console.warn("[klasser] kunde inte skapa klass:", err);
    } finally {
      adding = false;
    }
  });

  root.querySelector("[data-done]").addEventListener("click", closeMyClassesDialog);

  // Dialogen äger tangenterna (samma mönster som Mina ämnen): lägenas
  // genvägar får inte slå igenom medan läraren kryssar. Är fältet för ny
  // klass öppet avbryter Esc bara fältet; annars stänger Esc dialogen.
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      if (!newForm.hidden) showNew(false);
      else closeMyClassesDialog();
      return;
    }
    if (e.target instanceof Node && root.contains(e.target)) e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  root.addEventListener("mousedown", (e) => { if (e.target === root) closeMyClassesDialog(); });

  renderRows();
  // Följ klasserna live medan dialogen är öppen (ny klass här eller på en
  // annan enhet). watch anropar direkt med nuläget — samma lista som ovan.
  const off = data.watch?.("classes", (docs) => { list = docs; renderRows(); });

  (boxes()[0] ?? addBtn).focus();
  return new Promise((resolve) => { current = { root, onKey, resolve, opener, off }; });
}
