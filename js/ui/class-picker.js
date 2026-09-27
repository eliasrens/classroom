/**
 * KLASSVAL — dropdown i topbaren (4A/4B/…) + "lägg till ny klass".
 *
 * Vald klass skrivs till store (classId) och persisteras i
 * localStorage så att valet överlever omladdning och delas med
 * elevskärmsfönstret (som följer via storage-eventet, se app.js).
 *
 * Mina klasser (issue #102): har läraren valt sina klasser visas bara
 * de — plus den aktiva klassen, som alltid syns. "Visa alla klasser…"
 * ritar tillfälligt om listan med alla klasser till nästa klassval,
 * utan att ändra valet. "Välj mina klasser…" öppnar dialogen.
 */

import { createClass } from "../data/classes.js";
import {
  MY_CLASSES_DOC, myClassesPath, myClassIds, filterClasses, withMyClass, saveMyClasses,
} from "../lib/my-classes.js";
import { openMyClassesDialog } from "./my-classes-dialog.js";

export const ACTIVE_CLASS_KEY = "classroom:activeClassId";

const ADD_VALUE = "__add__";
const SHOW_ALL_VALUE = "__all__";     // Mina klasser: visa tillfälligt alla
const SHOW_MINE_VALUE = "__mine__";   // … och tillbaka till bara mina
const CHOOSE_MINE_VALUE = "__choose__"; // öppna "Välj mina klasser"

/**
 * Sätt (eller rensa, id = null) vald klass: store + localStorage (som
 * elevskärmen följer). null → "Välj klass…". Används av klassväljaren och
 * av Översikten — ALDRIG för att tyst hoppa till en annan riktig klass (#31).
 */
export function setActiveClass(store, id) {
  try { localStorage.setItem(ACTIVE_CLASS_KEY, id ?? ""); } catch { /* privat läge etc. */ }
  store.set({ classId: id || null });
}

export function initClassPicker({ el, store, data }) {
  el.innerHTML = `
    <label class="sr-only" for="class-select">Klass</label>
    <select id="class-select" title="Välj klass" autocomplete="off"></select>`;
  const select = el.querySelector("select");
  let classes = [];
  let myDoc = null;      // Mina klasser — lärarens privata val (issue #102)
  let showAll = false;   // "Visa alla klasser…" — gäller till nästa klassval

  function render() {
    const { classId } = store.get();
    const mine = myClassIds(myDoc);
    const visible = showAll ? classes : filterClasses(classes, mine, { keep: [classId] });
    const hidden = classes.length - visible.length;
    select.innerHTML = "";
    if (classes.length === 0) {
      select.append(new Option("Ingen klass", ""));
    } else if (!classId) {
      select.append(new Option("Välj klass…", ""));
    }
    for (const c of [...visible].sort((a, b) => a.name.localeCompare(b.name, "sv"))) {
      select.append(new Option(c.name, c.id, false, c.id === classId));
    }
    const add = new Option("+ Ny klass…", ADD_VALUE);
    select.append(add);
    // En native <select> blir lika bred som sitt längsta alternativ. Mät
    // bredden UTAN Mina klasser-raderna och lås den, så att topbaren ser
    // ut precis som förut (annars trängs lägesmenyn ihop vid 1280 px).
    select.style.width = "";
    const width = select.offsetWidth;
    if (hidden > 0) select.add(new Option("Visa alla klasser…", SHOW_ALL_VALUE), add);
    else if (showAll && filterClasses(classes, mine, { keep: [classId] }).length < classes.length) {
      select.add(new Option("Visa bara mina klasser", SHOW_MINE_VALUE), add);
    }
    select.add(new Option("Välj mina klasser…", CHOOSE_MINE_VALUE), add);
    if (width) select.style.width = `${width}px`;
    select.value = classId ?? "";
  }

  async function addClass() {
    const name = prompt("Klassens namn (t.ex. 4A):")?.trim();
    if (!name) { render(); return; }
    // Dubblettsäkert: samma namn återanvänder befintlig klass (data/classes.js).
    const id = await createClass(data, name);
    // Har läraren valt sina klasser kommer den nya klassen med automatiskt.
    const mine = myClassIds(myDoc);
    if (id && mine) await saveMyClasses(data, withMyClass(mine, id));
    selectClass(id);
  }

  const selectClass = (id) => {
    showAll = false;
    setActiveClass(store, id);
    render(); // samma klass igen ger ingen store-ändring — rita om ändå
  };

  /** Rita om listan (visa alla / bara mina) och fäll ut den igen om det går. */
  function toggleAll(next) {
    showAll = next;
    render();
    try { select.showPicker?.(); } catch { /* kräver användargest — ok utan */ }
  }

  select.addEventListener("change", () => {
    if (select.value === ADD_VALUE) void addClass();
    else if (select.value === SHOW_ALL_VALUE) toggleAll(true);
    else if (select.value === SHOW_MINE_VALUE) toggleAll(false);
    else if (select.value === CHOOSE_MINE_VALUE) {
      render(); // väljaren visar den aktiva klassen medan dialogen är öppen
      void openMyClassesDialog({ data, classes, mine: myClassIds(myDoc) });
    }
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

  // Mina klasser — privat per lärare, kan ändras här, i Inställningar
  // eller på en annan enhet (issue #102).
  data.watch(myClassesPath(), (docs) => {
    myDoc = docs.find((d) => d.id === MY_CLASSES_DOC) ?? null;
    render();
  });

  store.subscribe(["classId"], render);
}
