/**
 * Läge 3 — TRAFIKLJUSUR (övergångar).
 *
 * Huvudvyn för undanplockning vid lektionsslut. Timern räknar UPPÅT
 * från 00:00 och bakgrunden skiftar fas grön → gul → röd vid
 * justerbara sekundgränser. Tonen mot eleverna är lugn och saklig.
 *
 * Bygger på:
 *  - js/lib/timer.js  → tidsstämpel-baserad tid (rätt i bakgrundsflik)
 *                       + createTicker (ritsignal, aldrig egen räknare)
 *  - js/sync.js       → omedelbar spegling lärare → elevskärm
 *  - datalagret       → config (settings/trafikljus), live-tillstånd
 *                       (settings/trafikljusState) och loggade pass
 *                       (sessions). Se DATAMODELL.md / docs/SYNC.md.
 *
 * Kontrakt: samma modul renderar lärarvy och elevvy — förgrenar på
 * ctx.view. Elevvyn är REN: bara klocka, fas och kort instruktion.
 */

import { createTicker } from "../lib/timer.js";
import { icon } from "../lib/icons.js";

const CONFIG_ID = "trafikljus";       // settings/trafikljus  → { value: {yellowSec, redSec} }
const STATE_ID = "trafikljusState";   // settings/trafikljusState → { value: {timer} }

const settingsPath = (classId) => `classes/${classId}/settings`;
const sessionsPath = (classId) => `classes/${classId}/sessions`;

const DEFAULT_CONFIG = { yellowSec: 60, redSec: 120 };
const MIN_SEC = 5;

/** Faser: kort, lugn instruktionstext per fas (saklig ton mot eleverna). */
const PHASES = {
  green: {
    key: "green",
    label: "Grönt",
    lead: "Plocka undan",
    text: "Plocka undan och ställ in stolen.",
  },
  yellow: {
    key: "yellow",
    label: "Gult",
    lead: "Snart tyst",
    text: "Ställ dig bakom stolen — vi fasar ut till tystnad.",
  },
  red: {
    key: "red",
    label: "Rött",
    lead: "Lånad tid",
    text: "Övertid — lånad tid. Vi avslutar lugnt.",
  },
};

// ---- Rena hjälpare (tidsstämpelbaserat, syncbart) ------------------------

/** Millisekunder uppräknade sedan start (0 om null, fryser vid pausedAt). */
function elapsedMs(t, now = Date.now()) {
  if (!t) return 0;
  return Math.max(0, (t.pausedAt ?? now) - t.startedAt);
}

