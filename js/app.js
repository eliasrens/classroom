/**
 * APP-BOOTSTRAP — lösenordsvägg först, sedan store + datalager +
 * router + topbar. Enda modulen som rör det globala DOM-skalet.
 *
 * INGET av appen (lägen, klassval, data) initieras förrän auth
 * säger 'signedIn' — det är lösenordsväggen (se js/auth.js).
 */

import { store } from "./store.js";
import { createAuth } from "./auth.js";
import { renderLogin } from "./ui/login.js";
import { createDataLayer } from "./data/datalayer.js";
import { createRouter } from "./router.js";
import { MODES } from "./modes/registry.js";
import { initClassPicker, ACTIVE_CLASS_KEY } from "./ui/class-picker.js";

const $ = (sel) => document.querySelector(sel);
const appEl = $("#app");
const gateEl = $("#auth-gate");

/** 'student' om fönstret visar elevskärm (#/elev/…) — behövs redan före login. */
const currentView = () => (/^#\/?elev(\/|$)/.test(location.hash) ? "student" : "teacher");

// ---- Lösenordsvägg ----

const auth = createAuth();
let appStarted = false;

auth.subscribe((a) => {
  if (a.state === "signedIn") {
    gateEl.hidden = true;
    gateEl.innerHTML = "";
    appEl.hidden = false;
    if (!appStarted) { appStarted = true; startApp(); }
  } else if (a.state === "signedOut") {
    if (appStarted) { location.reload(); return; } // enklast: tillbaka till väggen rent
    appEl.hidden = true;
    document.documentElement.dataset.theme = currentView();
    renderLogin(gateEl, { auth, view: currentView() });
    gateEl.hidden = false;
  }
  // 'loading': båda ytorna hålls dolda — inget hinner blinka förbi väggen.
});

// Elevskärm som väntar på läraren: rendera om ifall vyn byts via hash.
window.addEventListener("hashchange", () => {
  if (auth.state === "signedOut" && !appStarted) {
    renderLogin(gateEl, { auth, view: currentView() });
  }
});

// ---- Själva appen (körs först efter inloggning) ----

function startApp() {
  const syncStatusEl = $("#sync-status");

  function renderSyncStatus(state) {
    syncStatusEl.dataset.state = state;
    syncStatusEl.textContent =
      { local: "Lokalt läge", online: "Synkad", offline: "Offline — synkar senare" }[state] ?? "";
    store.set({ syncState: state });
  }

  const data = createDataLayer({ onSyncState: renderSyncStatus });
  renderSyncStatus(data.syncState);

  // Återställ valt klass-id (delas mellan flikar/fönster)
  try {
    const saved = localStorage.getItem(ACTIVE_CLASS_KEY);
    if (saved) store.set({ classId: saved });
  } catch { /* lagring otillgänglig — kör vidare utan */ }

  // Elevskärmen (och andra flikar) följer lärarens klassbyte live.
  window.addEventListener("storage", (e) => {
    if (e.key === ACTIVE_CLASS_KEY) store.set({ classId: e.newValue || null });
  });

  // Lägesmeny
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

  // Klassval
  initClassPicker({ el: $("#class-picker"), store, data });

  // Elevskärm i eget fönster — ärver inloggningen (samma webbläsare/session).
  $("#open-student-view").addEventListener("click", () => {
    const { modeId } = store.get();
    window.open(`${location.pathname}#/elev/${modeId}`, "classroom-student-view");
  });

  // Utloggning (loggar ut alla fönster, även elevskärmen)
  $("#sign-out").addEventListener("click", () => void auth.signOut());

  // Router
  const router = createRouter({ store, data, viewEl: $("#view") });
  router.start();
}
