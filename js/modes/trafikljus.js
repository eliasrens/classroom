/**
 * Läge 3 — TRAFIKLJUSUR (övergångar + datorer).
 *
 * Huvudvyn för undanplockning vid lektionsslut. Timern räknar UPPÅT
 * från 00:00 och bakgrunden skiftar fas grön → gul → röd vid
 * justerbara sekundgränser. Tonen mot eleverna är lugn och saklig.
 *
 * Två passtyper (KINDS) med egna gränser: "overgang" (vanlig övergång)
 * och "datorer" (plocka undan datorer — tar längre tid). Läraren väljer
 * typ innan start; statistik och rekord räknas ALDRIG över typgränsen.
 *
 * Bygger på:
 *  - js/lib/timer.js  → tidsstämpel-baserad tid (rätt i bakgrundsflik)
 *                       + createTicker (ritsignal, aldrig egen räknare)
 *  - js/sync.js       → omedelbar spegling lärare → elevskärm
 *  - datalagret       → config (settings/trafikljus), live-tillstånd
 *                       (settings/trafikljusState) och loggade pass
 *                       (sessions). Se DATAMODELL.md / docs/SYNC.md.
 *
 * Veckomål (issue #35): förra veckans resultat per typ (snitt, bästa,
 * total) är den här veckans mål att slå — se js/lib/week-goal.js. Måttet
 * väljs per typ och sparas delat i settings/trafikljus (goalMetric).
 *
 * Kontrakt: samma modul renderar lärarvy och elevvy — förgrenar på
 * ctx.view. Elevvyn är REN: bara den stora klockan och färgfasen, plus
 * (om läraren slagit på "Visa veckomålet för eleverna") en diskret målrad
 * — aldrig lärarstatistik eller lärarnamn.
 */

import { createTicker } from "../lib/timer.js";
import { icon } from "../lib/icons.js";
import { SUBJECTS } from "../lib/color.js";
import {
  KINDS, KIND_KEYS, DEFAULT_KIND, kindOf,
  computeStats, fmtMMSS, fmtWhen, lessonLabel, mergedSubjects,
} from "../lib/trafikljus-stats.js";
import { attribution } from "../data/plans.js";
import { serverNow } from "../lib/clock.js";
import { startOfWeek, weekLabel } from "../lib/week.js";
import {
  GOAL_METRICS, GOAL_METRIC_KEYS, normalizeGoalSettings, weekGoalStatus, passGoalMark, fmtSec, fmtDiff,
} from "../lib/week-goal.js";
import { teacherOptions as sharedTeacherOptions, teacherFilterFn, validTeacherFilter } from "../lib/teacher-filter.js";
import { currentLessonBlock, teacherLabel, escapeHtml } from "./elever/shared.js";
import { openClassActionDialog } from "../ui/class-actions.js";

const CONFIG_ID = "trafikljus";       // settings/trafikljus  → { value: { overgang:{yellowSec, redSec}, datorer:{…},
                                     //                                   goalMetric:{overgang, datorer}, showGoalToStudents } }
const STATE_ID = "trafikljusState";   // settings/trafikljusState → { value: {timer, kind} }

const settingsPath = (classId) => `classes/${classId}/settings`;
const sessionsPath = (classId) => `classes/${classId}/sessions`;

const MIN_SEC = 5;

/** Faser: bara färg + etikett. Ingen instruktionstext visas på skärmen
    — den stora klockan och färgskiftet räcker (saklig ton mot eleverna). */
const PHASES = {
  green:  { key: "green",  label: "Grönt" },
  yellow: { key: "yellow", label: "Gult" },
  red:    { key: "red",    label: "Rött" },
};

// ---- Rena hjälpare (tidsstämpelbaserat, syncbart) ------------------------

/** Millisekunder uppräknade sedan start (0 om null, fryser vid pausedAt). */
function elapsedMs(t, now = serverNow()) {
  if (!t) return 0;
  return Math.max(0, (t.pausedAt ?? now) - t.startedAt);
}

/** Fas för ett antal förflutna sekunder givet gränserna. */
function phaseFor(sec, cfg) {
  if (sec >= cfg.redSec) return PHASES.red;
  if (sec >= cfg.yellowSec) return PHASES.yellow;
  return PHASES.green;
}

