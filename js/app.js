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
import { runRetention } from "./lib/privacy.js";
import { getProjectorScreen, screenOpenFeatures } from "./lib/screens.js";
import { initHelp } from "./ui/help.js";
import { initShortcuts } from "./ui/shortcuts.js";
import { initFullscreenPrompt } from "./ui/fullscreen-prompt.js";

const $ = (sel) => document.querySelector(sel);
const appEl = $("#app");
const gateEl = $("#auth-gate");

// Utskickat läge (det eleverna ser) persistas som klassvalet — så att ett
// omladdat/nyöppnat LÄRARfönster LÄR SIG vad som redan visas i stället för
// att nollställa det. Delas mellan fönster via storage-eventet.
const PRESENTED_MODE_KEY = "classroom:presentedMode";

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

/** Öppnades detta elevfönster med begäran om auto-helskärm på projektorn? */
const wantsAutoFullscreen = () => {
  try { return new URLSearchParams(location.search).has("autofs"); }
  catch { return false; }
};

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

  // Återställ utskickat läge — så ett omladdat lärarfönster inte råkar
  // byta läge ute på elevskärmen (se PRESENTED_MODE_KEY ovan).
  try {
    const savedMode = localStorage.getItem(PRESENTED_MODE_KEY);
    if (savedMode && isStudentMode(savedMode)) store.set({ presentedMode: savedMode });
  } catch { /* lagring otillgänglig — bootstrappas vid första state:request */ }

  // Elevskärmen (och andra flikar) följer lärarens klassbyte live; andra
  // lärarfönster håller indikatorn för utskickat läge i synk.
  window.addEventListener("storage", (e) => {
    if (e.key === ACTIVE_CLASS_KEY) store.set({ classId: e.newValue || null });
    else if (e.key === PRESENTED_MODE_KEY && store.get().view === "teacher"
             && isStudentMode(e.newValue)) store.set({ presentedMode: e.newValue });
  });

  // ---- Sync lärare ↔ elevskärm (BroadcastChannel; se docs/SYNC.md) ----

  const bus = createSyncBus();
  const preview = isPreviewWindow(); // förhandsvisnings-iframen: följer, men är tyst

  // Sätt rätt vy INNAN sync-prenumerationerna nedan gör sina första
  // anrop — annars agerar ett elevfönster lärare i en blink vid start.
  store.set({ view: currentView() });

  // Elevfönster som öppnats på projektorn med ?autofs=1: visa ett stort
  // ett-kliks helskärmslager. requestFullscreen() kräver en transient
  // användargest i DETTA fönster — klick-gesten från "Öppna elevskärm"
  // följer inte med hit, så ett auto-anrop avvisas tyst. Ett riktigt klick
  // på lagret ger en giltig gest → äkta helskärm på skärm 2. Dubbelklick
  // och screens.js-positioneringen är kvar. Aldrig i förhandsvisnings-
  // iframen (inbäddad i lärarvyn) och aldrig i lärarvyn.
  if (!preview && currentView() === "student" && wantsAutoFullscreen()) {
    try { initFullscreenPrompt(); } catch { /* helskärm är en bonus */ }
  }

  // INTEGRITET: auto-radering av gamla noteringar (Läge 5). Körs bara i
  // lärarvyn när en klass är aktiv — gränsen sätts per klass i
  // Översikten. Registreras efter att vyn satts så ett elevfönster
  // aldrig råkar skriva. Elevskärmen rör aldrig noteringar.
  let lastPurgedClass = null;
  store.subscribe(["classId", "view"], ({ classId, view }) => {
    if (view !== "teacher" || !classId || classId === lastPurgedClass) return;
    lastPurgedClass = classId;
    void runRetention(data, classId);
  });

  // Lärarfönstret publicerar KLASSVALET — vid varje klassbyte och på
  // begäran. Klassen följer alltid med automatiskt (samma aktiva klass
  // överallt). LÄGET gör det INTE längre: lärarens flikbyte ska inte
  // röra elevskärmen — det styrs av "Visa på elevskärm" (present nedan).
  const publishState = () => {
    const { view, classId } = store.get();
    if (view === "teacher") bus.publish("state", { classId });
  };
  store.subscribe(["classId", "view"], publishState);
  bus.on("state:request", publishState);

  // ---- Utskickat läge ("Visa på elevskärm") ----
  //
  // presentedMode = det läge som JUST NU visas på elevskärmen. Frikopplat
  // från lärarens egen flik (store.modeId). Läraren skickar aktivt ut ett
  // läge; först då byter elevskärmen. Bara elev-visningsbara lägen kan
  // skickas ut (Elevlista/Översikt når som förut ALDRIG elevskärmen).
  const startableMode = () => {
    const { modeId } = store.get();
    return isStudentMode(modeId) ? modeId : MODES[0].id;
  };

  // Skicka ut ett läge till alla elevskärmar (och håll indikatorn i synk).
  function present(modeId) {
    if (!isStudentMode(modeId)) return;
    try { localStorage.setItem(PRESENTED_MODE_KEY, modeId); } catch { /* ok */ }
    store.set({ presentedMode: modeId });
    bus.publish("present", { modeId });
  }

  // Andra lärarfönster/flikar håller sin indikator i synk med det utskickade.
  bus.on("present", ({ payload }) => {
    if (store.get().view !== "teacher") return;
    if (isStudentMode(payload?.modeId)) store.set({ presentedMode: payload.modeId });
  });

  // Elevskärmen följer KLASSVALET automatiskt — aldrig läget (frikopplat).
  bus.on("state", ({ payload }) => {
    if (store.get().view !== "student") return;
    store.set({ classId: payload.classId ?? null });
  });

  // Elevskärmen byter läge BARA när läraren aktivt skickar ut ett — och
  // aldrig in i lärarlägen (spärr behålls).
  bus.on("present", ({ payload }) => {
    if (store.get().view !== "student") return;
    if (isStudentMode(payload?.modeId) && payload.modeId !== store.get().modeId) {
      location.hash = `#/elev/${payload.modeId}`;
    }
  });

  // Nyöppnad elevskärm (eller förhandsvisning): fråga läraren vad som gäller.
  // Läraren svarar med klassval OCH det utskickade läget — vid första
  // förfrågan sätts ett rimligt startläge (lärarens nuvarande elev-
  // visningsbara läge, annars morgonskärm); därefter styr bara knappen.
  bus.on("state:request", () => {
    if (store.get().view !== "teacher") return;
    if (store.get().presentedMode == null) present(startableMode());
    else bus.publish("present", { modeId: store.get().presentedMode });
  });
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
  //
  // Om Window Management API finns (Chrome/Edge, https/localhost, behörighet
  // given) och det finns en andra skärm (projektorn): öppna fönstret
  // positionerat på DEN skärmens bounds och be det gå i helskärm där (flaggan
  // ?autofs=1 läses vid elevvyns uppstart, se startApp). Allt annat — API
  // saknas/nekas, bara en skärm, popup blockerad — faller tillbaka på dagens
  // beteende: vanligt window.open + befintlig dubbelklick-för-helskärm.
  async function openStudentWindow() {
    const { modeId } = store.get();
    const target = isStudentMode(modeId) ? modeId : MODES[0].id;
    const url = `${location.pathname}#/elev/${target}`;

    let projector = null;
    try { projector = await getProjectorScreen(); } catch { projector = null; }

    // Fallback: ingen andra skärm / API saknas / nekad → som förut.
    if (!projector) {
      try { window.open(url, "classroom-student-view")?.focus(); } catch { /* ok */ }
      return;
    }

    // Projektor hittad: positionera på dess yta och flagga för auto-helskärm.
    const fsUrl = `${location.pathname}?autofs=1#/elev/${target}`;
    let win = null;
    try { win = window.open(fsUrl, "classroom-student-view", screenOpenFeatures(projector.screen)); }
    catch { win = null; }
    // Popup blockerad (t.ex. aktivering förbrukad av behörighets-await) →
    // sista utväg: öppna som vanligt, utan positionering/auto-helskärm.
    if (!win) { try { win = window.open(url, "classroom-student-view"); } catch { /* ok */ } }
    win?.focus();
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

  // Panel i lärarvyn: indikator + live-förhandsvisning + enskärmsläge
  // + "Visa på elevskärm" (skickar ut lärarens aktuella läge).
  initStudentPanel({ store, openStudentWindow, present });

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

  // Hjälp (genvägslista under "?") + globala tangentgenvägar.
  const help = initHelp({ store });
  const helpBtn = $("#open-help");
  helpBtn.innerHTML = icon("help");
  helpBtn.addEventListener("click", () => help.toggle());
  initShortcuts({ store, openStudentWindow, openHelp: help.open });

  // Router
  const router = createRouter({ store, data, viewEl: $("#view"), sync: bus });
  router.start();
}
