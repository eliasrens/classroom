/**
 * VECKANS ÖVERGÅNGAR (issue #36) — veckosammanfattning för mentorstiden.
 *
 * Ett elevvänligt helskärmsläge som visar veckans trafikljuspass (bara
 * tider och färger) på fyra "sidor" som läraren bläddrar mellan:
 *
 *   Översikt → Dag för dag → Snabbaste → Målet (+ trend)
 *
 * Varför sidor och inte en enda skärm: allt på en gång blir för smått för
 * att läsas längst bak i klassrummet, och läraren vill prata om en sak i
 * taget ("Vilken dag gick bäst?"). Varje sida har FÅ element och STOR text.
 *
 * Lärarvyn: veckoväljare (standard innevarande vecka), typ (övergång /
 * datorer — datorer bara när veckan har sådana pass), sidknappar och en
 * förhandsvisning i elevskärmens format. Piltangenter (och PageUp/PageDown
 * från en presentationsklickare) bläddrar. Elevskärmen följer med via
 * sync-bussen (`vecka:view`) och datalagret (settings/vecka), så en nyöppnad
 * elevskärm hamnar direkt på rätt sida.
 *
 * Enskärmsläge ("Helskärm här"): fönstret är då lärarens eget, så
 * bläddertangenterna fungerar även i elevvyn där (isSingleScreenWindow).
 *
 * Integritet: visar ENBART passens tid, färg, dag och lektion — aldrig
 * lärarnamn, noteringar eller något elevspecifikt. Beräkningarna ligger i
 * js/lib/week-recap.js (veckan och målet återanvänds ur week.js och
 * week-goal.js, tiden är serverNow()).
 */

import { icon } from "../lib/icons.js";
import { serverNow } from "../lib/clock.js";
import { startOfWeek, addWeeks, weekKey, weekStartFromKey, isoWeek, weekRangeLabel } from "../lib/week.js";
import { KINDS, mergedSubjects } from "../lib/trafikljus-stats.js";
import { GOAL_METRICS, normalizeGoalSettings, fmtSec } from "../lib/week-goal.js";
import { weekRecap, hasWeekPasses, WEEKDAYS } from "../lib/week-recap.js";
import { isSingleScreenWindow } from "../sync.js";
import { escapeHtml } from "./elever/shared.js";

const STATE_ID = "vecka";            // settings/vecka → { value: { week: "2026-W39"|null, kind, page } }
const GOAL_CONFIG_ID = "trafikljus"; // settings/trafikljus → veckomålets mått (goalMetric per typ)
const EVENT = "vecka:view";          // sync-bussen: samma payload som settings/vecka

const settingsPath = (cid) => `classes/${cid}/settings`;
const sessionsPath = (cid) => `classes/${cid}/sessions`;

export const PAGES = [
  { key: "oversikt",  label: "Översikt" },
  { key: "dagar",     label: "Dag för dag" },
  { key: "snabbaste", label: "Snabbaste" },
  { key: "malet",     label: "Målet" },
];

/** Texter per passtyp — för eleverna (plural/singular). */
const KIND_TEXT = {
  overgang: { title: "Veckans övergångar", unit: (n) => (n === 1 ? "övergång" : "övergångar"), none: "Inga övergångar sparade den här veckan." },
  datorer:  { title: "Veckans datorpass",  unit: () => "datorpass", none: "Inga datorpass sparade den här veckan." },
};

const COLOR_NAME = { green: "gröna", yellow: "gula", red: "röda" };

// Lärarens val överlever byte av läge under sessionen. week null = "denna vecka".
const ui = { week: null, kind: "overgang", page: 0 };

/** Normalisera ett visningstillstånd (från datalagret/bussen). */
function normalizeView(raw) {
  const page = Number.isInteger(raw?.page) && raw.page >= 0 && raw.page < PAGES.length ? raw.page : 0;
  const week = typeof raw?.week === "string" && weekStartFromKey(raw.week) != null ? raw.week : null;
  const kind = KINDS[raw?.kind] ? raw.kind : "overgang";
  return { week, kind, page };
}

/** Veckostart för ett tillstånd — null/framtida vecka = innevarande. */
function weekStartOf(view, now = serverNow()) {
  const cur = startOfWeek(now);
  const ws = view.week ? weekStartFromKey(view.week) : null;
  return ws == null || ws > cur ? cur : ws;
}

