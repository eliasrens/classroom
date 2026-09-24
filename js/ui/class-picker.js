/**
 * KLASSVAL — dropdown i topbaren (4A/4B/…) + "lägg till ny klass".
 *
 * Vald klass skrivs till store (classId) och persisteras i
 * localStorage så att valet överlever omladdning och delas med
 * elevskärmsfönstret (som följer via storage-eventet, se app.js).
 */

import { createClass } from "../data/classes.js";

export const ACTIVE_CLASS_KEY = "classroom:activeClassId";

const ADD_VALUE = "__add__";

export function initClassPicker({ el, store, data }) {
  el.innerHTML = `
    <label class="sr-only" for="class-select">Klass</label>
    <select id="class-select" title="Välj klass" autocomplete="off"></select>`;
  const select = el.querySelector("select");
  let classes = [];

  function render() {
    const { classId } = store.get();
    select.innerHTML = "";
    if (classes.length === 0) {
      select.append(new Option("Ingen klass", ""));
    } else if (!classId) {
      select.append(new Option("Välj klass…", ""));
    }
    for (const c of [...classes].sort((a, b) => a.name.localeCompare(b.name, "sv"))) {
      select.append(new Option(c.name, c.id, false, c.id === classId));
    }
    select.append(new Option("+ Ny klass…", ADD_VALUE));
    select.value = classId ?? "";
  }

  async function addClass() {
    const name = prompt("Klassens namn (t.ex. 4A):")?.trim();
    if (!name) { render(); return; }
    // Dubblettsäkert: samma namn återanvänder befintlig klass (data/classes.js).
    const id = await createClass(data, name);
    selectClass(id);
  }

  function selectClass(id) {
    try { localStorage.setItem(ACTIVE_CLASS_KEY, id ?? ""); } catch { /* privat läge etc. */ }
    store.set({ classId: id || null });
  }

  select.addEventListener("change", () => {
    if (select.value === ADD_VALUE) void addClass();
    else selectClass(select.value || null);
  });

  data.watch("classes", (docs) => {
    classes = docs;
    const { classId } = store.get();
    // Vald klass försvunnen (t.ex. borttagen på annan enhet): gå till
    // "Välj klass…" — ALDRIG tyst över till en annan riktig klass, där
    // vyerna (veckorytm, autosparning) annars skulle börja skriva (#31).
    if (classId && !classes.some((c) => c.id === classId)) selectClass(null);
    render();
  });

  store.subscribe(["classId"], render);
}
