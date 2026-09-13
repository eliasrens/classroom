/**
 * APP-BOOTSTRAP — kopplar ihop store, datalager, router och topbar.
 * Enda modulen som rör det globala DOM-skalet i index.html.
 */

import { store } from "./store.js";
import { createDataLayer } from "./data/datalayer.js";
import { createRouter } from "./router.js";
import { MODES } from "./modes/registry.js";
import { initClassPicker, ACTIVE_CLASS_KEY } from "./ui/class-picker.js";

const $ = (sel) => document.querySelector(sel);

// ---- Datalager + synkstatus i topbaren ----

const syncStatusEl = $("#sync-status");

function renderSyncStatus(state) {
  syncStatusEl.dataset.state = state;
  syncStatusEl.textContent =
    { local: "Lokalt läge", online: "Synkad", offline: "Offline — synkar senare" }[state] ?? "";
  store.set({ syncState: state });
}

const data = createDataLayer({ onSyncState: renderSyncStatus });
renderSyncStatus(data.syncState);

// ---- Återställ valt klass-id (delas mellan flikar/fönster) ----

try {
  const saved = localStorage.getItem(ACTIVE_CLASS_KEY);
  if (saved) store.set({ classId: saved });
} catch { /* lagring otillgänglig — kör vidare utan */ }

// Elevskärmen (och andra flikar) följer lärarens klassbyte live.
window.addEventListener("storage", (e) => {
  if (e.key === ACTIVE_CLASS_KEY) store.set({ classId: e.newValue || null });
});

// ---- Lägesmeny ----

const navEl = $("#mode-nav");
navEl.innerHTML = MODES
  .map((m) => `<a class="mode-nav__link" href="#/${m.id}" data-mode="${m.id}">
      <span aria-hidden="true">${m.icon}</span> ${m.title}</a>`)
  .join("");

store.subscribe(["modeId"], ({ modeId }) => {
  for (const link of navEl.querySelectorAll("a")) {
    if (link.dataset.mode === modeId) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
});

// ---- Klassval ----

initClassPicker({ el: $("#class-picker"), store, data });

// ---- Elevskärm i eget fönster (samma läge, elevvy) ----

$("#open-student-view").addEventListener("click", () => {
  const { modeId } = store.get();
  window.open(`${location.pathname}#/elev/${modeId}`, "classroom-student-view");
});

// ---- Router ----

const router = createRouter({ store, data, viewEl: $("#view") });
router.start();