/** Normalisera/validera EN typs gränser (gult < rött, golv MIN_SEC). */
function normalizeLimits(raw, defaults) {
  const yellowSec = Math.max(MIN_SEC, Math.round(Number(raw?.yellowSec) || defaults.yellowSec));
  let redSec = Math.max(MIN_SEC, Math.round(Number(raw?.redSec) || defaults.redSec));
  if (redSec <= yellowSec) redSec = yellowSec + MIN_SEC;
  return { yellowSec, redSec };
}

/**
 * Normalisera hela configen till { overgang:{…}, datorer:{…} }.
 * Bakåtkompatibelt: en gammal config utan typ ({yellowSec, redSec} på
 * toppnivån) migreras till "overgang"; saknade typer får standardvärden.
 */
function normalizeConfig(raw) {
  const legacy = raw && raw.overgang == null && (raw.yellowSec != null || raw.redSec != null)
    ? { yellowSec: raw.yellowSec, redSec: raw.redSec }
    : null;
  return Object.fromEntries(
    KIND_KEYS.map((k) => [k, normalizeLimits(k === DEFAULT_KIND && legacy ? legacy : raw?.[k], KINDS[k].defaults)]),
  );
}

/** "m:ss" för gränsvisning (180 → "3:00"). */
const fmtLimit = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

const HISTORY_PAGE = 8; // pass per "sida" i historiken

/** "snitt under 2:40" — målet i klartext (lärarvy och elevskärmens rad). */
const goalText = (goal) => `${GOAL_METRICS[goal.metric].short} under ${fmtSec(goal.targetSec)}`;