/** "12 sekunder" / "1 sekund" / "1:05" — för eleverna, inte förkortat. */
function diffText(sec) {
  const s = Math.max(1, Math.round(sec));
  if (s < 60) return `${s} ${s === 1 ? "sekund" : "sekunder"}`;
  return fmtSec(s);
}

const dot = (color, cls = "") => `<span class="vk-dot${cls}" data-color="${color}" aria-hidden="true"></span>`;

const clockOf = (ts) => new Date(ts).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });

// ---- Sidorna (ren markup ur weekRecap) ------------------------------------

function pageOverview(r) {
  const t = KIND_TEXT[r.kind];
  if (r.count === 0) {
    return `
      <div class="vk-page vk-page--overview is-empty">
        <p class="vk-lead">${t.none}</p>
        <p class="vk-sub">Nya chanser nästa vecka.</p>
      </div>`;
  }
  const share = r.counts.green / r.count;
  const cheer = share >= 0.75 ? "Riktigt fina övergångar!"
    : share >= 0.5 ? "Bra jobbat — mer än hälften gröna!"
    : r.counts.green > 0 ? "Bra kämpat! Varje gång är en ny chans."
    : "Nästa vecka tar vi nya tag tillsammans.";
  const tile = (c) => `
    <li class="vk-tile" data-color="${c}">
      ${dot(c, " vk-dot--big")}
      <span class="vk-tile__n">${r.counts[c]}</span>
      <span class="vk-tile__l">${COLOR_NAME[c]}</span>
    </li>`;
  return `
    <div class="vk-page vk-page--overview">
      <p class="vk-total"><span class="vk-total__n">${r.count}</span> <span class="vk-total__l">${t.unit(r.count)}</span></p>
      <ul class="vk-tiles" aria-label="Per färg">${["green", "yellow", "red"].map(tile).join("")}</ul>
      <p class="vk-cheer">${cheer}</p>
    </div>`;
}

function pageDays(r) {
  const rows = r.days.map((d) => {
    const passes = d.passes.length === 0
      ? `<span class="vk-day__none">Inga pass</span>`
      : d.passes.map((p) => `
          <span class="vk-chip" data-color="${p.color}">
            ${dot(p.color)}<span class="vk-chip__time">${fmtSec(p.durationSec)}</span>
            ${p.lesson ? `<span class="vk-chip__lesson">${escapeHtml(p.lesson)}</span>` : ""}
          </span>`).join("");
    return `
      <li class="vk-day${d.passes.length === 0 ? " is-empty" : ""}">
        <span class="vk-day__name">${WEEKDAYS[d.weekday]}</span>
        <span class="vk-day__passes">${passes}</span>
      </li>`;
  }).join("");
  return `<div class="vk-page vk-page--days"><ul class="vk-days">${rows}</ul></div>`;
}

function pageFastest(r) {
  const f = r.fastest;
  if (!f) {
    return `
      <div class="vk-page vk-page--fastest is-empty">
        <p class="vk-lead">${KIND_TEXT[r.kind].none}</p>
      </div>`;
  }
  const when = [WEEKDAYS[f.weekday], `kl. ${clockOf(f.at)}`, f.lesson ? escapeHtml(f.lesson) : ""].filter(Boolean).join(" · ");
  return `
    <div class="vk-page vk-page--fastest">
      <span class="vk-star" aria-hidden="true">${icon("star", { strokeWidth: 1.4 })}</span>
      <p class="vk-kicker">Veckans snabbaste</p>
      <p class="vk-fast-time">${dot(f.color, " vk-dot--big")}${fmtSec(f.durationSec)}</p>
      <p class="vk-fast-when">${when}</p>
    </div>`;
}