/** "MM:SS" med GOLV (första sekunden visar 00:00 — räknar uppåt). */
function fmtMMSS(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(m)}:${pad(s)}`;
}

/** Fas för ett antal förflutna sekunder givet gränserna. */
function phaseFor(sec, cfg) {
  if (sec >= cfg.redSec) return PHASES.red;
  if (sec >= cfg.yellowSec) return PHASES.yellow;
  return PHASES.green;
}

/** Normalisera/validera config (gult < rött, golv MIN_SEC). */
function normalizeConfig(raw) {
  const yellowSec = Math.max(MIN_SEC, Math.round(Number(raw?.yellowSec) || DEFAULT_CONFIG.yellowSec));
  let redSec = Math.max(MIN_SEC, Math.round(Number(raw?.redSec) || DEFAULT_CONFIG.redSec));
  if (redSec <= yellowSec) redSec = yellowSec + MIN_SEC;
  return { yellowSec, redSec };
}

/** Måndag 00:00 (lokal tid) för given tidpunkt — start på innevarande vecka. */
function startOfWeek(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const monday = (d.getDay() + 6) % 7; // mån = 0
  d.setDate(d.getDate() - monday);
  return d.getTime();
}

/**
 * Veckostatistik ur loggade pass: antal per färg, snabbaste gröna
 * stopp (veckans rekord) och de fem senaste passen (alla veckor).
 */
function computeStats(sessions, now = Date.now()) {
  const weekStart = startOfWeek(now);
  const tl = sessions.filter((s) => s.type === "trafikljus" && s.result);
  const week = tl.filter((s) => (s.startedAt ?? 0) >= weekStart);

  const counts = { green: 0, yellow: 0, red: 0 };
  let recordSec = null;
  let recordId = null;
  for (const s of week) {
    const c = s.result.color;
    if (counts[c] != null) counts[c]++;
    if (c === "green" && (recordSec == null || s.result.durationSec < recordSec)) {
      recordSec = s.result.durationSec;
      recordId = s.id;
    }
  }

  const latest = [...tl].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, 5);
  return { counts, recordSec, recordId, latest, weekTotal: week.length };
}

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" });

// ---- Mode-objektet --------------------------------------------------------

export default {
  id: "trafikljus",
  title: "Trafikljusur",
  icon: "signal",

  async mount(el, ctx) {
    const { view, activeClass, data, sync } = ctx;

    // Ingen klass vald → vänligt tomläge (krascha aldrig, kontrakt regel 2).
    if (!activeClass) {
      el.innerHTML = `
        <div class="mode-placeholder">
          <div class="mode-placeholder__icon">${icon("signal", { size: 44, strokeWidth: 1.4 })}</div>
          <h1>Trafikljusur</h1>
          <p>Välj en klass i topbaren för att starta övergångstimern.</p>
        </div>`;
      this._cleanup = () => {};
      return;
    }

    const classId = activeClass.id;
    const isStudent = view === "student";

    // Delat, muterbart tillstånd för vyn.
    let config = { ...DEFAULT_CONFIG };
    let timer = null;            // { startedAt, pausedAt|null } | null
    let sessions = [];
    let savedCurrent = false;    // aktuellt (stoppat) pass redan loggat?
    let celebrateRecord = false; // visa "Nytt rekord!" tills nästa start/återställ

    const unsubs = [];

    // -- Markup -------------------------------------------------------------

    el.innerHTML = isStudent ? studentMarkup() : teacherMarkup();

    const stageEl = el.querySelector(".tl-stage");
    const clockEl = el.querySelector(".tl-clock");
    const phaseTextEl = el.querySelector(".tl-phase-text");
    const phaseLeadEl = el.querySelector(".tl-phase-lead");

    // -- Ritning (både vyer) -----------------------------------------------

    function drawTimer() {
      const now = Date.now();
      const sec = Math.floor(elapsedMs(timer, now) / 1000);
      const phase = phaseFor(sec, config);
      clockEl.textContent = fmtMMSS(elapsedMs(timer, now));
      stageEl.dataset.phase = phase.key;
      stageEl.dataset.running = String(!!timer && timer.pausedAt == null);
      stageEl.dataset.stopped = String(!!timer && timer.pausedAt != null);
      if (phaseLeadEl) phaseLeadEl.textContent = phase.lead;
      phaseTextEl.textContent = phase.text;
      if (!isStudent) drawControls();
    }

    // createTicker: ritsignal (ritar direkt när fliken blir synlig igen).
    const stopTicker = createTicker(drawTimer);
    unsubs.push(stopTicker);

    // -- Elevvy: bara lyssna --------------------------------------------------

    if (isStudent) {
      // Config + live-tillstånd via datalagret (speglas cross-window och
      // överlever omladdning av elevskärmen).
      unsubs.push(
        data.watch(settingsPath(classId), (docs) => {
          const cfg = docs.find((d) => d.id === CONFIG_ID)?.value;
          const st = docs.find((d) => d.id === STATE_ID)?.value;
          config = normalizeConfig(cfg);
          timer = st?.timer ?? null;
          drawTimer();
        }),
      );
      // Omedelbar spegling via sync-bussen (kan komma före datalagrets event).
      unsubs.push(
        sync.on("trafikljus:timer", ({ payload }) => {
          timer = payload?.timer ?? null;
          drawTimer();
        }),
      );

      this._cleanup = () => { for (const u of unsubs) u(); };
      return;
    }

    // -- Lärarvy: kontroller, inställningar, statistik -----------------------

    const startBtn = el.querySelector('[data-act="start"]');
    const stopBtn = el.querySelector('[data-act="stop"]');
    const resetBtn = el.querySelector('[data-act="reset"]');
    const saveBtn = el.querySelector('[data-act="save"]');
    const yellowInput = el.querySelector('[data-cfg="yellow"]');
    const redInput = el.querySelector('[data-cfg="red"]');
    const statsEl = el.querySelector(".tl-stats");

    function drawControls() {
      const running = !!timer && timer.pausedAt == null;
      const stopped = !!timer && timer.pausedAt != null;
      startBtn.disabled = running;
      stopBtn.disabled = !running;
      resetBtn.disabled = !timer;
      saveBtn.disabled = !stopped || savedCurrent;
      saveBtn.querySelector("span").textContent = savedCurrent ? "Pass sparat" : "Spara pass";
    }

    // Skriv live-tillstånd till datalagret OCH publicera på sync-bussen.
    async function pushState() {
      sync.publish("trafikljus:timer", { timer });
      await data.put(settingsPath(classId), { id: STATE_ID, value: { timer } });
    }

    function start() {
      if (timer && timer.pausedAt == null) return; // redan igång
      timer = { startedAt: Date.now(), pausedAt: null };
      savedCurrent = false;
      celebrateRecord = false;
      drawTimer();
      drawStats();
      void pushState();
    }

    function stop() {
      if (!timer || timer.pausedAt != null) return;
      timer = { ...timer, pausedAt: Date.now() };
      drawTimer();
      void pushState();
    }

    function reset() {
      if (!timer) return;
      timer = null;
      savedCurrent = false;
      celebrateRecord = false;
      drawTimer();
      drawStats();
      void pushState();
    }

    function toggleStartStop() {
      if (timer && timer.pausedAt == null) stop();
      else start();
    }

    async function savePass() {
      if (!timer || timer.pausedAt == null || savedCurrent) return;
      const durationSec = Math.floor(elapsedMs(timer, timer.pausedAt) / 1000);
      const color = phaseFor(durationSec, config).key;
      const before = computeStats(sessions);
      celebrateRecord =
        color === "green" && (before.recordSec == null || durationSec < before.recordSec);
      savedCurrent = true;
      drawControls();
      await data.put(sessionsPath(classId), {
        type: "trafikljus",
        startedAt: timer.startedAt,
        endedAt: timer.pausedAt,
        result: { color, durationSec },
      });
      // sessions-watch ritar om statistiken (med ev. rekordmarkering).
    }

    startBtn.addEventListener("click", start);
    stopBtn.addEventListener("click", stop);
    resetBtn.addEventListener("click", reset);
    saveBtn.addEventListener("click", () => void savePass());

    // -- Inställningar: gränser i sekunder (kan sänkas progressivt) ---------

    function applyConfigFromInputs() {
      const next = normalizeConfig({ yellowSec: yellowInput.value, redSec: redInput.value });
      yellowInput.value = next.yellowSec;
      redInput.value = next.redSec;
      config = next;
      drawTimer();
      void data.put(settingsPath(classId), { id: CONFIG_ID, value: next });
    }
    yellowInput.addEventListener("change", applyConfigFromInputs);
    redInput.addEventListener("change", applyConfigFromInputs);

    // -- Config + live-tillstånd från datalagret ----------------------------
    // Lärarvyn äger `timer` lokalt; datalagret bidrar med config och en
    // ENGÅNGS-återställning av en klocka som gick när läget lämnades.
    let restoredTimer = false;
    unsubs.push(
      data.watch(settingsPath(classId), (docs) => {
        const cfg = docs.find((d) => d.id === CONFIG_ID)?.value;
        config = normalizeConfig(cfg);
        yellowInput.value = config.yellowSec;
        redInput.value = config.redSec;
        if (!restoredTimer) {
          restoredTimer = true;
          const st = docs.find((d) => d.id === STATE_ID)?.value;
          // Återuppta en klocka som gick/frös när läget lämnades — men
          // hoppa över en GAMMAL igångvarande klocka (t.ex. glömd sedan
          // förra lektionen) så inget spökpass räknar upp vid nästa start.
          const fresh = st?.timer && (st.timer.pausedAt != null || elapsedMs(st.timer) < 30 * 60_000);
          if (fresh && !timer) { timer = st.timer; savedCurrent = st.timer.pausedAt != null; }
        }
        drawTimer();
      }),
    );

    // -- Statistik: veckosummering, rekord, senaste fem ---------------------

    function drawStats() {
      const { counts, recordSec, recordId, latest, weekTotal } = computeStats(sessions);
      const dot = (c) => `<span class="tl-dot" data-phase="${c}"></span>`;
      const recordLine =
        recordSec == null
          ? `<span class="tl-stat-empty">Inget grönt avslut ännu i veckan.</span>`
          : `<strong class="tl-record-time">${fmtMMSS(recordSec * 1000)}</strong>
             ${celebrateRecord ? `<span class="tl-badge">Nytt rekord!</span>` : ""}`;

      const latestRows =
        latest.length === 0
          ? `<li class="tl-stat-empty">Inga sparade pass ännu.</li>`
          : latest
              .map(
                (s) => `<li class="tl-pass${s.id === recordId ? " is-record" : ""}">
                  ${dot(s.result.color)}
                  <span class="tl-pass-time">${fmtMMSS(s.result.durationSec * 1000)}</span>
                  <span class="tl-pass-date">${fmtDate(s.startedAt)}</span>
                </li>`,
              )
              .join("");

      statsEl.innerHTML = `
        <div class="tl-stats-week">
          <h3>Den här veckan</h3>
          <ul class="tl-tally" aria-label="Avslut denna vecka">
            <li>${dot("green")}<span class="tl-tally-n">${counts.green}</span><span class="tl-tally-l">gröna</span></li>
            <li>${dot("yellow")}<span class="tl-tally-n">${counts.yellow}</span><span class="tl-tally-l">gula</span></li>
            <li>${dot("red")}<span class="tl-tally-n">${counts.red}</span><span class="tl-tally-l">röda</span></li>
          </ul>
          <p class="tl-record"><span class="tl-record-label">Veckans rekord</span> ${recordLine}</p>
          <p class="tl-week-total">${weekTotal} ${weekTotal === 1 ? "pass" : "pass"} loggade i veckan.</p>
        </div>
        <div class="tl-stats-latest">
          <h3>Senaste fem passen</h3>
          <ul class="tl-passes">${latestRows}</ul>
        </div>`;
    }

    unsubs.push(
      data.watch(sessionsPath(classId), (docs) => {
        sessions = docs;
        drawStats();
      }),
    );

    // -- Tangentgenvägar: mellanslag = start/stopp, R = återställ -----------

    function onKey(e) {
      const t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.code === "Space") { e.preventDefault(); toggleStartStop(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); reset(); }
    }
    window.addEventListener("keydown", onKey);
    unsubs.push(() => window.removeEventListener("keydown", onKey));

    this._cleanup = () => { for (const u of unsubs) u(); };
  },

  async unmount() {
    this._cleanup?.();
    this._cleanup = null;
  },
};

// ---- Markup-mallar --------------------------------------------------------

function stageMarkup() {
  return `
    <div class="tl-stage" data-phase="green" data-running="false" data-stopped="false">
      <div class="tl-clock" role="timer" aria-live="off">00:00</div>
      <div class="tl-phase">
        <span class="tl-phase-lead">${PHASES.green.lead}</span>
        <span class="tl-phase-text">${PHASES.green.text}</span>
      </div>
    </div>`;
}

function studentMarkup() {
  return `<section class="tl tl--student">${stageMarkup()}</section>`;
}

function teacherMarkup() {
  return `
    <section class="tl tl--teacher">
      ${stageMarkup()}

      <div class="tl-controls teacher-only" role="group" aria-label="Timerkontroller">
        <button class="btn btn--primary tl-btn" data-act="start">${icon("play")}<span>Start</span></button>
        <button class="btn tl-btn" data-act="stop">${icon("stop")}<span>Stopp</span></button>
        <button class="btn tl-btn" data-act="reset">${icon("reset")}<span>Återställ</span></button>
        <button class="btn tl-btn tl-btn--save" data-act="save">${icon("save")}<span>Spara pass</span></button>
      </div>
      <p class="tl-hint teacher-only">Mellanslag startar och stoppar. <kbd>R</kbd> återställer.</p>

      <div class="tl-panels teacher-only">
        <section class="card tl-settings" aria-label="Tidsmål">
          <h3>Tidsmål för klassen</h3>
          <p class="tl-settings-help">Gränserna anges i sekunder — sänk dem stegvis för att göra övergångarna snabbare.</p>
          <div class="tl-fields">
            <label class="tl-field">
              <span class="tl-field-label">${icon("signal")} Gult vid</span>
              <span class="tl-field-input"><input type="number" inputmode="numeric" min="${MIN_SEC}" step="5" data-cfg="yellow"><span class="tl-unit">sek</span></span>
            </label>
            <label class="tl-field">
              <span class="tl-field-label">${icon("signal")} Rött vid</span>
              <span class="tl-field-input"><input type="number" inputmode="numeric" min="${MIN_SEC}" step="5" data-cfg="red"><span class="tl-unit">sek</span></span>
            </label>
          </div>
        </section>

        <section class="card tl-stats" aria-label="Klassrekord och veckostatistik"></section>
      </div>
    </section>`;
}