// Statistikfiltret (lärare + typ) överlever byte av läge under sessionen.
const statsFilter = { teacher: "all", kind: null };

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
    let config = normalizeConfig(null); // { overgang:{yellowSec, redSec}, datorer:{…} }
    let kind = DEFAULT_KIND;            // vald passtyp — låst medan ett pass pågår/är stoppat
    let timer = null;                   // { startedAt, pausedAt|null } | null
    let sessions = [];
    let subjects = SUBJECTS;            // inbyggda + klassens egna ämnen (för lektionsnamn)
    let savedCurrent = false;           // aktuellt (stoppat) pass redan loggat?
    let celebrateRecord = false;        // visa "Nytt rekord!" tills nästa start/återställ
    let goalCfg = normalizeGoalSettings(null); // { goalMetric:{overgang, datorer}, showGoalToStudents }
    let goalMark = null;                // { kind, mark: "met"|"beat" } efter sparat pass, tills nästa start/återställ
    let goalWeek = null;                // veckan målet senast ritades för (veckoskifte → rita om)
    let shown = HISTORY_PAGE;           // antal pass som visas i historiken

    const limits = () => config[kind];
    // Hela settings/trafikljus-värdet: gränser + veckomålets inställningar
    // (samma dokument — skrivs alltid i sin helhet så inget fält tappas).
    const configValue = () => ({ ...config, ...goalCfg });

    const unsubs = [];
    // Städfunktionen sätts direkt: kraschar mount halvvägs stoppar
    // unmount ändå ticker, watchers och tangentlyssnare som hann starta.
    this._cleanup = () => { for (const u of unsubs.splice(0)) { try { u(); } catch { /* ok */ } } };

    // -- Markup -------------------------------------------------------------

    el.innerHTML = isStudent ? studentMarkup() : teacherMarkup();

    const stageEl = el.querySelector(".tl-stage");
    const clockEl = el.querySelector(".tl-clock");
    const kindTagEl = el.querySelector(".tl-kind-tag");
    const goalLineEl = el.querySelector(".tl-goal-line"); // bara i elevvyn

    // -- Ritning (både vyer) -----------------------------------------------

    function drawTimer() {
      const now = serverNow();
      const sec = Math.floor(elapsedMs(timer, now) / 1000);
      const phase = phaseFor(sec, limits());
      clockEl.textContent = fmtMMSS(elapsedMs(timer, now));
      // Fasen styr bara färgen (data-phase) — ingen instruktionstext.
      stageEl.dataset.phase = phase.key;
      stageEl.dataset.kind = kind;
      stageEl.dataset.running = String(!!timer && timer.pausedAt == null);
      stageEl.dataset.stopped = String(!!timer && timer.pausedAt != null);
      // Diskret etikett så eleverna vet vilket ljus som gäller (bara för
      // datorer — en vanlig övergång är standardfallet och visas rent).
      kindTagEl.hidden = kind === DEFAULT_KIND;
      if (!isStudent) drawControls();
    }

    // createTicker startas SIST i respektive gren — dess första tick
    // ritar direkt, och lärargrenens drawControls kräver att knapparna
    // hunnit deklareras (annars TDZ-fel i den allra första ritningen).

    // -- Elevvy: bara lyssna --------------------------------------------------

    if (isStudent) {
      // Veckomålets rad under klockan — bara när läraren slagit på det.
      // Passen läses då enbart för att räkna fram målet; inga namn eller
      // annan statistik visas (spärren i docs/SYNC.md).
      let offSessions = null;
      function drawGoalLine() {
        goalWeek = startOfWeek(serverNow());
        const goal = goalCfg.showGoalToStudents
          ? weekGoalStatus(sessions, kind, goalCfg.goalMetric[kind], goalWeek).goal
          : null;
        goalLineEl.hidden = !goal;
        goalLineEl.textContent = goal ? `Veckans mål: ${goalText(goal)}` : "";
      }
      function watchSessions(on) {
        if (on && !offSessions) {
          offSessions = data.watch(sessionsPath(classId), (docs) => { sessions = docs; drawGoalLine(); });
        } else if (!on && offSessions) {
          offSessions();
          offSessions = null;
          sessions = [];
        }
      }
      unsubs.push(() => watchSessions(false));

      // Config + live-tillstånd via datalagret (speglas cross-window och
      // överlever omladdning av elevskärmen).
      unsubs.push(
        data.watch(settingsPath(classId), (docs) => {
          const cfg = docs.find((d) => d.id === CONFIG_ID)?.value;
          const st = docs.find((d) => d.id === STATE_ID)?.value;
          config = normalizeConfig(cfg);
          goalCfg = normalizeGoalSettings(cfg);
          timer = st?.timer ?? null;
          kind = kindOf(st?.kind);
          watchSessions(goalCfg.showGoalToStudents);
          drawGoalLine();
          drawTimer();
        }),
      );
      // Omedelbar spegling via sync-bussen (kan komma före datalagrets event).
      unsubs.push(
        sync.on("trafikljus:timer", ({ payload }) => {
          timer = payload?.timer ?? null;
          kind = kindOf(payload?.kind);
          drawGoalLine();
          drawTimer();
        }),
      );
      // Ny vecka medan elevskärmen står öppen → nytt mål.
      const weekTick = setInterval(() => { if (startOfWeek(serverNow()) !== goalWeek) drawGoalLine(); }, 30_000);
      unsubs.push(() => clearInterval(weekTick));

      unsubs.push(createTicker(drawTimer));
      return;
    }

    // -- Lärarvy: typväxlare, kontroller, inställningar, statistik -----------

    const kindBtns = [...el.querySelectorAll(".tl-kind-opt[data-kind]")];
    const startBtn = el.querySelector('[data-act="start"]');
    const stopBtn = el.querySelector('[data-act="stop"]');
    const resetBtn = el.querySelector('[data-act="reset"]');
    const saveBtn = el.querySelector('[data-act="save"]');
    const actionBtn = el.querySelector('[data-act="class-action"]');
    let savedLesson; // lektionen för senast sparade pass (förväljs i klassåtgärden)
    const yellowInput = el.querySelector('[data-cfg="yellow"]');
    const redInput = el.querySelector('[data-cfg="red"]');
    const settingsKindEl = el.querySelector(".tl-settings-kind");
    const showGoalInput = el.querySelector("[data-show-goal]");
    const kindHintEl = el.querySelector(".tl-kind-hint");
    const statsEl = el.querySelector(".tl-stats");

    function drawControls() {
      const running = !!timer && timer.pausedAt == null;
      const stopped = !!timer && timer.pausedAt != null;
      startBtn.disabled = running;
      stopBtn.disabled = !running;
      resetBtn.disabled = !timer;
      saveBtn.disabled = !stopped || savedCurrent;
      saveBtn.querySelector("span").textContent = savedCurrent ? "Pass sparat" : "Spara pass";
      // Direkt efter ett sparat pass: "＋ Klassåtgärd" (issue #34).
      actionBtn.hidden = !savedCurrent;
      // Typen väljs INNAN start och ligger fast tills passet återställs.
      for (const b of kindBtns) {
        const on = b.dataset.kind === kind;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
        b.disabled = !!timer && !on;
      }
      kindHintEl.hidden = !timer;
    }

    /** Växlarens gränsrad och inställningsfälten för vald typ. */
    function drawLimits() {
      for (const b of kindBtns) {
        const l = config[b.dataset.kind];
        b.querySelector(".tl-kind-limits").textContent = `gult ${fmtLimit(l.yellowSec)} · rött ${fmtLimit(l.redSec)}`;
      }
      settingsKindEl.textContent = KINDS[kind].label.toLowerCase();
      if (document.activeElement !== yellowInput) yellowInput.value = limits().yellowSec;
      if (document.activeElement !== redInput) redInput.value = limits().redSec;
    }

    // Skriv live-tillstånd till datalagret OCH publicera på sync-bussen.
    async function pushState() {
      sync.publish("trafikljus:timer", { timer, kind });
      await data.put(settingsPath(classId), { id: STATE_ID, value: { timer, kind } });
    }

    function setKind(next) {
      next = kindOf(next);
      if (next === kind || timer) return; // låst medan ett pass finns
      kind = next;
      // Statistiken följer växlaren (den kan sedan filtreras fritt).
      statsFilter.kind = kind;
      celebrateRecord = false;
      goalMark = null;
      drawLimits();
      drawTimer();
      drawStats();
      void pushState();
    }

    function start() {
      if (timer && timer.pausedAt == null) return; // redan igång
      timer = { startedAt: serverNow(), pausedAt: null };
      savedCurrent = false;
      celebrateRecord = false;
      goalMark = null;
      drawTimer();
      drawStats();
      void pushState();
    }

    function stop() {
      if (!timer || timer.pausedAt != null) return;
      timer = { ...timer, pausedAt: serverNow() };
      drawTimer();
      void pushState();
    }

    function reset() {
      if (!timer) return;
      timer = null;
      savedCurrent = false;
      celebrateRecord = false;
      goalMark = null;
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
      const passLimits = { ...limits() };
      const color = phaseFor(durationSec, passLimits).key;
      // Rekordet är klassens (alla lärare) — men bara inom samma typ.
      const before = computeStats(sessions, kind);
      celebrateRecord =
        color === "green" && (before.recordSec == null || durationSec < before.recordSec);
      if (celebrateRecord) statsFilter.kind = kind;
      const pass = {
        type: "trafikljus",
        kind,
        startedAt: timer.startedAt,
        endedAt: timer.pausedAt,
        result: { color, durationSec, limits: passLimits },
      };
      // Veckomålet (hela klassen, samma typ): klarades det nu, eller var
      // passet i sig under målet? Kort, lugn markering som "Nytt rekord!".
      const mark = passGoalMark(sessions, kind, goalCfg.goalMetric[kind], pass);
      goalMark = mark ? { kind, mark } : null;
      if (goalMark) statsFilter.kind = kind;
      savedCurrent = true;
      drawControls();
      // Attribution: vem loggade passet + snapshot av pågående block ur den
      // inloggade lärarens planering (null om inget block pågår just nu).
      const lesson = await currentLessonBlock(data, classId);
      savedLesson = lesson;
      await data.put(sessionsPath(classId), { ...pass, lesson, ...attribution() });
      // sessions-watch ritar om statistiken (med ev. rekordmarkering).
    }

    for (const b of kindBtns) b.addEventListener("click", () => setKind(b.dataset.kind));
    // Radiogrupp: piltangenter flyttar valet (samma mönster som native radio).
    el.querySelector(".tl-kind").addEventListener("keydown", (e) => {
      if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key) || timer) return;
      e.preventDefault();
      const i = KIND_KEYS.indexOf(kind);
      const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
      const next = KIND_KEYS[(i + step + KIND_KEYS.length) % KIND_KEYS.length];
      setKind(next);
      kindBtns.find((b) => b.dataset.kind === next)?.focus();
    });
    startBtn.addEventListener("click", start);
    stopBtn.addEventListener("click", stop);
    resetBtn.addEventListener("click", reset);
    saveBtn.addEventListener("click", () => void savePass());
    actionBtn.addEventListener("click", () => void openClassActionDialog({ data, cid: classId, lesson: savedLesson }));

    // -- Inställningar: gränser i sekunder per typ (kan sänkas progressivt) --

    function applyConfigFromInputs() {
      const next = normalizeLimits({ yellowSec: yellowInput.value, redSec: redInput.value }, KINDS[kind].defaults);
      config = { ...config, [kind]: next };
      yellowInput.value = next.yellowSec;
      redInput.value = next.redSec;
      drawLimits();
      drawTimer();
      // Hela den typade configen skrivs — en gammal typlös config
      // migreras därmed till { overgang, datorer } vid första ändring.
      void data.put(settingsPath(classId), { id: CONFIG_ID, value: configValue() });
    }
    yellowInput.addEventListener("change", applyConfigFromInputs);
    redInput.addEventListener("change", applyConfigFromInputs);

    // Veckomålet: mått per typ (i statistikpanelen) + visning för eleverna.
    function setGoalSettings(next) {
      goalCfg = normalizeGoalSettings({ ...goalCfg, ...next });
      goalSettingsKey = JSON.stringify(goalCfg);
      showGoalInput.checked = goalCfg.showGoalToStudents;
      drawStats();
      void data.put(settingsPath(classId), { id: CONFIG_ID, value: configValue() });
    }
    showGoalInput.addEventListener("change", () => setGoalSettings({ showGoalToStudents: showGoalInput.checked }));

    // -- Config + live-tillstånd från datalagret ----------------------------
    // Lärarvyn äger `timer` och `kind` lokalt; datalagret bidrar med config
    // och en ENGÅNGS-återställning av en klocka som gick när läget lämnades.
    let restoredTimer = false;
    let subjectsKey = null;
    let goalSettingsKey = null;
    unsubs.push(
      data.watch(settingsPath(classId), (docs) => {
        const cfg = docs.find((d) => d.id === CONFIG_ID)?.value;
        config = normalizeConfig(cfg);
        // Veckomålets inställningar (delade — en annan lärare kan byta mått).
        goalCfg = normalizeGoalSettings(cfg);
        const nextGoalKey = JSON.stringify(goalCfg);
        const goalChanged = nextGoalKey !== goalSettingsKey;
        goalSettingsKey = nextGoalKey;
        showGoalInput.checked = goalCfg.showGoalToStudents;
        // Statistiken ritas bara om när ämneslistan faktiskt ändrats —
        // live-tillståndet skrivs vid varje start/stopp och ska inte
        // rycka fokus från filtret.
        const nextSubjectsKey = JSON.stringify(docs.find((d) => d.id === "subjects")?.value ?? null);
        const subjectsChanged = nextSubjectsKey !== subjectsKey;
        subjectsKey = nextSubjectsKey;
        if (subjectsChanged) subjects = mergedSubjects(docs);
        if (!restoredTimer) {
          restoredTimer = true;
          const st = docs.find((d) => d.id === STATE_ID)?.value;
          kind = kindOf(st?.kind);
          // Återuppta en klocka som gick/frös när läget lämnades — men
          // hoppa över en GAMMAL igångvarande klocka (t.ex. glömd sedan
          // förra lektionen) så inget spökpass räknar upp vid nästa start.
          const fresh = st?.timer && (st.timer.pausedAt != null || elapsedMs(st.timer) < 30 * 60_000);
          if (fresh && !timer) { timer = st.timer; savedCurrent = st.timer.pausedAt != null; }
          if (statsFilter.kind == null) statsFilter.kind = kind;
          drawStats();
        } else if (subjectsChanged || goalChanged) drawStats();
        drawLimits();
        drawTimer();
      }),
    );

    // -- Statistik: filter (lärare + typ), veckosummering, rekord, historik --

    /** Lärarna som loggat trafikljuspass i klassen (för filtret). */
    // Funktionsdeklaration (hoistas): drawStats anropas redan från
    // settings-watchen ovan, innan den här raden har körts.
    function teacherOptions() {
      return sharedTeacherOptions(sessions.filter((s) => s.type === "trafikljus"));
    }

    function drawStats() {
      const statsKind = kindOf(statsFilter.kind ?? kind);
      const others = teacherOptions();
      statsFilter.teacher = validTeacherFilter(statsFilter.teacher, others);
      const filterOn = statsFilter.teacher !== "all";
      const { counts, recordSec, recordId, latest, weekTotal } =
        computeStats(sessions, statsKind, { filter: teacherFilterFn(statsFilter.teacher) });

      const dot = (c) => `<span class="tl-dot" data-phase="${c}"></span>`;
      const recordLine =
        recordSec == null
          ? `<span class="tl-stat-empty">Inget grönt avslut ännu i veckan.</span>`
          : `<strong class="tl-record-time">${fmtMMSS(recordSec * 1000)}</strong>
             ${celebrateRecord && statsKind === kind ? `<span class="tl-badge">Nytt rekord!</span>` : ""}`;

      const rows = latest.slice(0, shown);
      const latestRows =
        rows.length === 0
          ? `<li class="tl-stat-empty">${filterOn ? "Inga sparade pass i veckan för det här urvalet." : "Inga sparade pass ännu i veckan."}</li>`
          : rows
              .map((s) => {
                const lesson = lessonLabel(s.lesson, subjects);
                return `<li class="tl-pass${s.id === recordId ? " is-record" : ""}">
                  <span class="tl-pass-who">
                    <span class="tl-pass-teacher">${escapeHtml(teacherLabel(s))}</span>
                    <span class="tl-pass-date">${escapeHtml(fmtWhen(s.startedAt ?? s.createdAt ?? 0))}</span>
                    ${lesson ? `<span class="tl-pass-lesson">${escapeHtml(lesson)}</span>` : ""}
                  </span>
                  <span class="tl-pass-result">
                    ${dot(s.result.color)}
                    <span class="tl-pass-time">${fmtMMSS(s.result.durationSec * 1000)}</span>
                  </span>
                </li>`;
              })
              .join("");

      const teacherOpt = (value, name) =>
        `<option value="${escapeHtml(value)}"${statsFilter.teacher === value ? " selected" : ""}>${escapeHtml(name)}</option>`;
      const kindOpts = KIND_KEYS.map(
        (k) => `<button type="button" class="tl-filter-kind" data-stats-kind="${k}" aria-pressed="${k === statsKind}">${KINDS[k].label}</button>`,
      ).join("");

      statsEl.innerHTML = `
        <div class="tl-stats-filter" role="group" aria-label="Filtrera statistiken">
          <div class="tl-filter-kinds" role="group" aria-label="Typ">${kindOpts}</div>
          <select class="tl-filter-teacher" data-stats-teacher aria-label="Lärare">
            ${teacherOpt("all", "Alla lärare")}
            ${teacherOpt("mine", "Mina pass")}
            ${others.map((o) => teacherOpt(o.value, o.name)).join("")}
          </select>
        </div>
        ${goalMarkup(statsKind)}
        <div class="tl-stats-week">
          <h3>Den här veckan · ${KINDS[statsKind].label}</h3>
          <ul class="tl-tally" aria-label="Avslut denna vecka">
            <li>${dot("green")}<span class="tl-tally-n">${counts.green}</span><span class="tl-tally-l">gröna</span></li>
            <li>${dot("yellow")}<span class="tl-tally-n">${counts.yellow}</span><span class="tl-tally-l">gula</span></li>
            <li>${dot("red")}<span class="tl-tally-n">${counts.red}</span><span class="tl-tally-l">röda</span></li>
          </ul>
          <p class="tl-record"><span class="tl-record-label">Veckans rekord</span> ${recordLine}</p>
          <p class="tl-week-total">${weekTotal} pass loggade i veckan.</p>
        </div>
        <div class="tl-stats-latest">
          <h3>Veckans pass · ${KINDS[statsKind].label}</h3>
          <ul class="tl-passes">${latestRows}</ul>
          ${latest.length > shown ? `<button type="button" class="btn btn--ghost tl-more" data-stats-more>Visa fler (${latest.length - shown} till)</button>` : ""}
          <p class="tl-archive-hint">Tidigare veckor finns i <a href="#/statistik">Statistik</a>.</p>
        </div>`;
    }

    /**
     * Veckomålet för en typ: förra veckans resultat (snitt · bästa · total
     * på n pass) och den här veckans värde mot målet. Hela klassens pass —
     * lärarfiltret gäller inte målet.
     */
    function goalMarkup(k) {
      goalWeek = startOfWeek(serverNow());
      const metric = goalCfg.goalMetric[k];
      const { summary, goal, progress } = weekGoalStatus(sessions, k, metric, goalWeek);
      const metricOpts = GOAL_METRIC_KEYS.map((m) =>
        `<option value="${m}"${m === metric ? " selected" : ""}>${GOAL_METRICS[m].label}</option>`).join("");
      const picker = `
        <label class="tl-goal-metric">
          <span>Mål att slå</span>
          <select data-goal-metric="${k}" aria-label="Mått för veckomålet (${KINDS[k].label.toLowerCase()})">${metricOpts}</select>
        </label>`;

      if (!goal) {
        return `
          <div class="tl-goal" data-goal-state="none">
            <div class="tl-goal-head"><h3>Veckomål</h3>${picker}</div>
            <p class="tl-goal-empty">Inget mål ännu — det sätts av första veckan med sparade pass (${KINDS[k].label.toLowerCase()}).</p>
          </div>`;
      }
      const p = goal.prev;
      const prevName = p.adjacent ? `Förra veckan (${weekLabel(p.weekStart)})` : `${weekLabel(p.weekStart)}, senaste veckan med pass`;
      const ps = p.summary;
      let status;
      if (!summary) status = `<span class="tl-goal-wait">Inga pass ännu den här veckan.</span>`;
      else if (progress.met) status = `just nu ${fmtSec(progress.valueSec)} <span class="tl-goal-ok" role="img" aria-label="Målet klarat">${icon("check")}</span>`;
      else if (goal.metric === "total") status = `just nu ${fmtSec(progress.valueSec)} · <span class="tl-goal-left">${fmtDiff(progress.diffSec)} över målet</span>`;
      else status = `just nu ${fmtSec(progress.valueSec)} · <span class="tl-goal-left">${fmtDiff(progress.diffSec)} kvar till målet</span>`;
      const mark = goalMark && goalMark.kind === k
        ? `<span class="tl-badge">${goalMark.mark === "met" ? "Veckomålet klarat!" : "Under målet!"}</span>`
        : "";
      return `
        <div class="tl-goal" data-goal-state="${progress.met ? "met" : "open"}">
          <div class="tl-goal-head"><h3>Veckomål</h3>${picker}</div>
          <p class="tl-goal-prev"><strong>${escapeHtml(prevName)}:</strong>
            snitt ${fmtSec(ps.avgSec)} · bästa ${fmtSec(ps.bestSec)} · totalt ${fmtSec(ps.totalSec)} på ${ps.count} pass</p>
          <p class="tl-goal-now">${icon("flag")} <strong>Mål den här veckan: ${goalText(goal)}</strong>,
            ${status}${summary ? ` <span class="tl-goal-count">(${summary.count} pass)</span>` : ""} ${mark}</p>
          ${goal.metric === "total" ? `<p class="tl-goal-note">Totaltiden jämförs rättvist bara om antalet pass är ungefär lika (förra veckan ${ps.count} pass).</p>` : ""}
        </div>`;
    }

    // Filtren ritas om med statistiken — lyssna via delegering.
    statsEl.addEventListener("click", (e) => {
      const kindBtn = e.target.closest("[data-stats-kind]");
      if (kindBtn) { statsFilter.kind = kindBtn.dataset.statsKind; shown = HISTORY_PAGE; drawStats(); return; }
      if (e.target.closest("[data-stats-more]")) { shown += HISTORY_PAGE; drawStats(); }
    });
    statsEl.addEventListener("change", (e) => {
      const metricSel = e.target.closest("[data-goal-metric]");
      if (metricSel) {
        setGoalSettings({ goalMetric: { ...goalCfg.goalMetric, [metricSel.dataset.goalMetric]: metricSel.value } });
        statsEl.querySelector("[data-goal-metric]")?.focus();
        return;
      }
      if (!e.target.matches("[data-stats-teacher]")) return;
      statsFilter.teacher = e.target.value;
      shown = HISTORY_PAGE;
      drawStats();
      statsEl.querySelector("[data-stats-teacher]")?.focus();
    });

    // Delat mellan lärarna i realtid: sessions-watchen speglar Firestore.
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

    // Ny vecka medan läget står öppet → nytt mål och ny veckostatistik.
    const weekTick = setInterval(() => { if (startOfWeek(serverNow()) !== goalWeek) drawStats(); }, 30_000);
    unsubs.push(() => clearInterval(weekTick));

    // Allt (knappar, watchers) är nu på plats — starta ritsignalen.
    drawLimits();
    unsubs.push(createTicker(drawTimer));
  },

  async unmount() {
    this._cleanup?.();
    this._cleanup = null;
  },
};

