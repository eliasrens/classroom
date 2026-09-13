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
import { MODES, isStudentMode } from "./modes/registry.js";
import { initClassPicker, ACTIVE_CLASS_KEY } from "./ui/class-picker.js";
import { initQuickNote } from "./ui/quick-note.js";
import { initStudentPanel } from "./ui/student-panel.js";
import { createSyncBus, isPreviewWindow, announceStudentScreen, watchStudentScreen } from "./sync.js";
import { icon } from "./lib/icons.js";

const $ = (sel) => document.querySelector(sel);
const appEl = $("#app");
const gateEl = $("#auth-gate");

// ---- Ljust/mörkt läge (lärarvyn; mörkt är standard) ----

const SCHEME_KEY = "classroom:ui:scheme";

function applyScheme(scheme) {
  if (scheme === "light") document.documentElement.dataset.scheme = "light";
  else delete document.documentElement.dataset.scheme;
  const btn = $("#toggle-scheme");
  if (btn) btn.innerHTML = icon(scheme === "light" ? "moon" : "sun");
}

try { applyScheme(localStorage.getItem(SCHEME_KEY)); } catch { applyScheme(null); }

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

  // ---- Sync lärare ↔ elevskärm (BroadcastChannel; se docs/SYNC.md) ----

  const bus = createSyncBus();
  const preview = isPreviewWindow(); // förhandsvisnings-iframen: följer, men är tyst

  // Sätt rätt vy INNAN sync-prenumerationerna nedan gör sina första
  // anrop — annars agerar ett elevfönster lärare i en blink vid start.
  store.set({ view: currentView() });

  // Lärarfönstret publicerar tillstånd — vid varje ändring och på begäran.
  const publishState = () => {
    const { view, modeId, classId } = store.get();
    if (view === "teacher") bus.publish("state", { modeId, classId });
  };
  store.subscribe(["modeId", "classId", "view"], publishState);
  bus.on("state:request", publishState);

  // Elevskärmen följer läraren — men ALDRIG in i lärarlägen (spärr).
  bus.on("state", ({ payload }) => {
    if (store.get().view !== "student") return;
    store.set({ classId: payload.classId ?? null });
    if (isStudentMode(payload.modeId) && payload.modeId !== store.get().modeId) {
      location.hash = `#/elev/${payload.modeId}`;
    }
  });

  // Nyöppnad elevskärm: fråga läraren vad som gäller just nu.
  if (currentView() === "student") bus.publish("state:request");

  // Presence: elevfönstret annonserar sig, lärarfönstret vaktar.
  let stopPresence = null;
  store.subscribe(["view"], ({ view }) => {
    stopPresence?.();
    stopPresence = null;
    if (preview) return;
    if (view === "student") stopPresence = announceStudentScreen(bus);
    else stopPresence = watchStudentScreen(bus, (open) => store.set({ studentOpen: open }));
  });

  // Hård spärr: lärarens verktygsfält får aldrig ens finnas i elevvyn
  // (CSS döljer det redan via data-theme — detta är bältet OCH hängslena).
  store.subscribe(["view"], ({ view }) => {
    $("#topbar").hidden = view === "student";
  });

  // Elevfönster på projektorn: dubbelklick växlar helskärm.
  if (!preview) {
    window.addEventListener("dblclick", () => {
      if (store.get().view !== "student") return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    });
  }

  // Lägesmeny
  const navEl = $("#mode-nav");
  navEl.innerHTML = MODES
    .map((m) => `<a class="mode-nav__link" href="#/${m.id}" data-mode="${m.id}">
        ${icon(m.icon)}<span>${m.title}</span></a>`)
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
  // Namngivet fönster: ett andra klick återanvänder/fokuserar samma skärm.
  function openStudentWindow() {
    const { modeId } = store.get();
    const target = isStudentMode(modeId) ? modeId : MODES[0].id;
    window.open(`${location.pathname}#/elev/${target}`, "classroom-student-view")?.focus();
  }

  const studentBtn = $("#open-student-view");
  studentBtn.insertAdjacentHTML("afterbegin", icon("monitor"));
  studentBtn.addEventListener("click", openStudentWindow);
  store.subscribe(["studentOpen"], ({ studentOpen }) => {
    studentBtn.dataset.open = String(!!studentOpen);
    studentBtn.title = studentOpen
      ? "Elevskärmen är öppen — klicka för att fokusera den"
      : "Öppna elevskärm i nytt fönster";
  });

  // Panel i lärarvyn: indikator + live-förhandsvisning + enskärmsläge.
  initStudentPanel({ store, openStudentWindow });

  // Ljust/mörkt läge i lärarvyn
  $("#toggle-scheme").addEventListener("click", () => {
    const next = document.documentElement.dataset.scheme === "light" ? null : "light";
    try { next ? localStorage.setItem(SCHEME_KEY, next) : localStorage.removeItem(SCHEME_KEY); } catch { /* ok */ }
    applyScheme(next);
  });

  // Utloggning (loggar ut alla fönster, även elevskärmen)
  const signOutBtn = $("#sign-out");
  signOutBtn.innerHTML = icon("logout");
  signOutBtn.addEventListener("click", () => void auth.signOut());

  // Snabbanteckning (F9) — fungerar i alla lägen, ALDRIG i elevvy-fönster
  // (rutan vägrar öppnas där och stängs om vyn växlar; se ui/quick-note.js).
  initQuickNote({ store, data });

  // Router
  const router = createRouter({ store, data, viewEl: $("#view"), sync: bus });
  router.start();
}