function trendMarkup(r) {
  const weeks = r.trend;
  if (weeks.filter((w) => w.avgSec != null).length < 2) return "";
  const max = Math.max(...weeks.map((w) => w.avgSec ?? 0), 1);
  const bars = weeks.map((w) => `
    <li class="vk-bar${w.current ? " is-current" : ""}">
      <span class="vk-bar__v">${w.avgSec == null ? "–" : fmtSec(w.avgSec)}</span>
      <span class="vk-bar__track"><span class="vk-bar__fill" style="height:${w.avgSec == null ? 0 : Math.max(4, Math.round((w.avgSec / max) * 100))}%"></span></span>
      <span class="vk-bar__l">${w.current ? "Denna" : `v.${isoWeek(w.weekStart).week}`}</span>
    </li>`).join("");
  return `
    <section class="vk-trend" aria-label="Snittid vecka för vecka">
      <p class="vk-trend__title">Snittid vecka för vecka</p>
      <ol class="vk-bars">${bars}</ol>
    </section>`;
}

function pageGoal(r) {
  const { goal, summary, progress } = r.goal;
  const M = GOAL_METRICS[r.metric];
  const valueName = { avg: "Ert snitt", best: "Er bästa tid", total: "Er totaltid" }[r.metric];
  let state = "none";
  let body;

  if (!goal) {
    body = summary
      ? `<p class="vk-lead">Nu har ni ett mål att slå!</p>
         <p class="vk-goal-line">${icon("flag")} Nästa veckas mål: ${M.short} under <strong>${fmtSec(r.nextTargetSec)}</strong></p>`
      : `<p class="vk-lead">Inget veckomål ännu.</p>
         <p class="vk-sub">Målet sätts när klassen har sparat ${KIND_TEXT[r.kind].unit(2)}.</p>`;
  } else {
    const from = goal.prev.adjacent ? `förra veckans ${M.short}` : `${M.short} från v.${isoWeek(goal.prev.weekStart).week}`;
    const goalLine = `<p class="vk-goal-line">${icon("flag")} Mål: ${M.short} under <strong>${fmtSec(goal.targetSec)}</strong>
      <span class="vk-goal-from">(${from})</span></p>`;
    if (!summary) {
      state = "open";
      body = `${goalLine}<p class="vk-lead">${KIND_TEXT[r.kind].none}</p>`;
    } else if (progress.met) {
      state = "met";
      body = `${goalLine}
        <p class="vk-goal-value">${valueName}: <strong>${fmtSec(progress.valueSec)}</strong></p>
        <p class="vk-goal-badge">${icon("check", { strokeWidth: 2.6 })}<span>Målet klarat!</span></p>`;
    } else {
      state = "open";
      const close = progress.diffSec <= Math.max(30, goal.targetSec * 0.2);
      body = `${goalLine}
        <p class="vk-goal-value">${valueName}: <strong>${fmtSec(progress.valueSec)}</strong></p>
        <p class="vk-goal-near">${close ? "Nästan!" : "Bra kämpat!"} ${diffText(progress.diffSec)} från målet</p>
        <p class="vk-sub">${r.weekOver ? "Nytt försök nästa vecka." : "Det finns tid kvar i veckan!"}</p>`;
    }
  }
  return `
    <div class="vk-page vk-page--goal" data-goal-state="${state}">
      <div class="vk-goal">${body}</div>
      ${trendMarkup(r)}
    </div>`;
}

const PAGE_RENDER = [pageOverview, pageDays, pageFastest, pageGoal];

/** Hela scenens innehåll: huvud, vald sida och sidprickar. */
function stageContent(r, page) {
  const { week } = isoWeek(r.weekStart);
  return `
    <header class="vk-head">
      <h1 class="vk-title">${KIND_TEXT[r.kind].title}</h1>
      <p class="vk-week">Vecka ${week} · ${escapeHtml(weekRangeLabel(r.weekStart))}</p>
    </header>
    <div class="vk-body">${PAGE_RENDER[page](r)}</div>
    <ol class="vk-progress" aria-label="Sida ${page + 1} av ${PAGES.length}">
      ${PAGES.map((p, i) => `<li${i === page ? ' class="is-on"' : ""}><span class="vk-progress__dot"></span>${p.label}</li>`).join("")}
    </ol>`;
}

// ---- Anpassning: allt ryms, inget scrollar --------------------------------

const FIT_MIN = 0.5;

