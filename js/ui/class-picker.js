/**
 * KLASSVAL — dropdown i topbaren (4A/4B/…).
 *
 * Vald klass skrivs till store (classId) och persisteras i
 * localStorage så att valet överlever omladdning och delas med
 * elevskärmsfönstret (som följer via storage-eventet, se app.js).
 *
 * Listan visar bara klasser (issue #108): mina klasser (#102) — eller alla
 * om läraren inte valt några — plus den aktiva klassen, som alltid syns.
 * Sist, efter en avdelare, EN post "Alla klasser…" som öppnar dialogen
 * Klasser (js/ui/my-classes-dialog.js): välj mina klasser, öppna vilken
 * klass som helst, lägg till ny klass.
 */

import {
  MY_CLASSES_DOC, myClassesPath, myClassIds, pickerClasses,
} from "../lib/my-classes.js";
import { openMyClassesDialog } from "./my-classes-dialog.js";

export const ACTIVE_CLASS_KEY = "classroom:activeClassId";

const ALL_VALUE = "__all__"; // "Alla klasser…" → dialogen Klasser

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
  let myDoc = null; // Mina klasser — lärarens privata val (issue #102)

  function render() {
    const { classId } = store.get();
    select.innerHTML = "";
    if (classes.length === 0) {
      select.append(new Option("Ingen klass", ""));
    } else if (!classId) {
      select.append(new Option("Välj klass…", ""));
    }
    for (const c of pickerClasses(classes, myClassIds(myDoc), classId)) {
      select.append(new Option(c.name, c.id, false, c.id === classId));
    }
    // En native <select> blir lika bred som sitt längsta alternativ. Stängd
    // ska väljaren vara exakt lika bred som innan #108 (då "+ Ny klass…"
    // låg sist) — mät med den texten och lås bredden, så att topbaren ser
    // ut precis som förut (annars trängs lägesmenyn ihop vid 1280 px).
    const measure = new Option("+ Ny klass…", "");
    select.append(measure);
    select.style.width = "";
    const width = select.offsetWidth;
    measure.remove();
    // Avdelare: <hr> i <select> ritas som en linje i Chrome 119+. Äldre
    // webbläsare hoppar tyst över elementet — ingen synlig rest.
    if (classes.length > 0) select.append(document.createElement("hr"));
    select.append(new Option("Alla klasser…", ALL_VALUE));
    if (width) select.style.width = `${width}px`;
    select.value = classId ?? "";
  }

  const selectClass = (id) => {
    setActiveClass(store, id);
    render(); // samma klass igen ger ingen store-ändring — rita om ändå
  };

  select.addEventListener("change", () => {
    if (select.value === ALL_VALUE) {
      render(); // väljaren visar den aktiva klassen medan dialogen är öppen
      void openMyClassesDialog({ data, store, classes, mine: myClassIds(myDoc) });
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