// ---- Markup-mallar --------------------------------------------------------

function stageMarkup(extra = "") {
  // Ren scen: bara stor klocka + färgfas (bakgrunden via data-phase).
  // Ingen instruktionstext per fas — färgen och tiden räcker. Etiketten
  // "Datorer" är diskret och syns bara när datorljuset gäller.
  return `
    <div class="tl-stage" data-phase="green" data-kind="${DEFAULT_KIND}" data-running="false" data-stopped="false">
      <div class="tl-kind-tag" hidden>${icon("monitor")}<span>${KINDS.datorer.label}</span></div>
      <div class="tl-clock" role="timer" aria-live="off">00:00</div>
      ${extra}
    </div>`;
}

function studentMarkup() {
  // Målraden (veckomålet) ligger under klockan och syns bara när läraren
  // slagit på "Visa veckomålet för eleverna" och det finns ett mål.
  return `<section class="tl tl--student">${stageMarkup(`<p class="tl-goal-line" hidden></p>`)}</section>`;
}

function teacherMarkup() {
  const kindOption = (k) => `
    <button type="button" class="tl-kind-opt" role="radio" data-kind="${k}" aria-checked="${k === DEFAULT_KIND}">
      <span class="tl-kind-name">${icon(KINDS[k].icon)}<span>${KINDS[k].label}</span></span>
      <span class="tl-kind-limits"></span>
    </button>`;
  return `
    <section class="tl tl--teacher">
      <div class="tl-kind-row teacher-only">
        <div class="tl-kind" role="radiogroup" aria-label="Typ av pass">${KIND_KEYS.map(kindOption).join("")}</div>
        <p class="tl-kind-hint" hidden>Återställ för att byta typ.</p>
      </div>

      ${stageMarkup()}

      <div class="tl-controls teacher-only" role="group" aria-label="Timerkontroller">
        <button class="btn btn--primary tl-btn" data-act="start">${icon("play")}<span>Start</span></button>
        <button class="btn tl-btn" data-act="stop">${icon("stop")}<span>Stopp</span></button>
        <button class="btn tl-btn" data-act="reset">${icon("reset")}<span>Återställ</span></button>
        <button class="btn tl-btn tl-btn--save" data-act="save">${icon("save")}<span>Spara pass</span></button>
        <button class="btn tl-btn ca-add" data-act="class-action" hidden
          title="Testade ni något nytt arbetssätt? Dela hur det gick med de andra lärarna">${icon("plus")}<span>Klassåtgärd</span></button>
      </div>
      <p class="tl-hint teacher-only">Mellanslag startar och stoppar. <kbd>R</kbd> återställer.</p>

      <div class="tl-panels teacher-only">
        <section class="card tl-settings" aria-label="Tidsmål">
          <h3>Tidsmål för <span class="tl-settings-kind">övergång</span></h3>
          <p class="tl-settings-help">Gränserna anges i sekunder och gäller vald typ — sänk dem stegvis för att göra övergångarna snabbare.</p>
          <div class="tl-fields">
            <label class="tl-field">
              <span class="tl-field-label">${icon("signal")} Gult vid</span>
              <span class="tl-field-input"><input type="number" name="tl-yellow" inputmode="numeric" min="${MIN_SEC}" step="5" data-cfg="yellow"><span class="tl-unit">sek</span></span>
            </label>
            <label class="tl-field">
              <span class="tl-field-label">${icon("signal")} Rött vid</span>
              <span class="tl-field-input"><input type="number" name="tl-red" inputmode="numeric" min="${MIN_SEC}" step="5" data-cfg="red"><span class="tl-unit">sek</span></span>
            </label>
          </div>
          <label class="tl-show-goal">
            <input type="checkbox" data-show-goal>
            <span>Visa veckomålet för eleverna <span class="tl-show-goal-help">(en diskret rad under klockan, t.ex. "Veckans mål: snitt under 2:40")</span></span>
          </label>
        </section>

        <section class="card tl-stats" aria-label="Statistik och historik"></section>
      </div>
    </section>`;
}