/** Största --vk-fit i [FIT_MIN, 1] där sidan ryms (binärsökning). */
function fitStage(stage) {
  const body = stage?.querySelector(".vk-body");
  if (!body?.isConnected) return;
  const set = (v) => stage.style.setProperty("--vk-fit", v.toFixed(3));
  const fits = () => body.scrollHeight <= body.clientHeight + 1 && body.scrollWidth <= body.clientWidth + 1;
  set(1);
  if (fits()) return;
  let lo = FIT_MIN;
  let hi = 1;
  while (hi - lo > 0.02) {
    const mid = (lo + hi) / 2;
    set(mid);
    if (fits()) lo = mid; else hi = mid;
  }
  set(lo);
}

// ---- Konfetti (en gång när målet är klarat) -------------------------------

const reducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

function confetti(layer) {
  if (!layer || reducedMotion()) return;
  const colors = ["var(--tl-green-bg)", "var(--tl-yellow-bg)", "var(--tl-red-bg)", "var(--color-accent)", "#5577b5"];
  layer.innerHTML = Array.from({ length: 70 }, (_, i) => {
    const x = Math.random() * 100;
    const delay = Math.random() * 0.8;
    const dur = 2.4 + Math.random() * 1.6;
    const drift = (Math.random() - 0.5) * 30;
    const rot = Math.round(Math.random() * 720 - 360);
    return `<span style="left:${x.toFixed(1)}%;--d:${drift.toFixed(1)}cqw;--r:${rot}deg;background:${colors[i % colors.length]};animation-delay:${delay.toFixed(2)}s;animation-duration:${dur.toFixed(2)}s"></span>`;
  }).join("");
  clearTimeout(layer._t);
  layer._t = setTimeout(() => { layer.innerHTML = ""; }, 5000);
}

// ---- Läget ------------------------------------------------------------------

export default {
  id: "vecka",
  title: "Veckans övergångar",
  icon: "star",

  async mount(el, ctx) {
    const offs = [];
    this._offs = offs; // städning registreras innan något startas

    const { view, activeClass, data, sync } = ctx;
    const isStudent = view === "student";

    if (!activeClass) {
      el.innerHTML = `
        <div class="mode-placeholder">
          <div class="mode-placeholder__icon">${icon("star", { size: 44, strokeWidth: 1.4 })}</div>
          <h1>Veckans övergångar</h1>
          <p>${isStudent ? "Ingen klass vald." : "Välj en klass i topbaren för att visa veckans övergångar."}</p>
        </div>`;
      return;
    }

    const cid = activeClass.id;
    let sessions = [];
    let subjects = mergedSubjects([]);
    let goalCfg = normalizeGoalSettings(null);
    let state = isStudent ? normalizeView(null) : normalizeView(ui);
    let drawnPage = null;
    let drawnWeek = null;
    let celebrated = null; // "vecka:typ" som redan fått konfetti på den här visningen av Målet

    el.innerHTML = isStudent ? studentMarkup() : teacherMarkup();
    const stage = el.querySelector(".vk-stage");
    const content = stage.querySelector(".vk-content");
    const confettiLayer = stage.querySelector(".vk-confetti");

    /** Datorer visas bara när veckan har datorpass — annars övergångar. */
    function effectiveKind(ws) {
      return state.kind === "datorer" && hasWeekPasses(sessions, "datorer", ws) ? "datorer" : "overgang";
    }

    function draw() {
      if (!stage.isConnected) return;
      const ws = weekStartOf(state);
      const kind = effectiveKind(ws);
      const r = weekRecap(sessions, kind, goalCfg.goalMetric[kind], ws, { subjects });
      const entering = drawnPage !== state.page;
      drawnPage = state.page;
      drawnWeek = startOfWeek(serverNow());
      content.innerHTML = stageContent(r, state.page);
      stage.dataset.page = PAGES[state.page].key;
      if (entering && !reducedMotion()) {
        content.classList.remove("is-entering");
        void content.offsetWidth; // starta om animationen
        content.classList.add("is-entering");
      }
      fitStage(stage);

      // Konfetti EN gång när Målet visas med klarat mål (bara elevskärmen).
      const met = PAGES[state.page].key === "malet" && r.goal.progress?.met;
      const key = `${ws}:${kind}`;
      if (!met || entering) celebrated = null;
      if (met && isStudent && celebrated !== key) { celebrated = key; confetti(confettiLayer); }

      if (!isStudent) drawControls(ws, kind);
    }

    // Tavlan följer ytan (helskärm, fönsterstorlek) → anpassa om.
    if (typeof ResizeObserver === "function") {
      let frame = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => fitStage(stage));
      });
      ro.observe(stage);
      offs.push(() => { cancelAnimationFrame(frame); ro.disconnect(); });
    }
    document.fonts?.ready?.then(() => fitStage(stage));

    // Ny vecka medan skärmen står öppen ("denna vecka" flyttar sig).
    const weekTick = setInterval(() => { if (startOfWeek(serverNow()) !== drawnWeek) draw(); }, 60_000);
    offs.push(() => clearInterval(weekTick));

    function applySettings(docs) {
      subjects = mergedSubjects(docs);
      goalCfg = normalizeGoalSettings(docs.find((d) => d.id === GOAL_CONFIG_ID)?.value);
    }

    // ---- Bläddring (lärarvyn, eller lärarens eget fönster i enskärmsläge) ----

    let controlsReady = false; // lärarvyn: publicera först när datalagret svarat
    function setView(next) {
      const n = normalizeView({ ...state, ...next });
      if (n.week === state.week && n.kind === state.kind && n.page === state.page) return;
      state = n;
      Object.assign(ui, n); // även enskärmsläget: lärarvyn tar vid där bläddringen slutade
      draw();
      publish();
    }
    function publish() {
      sync.publish(EVENT, state);
      void data.put(settingsPath(cid), { id: STATE_ID, value: state });
    }
    const flip = (step) => setView({ page: Math.min(PAGES.length - 1, Math.max(0, state.page + step)) });

    const canFlipHere = !isStudent || isSingleScreenWindow();
    if (canFlipHere) {
      const onKey = (e) => {
        const t = e.target;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (document.querySelector(".quick-note[data-open], .help[data-open]")) return;
        if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); flip(1); }
        else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); flip(-1); }
        else if (e.key === "Home") { e.preventDefault(); setView({ page: 0 }); }
        else if (e.key === "End") { e.preventDefault(); setView({ page: PAGES.length - 1 }); }
      };
      window.addEventListener("keydown", onKey);
      offs.push(() => window.removeEventListener("keydown", onKey));
    }

    // ---- Elevvy: följ lärarens val ----

    if (isStudent) {
      offs.push(data.watch(settingsPath(cid), (docs) => {
        applySettings(docs);
        state = normalizeView(docs.find((d) => d.id === STATE_ID)?.value);
        draw();
      }));
      offs.push(sync.on(EVENT, ({ payload }) => { state = normalizeView(payload); draw(); }));
      offs.push(data.watch(sessionsPath(cid), (docs) => { sessions = docs; draw(); }));
      draw();
      return;
    }

    // ---- Lärarvy: veckoväljare, typ, sidor ----

    const weekLabelEl = el.querySelector(".vk-weeklabel");
    const prevWeekBtn = el.querySelector('[data-week="prev"]');
    const nextWeekBtn = el.querySelector('[data-week="next"]');
    const nowWeekBtn = el.querySelector('[data-week="now"]');
    const kindBtns = [...el.querySelectorAll(".vk-seg[data-kind]")];
    const pageBtns = [...el.querySelectorAll(".vk-pagebtn[data-page]")];
    const prevPageBtn = el.querySelector('[data-flip="-1"]');
    const nextPageBtn = el.querySelector('[data-flip="1"]');
    const kindNoteEl = el.querySelector(".vk-kind-note");

    function drawControls(ws, kind) {
      const cur = startOfWeek(serverNow());
      const { week } = isoWeek(ws);
      weekLabelEl.textContent = `${ws === cur ? "Denna vecka · " : ""}v.${week} · ${weekRangeLabel(ws)}`;
      nextWeekBtn.disabled = ws >= cur;
      nowWeekBtn.disabled = ws >= cur;
      const hasDatorer = hasWeekPasses(sessions, "datorer", ws);
      for (const b of kindBtns) {
        const on = b.dataset.kind === kind;
        b.setAttribute("aria-pressed", String(on));
        b.disabled = b.dataset.kind === "datorer" && !hasDatorer;
      }
      kindNoteEl.hidden = hasDatorer;
      pageBtns.forEach((b, i) => b.setAttribute("aria-current", i === state.page ? "step" : "false"));
      prevPageBtn.disabled = state.page === 0;
      nextPageBtn.disabled = state.page === PAGES.length - 1;
    }

    prevWeekBtn.addEventListener("click", () => setView({ week: weekKey(addWeeks(weekStartOf(state), -1)) }));
    nextWeekBtn.addEventListener("click", () => {
      const next = addWeeks(weekStartOf(state), 1);
      setView({ week: next >= startOfWeek(serverNow()) ? null : weekKey(next) });
    });
    nowWeekBtn.addEventListener("click", () => setView({ week: null }));
    for (const b of kindBtns) b.addEventListener("click", () => setView({ kind: b.dataset.kind }));
    for (const b of pageBtns) b.addEventListener("click", () => setView({ page: Number(b.dataset.page) }));
    prevPageBtn.addEventListener("click", () => flip(-1));
    nextPageBtn.addEventListener("click", () => flip(1));

    offs.push(data.watch(settingsPath(cid), (docs) => {
      applySettings(docs);
      // Första svaret: se till att elevskärmen visar det läraren ser.
      if (!controlsReady) {
        controlsReady = true;
        const stored = normalizeView(docs.find((d) => d.id === STATE_ID)?.value);
        if (stored.week !== state.week || stored.kind !== state.kind || stored.page !== state.page) publish();
        else sync.publish(EVENT, state);
      }
      draw();
    }));
    offs.push(data.watch(sessionsPath(cid), (docs) => { sessions = docs; draw(); }));
    draw();
  },

  async unmount() {
    for (const off of (this._offs ?? []).splice(0)) { try { off(); } catch { /* ok */ } }
  },
};

// ---- Markup-mallar --------------------------------------------------------

function stageMarkup() {
  // .theme-student: förhandsvisningen i lärarvyn får elevskärmens ljusa tema.
  return `
    <div class="vk-stage theme-student" data-page="oversikt">
      <div class="vk-content"></div>
      <div class="vk-confetti" aria-hidden="true"></div>
    </div>`;
}

function studentMarkup() {
  return `<section class="vk vk--student">${stageMarkup()}</section>`;
}

function teacherMarkup() {
  const kindBtn = (k) => `<button type="button" class="vk-seg" data-kind="${k}" aria-pressed="false">${icon(KINDS[k].icon)}<span>${KINDS[k].label}</span></button>`;
  return `
    <section class="vk vk--teacher">
      <header class="vk-toolbar teacher-only">
        <div class="vk-weeknav" role="group" aria-label="Vecka">
          <button type="button" class="btn btn--ghost btn--icon" data-week="prev" title="Föregående vecka" aria-label="Föregående vecka">${icon("chevron-left")}</button>
          <span class="vk-weeklabel" aria-live="polite"></span>
          <button type="button" class="btn btn--ghost btn--icon" data-week="next" title="Nästa vecka" aria-label="Nästa vecka">${icon("chevron-right")}</button>
          <button type="button" class="btn btn--ghost" data-week="now">Denna vecka</button>
        </div>
        <div class="vk-kinds" role="group" aria-label="Typ av pass">
          ${Object.keys(KINDS).map(kindBtn).join("")}
          <span class="vk-kind-note" hidden>Inga datorpass den veckan</span>
        </div>
      </header>

      <div class="vk-preview">${stageMarkup()}</div>

      <nav class="vk-pager teacher-only" aria-label="Sidor">
        <button type="button" class="btn btn--icon" data-flip="-1" title="Föregående sida (vänsterpil)" aria-label="Föregående sida">${icon("chevron-left")}</button>
        ${PAGES.map((p, i) => `<button type="button" class="vk-pagebtn" data-page="${i}"><span class="vk-pagebtn__n">${i + 1}</span>${p.label}</button>`).join("")}
        <button type="button" class="btn btn--icon" data-flip="1" title="Nästa sida (högerpil)" aria-label="Nästa sida">${icon("chevron-right")}</button>
      </nav>
      <p class="vk-hint teacher-only">Bläddra med <kbd>←</kbd> <kbd>→</kbd> (eller en presentationsklickare). Skicka ut med
        <strong>Visa på elevskärm</strong> — elevskärmen följer med när du bläddrar. Visar bara tider och färger: inga namn, inga noteringar.</p>
    </section>`;
}
