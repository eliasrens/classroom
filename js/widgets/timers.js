/**
 * WIDGETS — timrar (issue #117): "Kvar av lektionen" och "Nedräkning".
 *
 * Tre utseenden, valda per timer (cfg.look):
 *   - digits  — siffror (mm:ss)
 *   - bar     — stapel som krymper, med siffrorna
 *   - analog  — "Time Timer": urtavla där en röd tårtbit krymper medurs
 *               mot 0 (högst 60 min). Stor på Morgonskärmen, en liten
 *               tårtbit bredvid siffrorna i lektionens bricka.
 *
 * Tiden räknas ALLTID ur tidsstämplar (serverNow + runtime-tillståndet),
 * så lärar- och elevfönster visar samma sak och en omladdning mitt i en
 * nedräkning fortsätter rätt. Tickern (createClockTicker) är bara en ritsignal.
 *
 * Styrning (Start, Paus/Fortsätt, Återställ) finns i widget-inställningarna
 * och som små knappar på brickan/widgeten — BARA i lärarvyn (ritas inte
 * alls i elevvyn och har dessutom .teacher-only).
 *
 * När tiden är ute: lugn pulsering + "Tiden är ute" (ingen puls med
 * prefers-reduced-motion — bara färgmarkeringen), och en mjuk ton om
 * läraren slagit på ljud (chime.js — spelas i ett fönster, en gång).
 */

import { serverNow } from "../lib/clock.js";
import { createClockTicker } from "./clock-shared.js";
import { icon } from "../lib/icons.js";
import {
  readRuntime, writeRuntime, watchRuntime, startTimer, pauseTimer, resumeTimer,
} from "./runtime.js";
import {
  LOOKS, LOOK_LABELS, MAX_MINUTES, normalizeTimeLeftCfg, normalizeCountdownCfg,
  countdownDurationMs, lessonLeftView, untilView, countdownView, piePath,
} from "./timer-logic.js";
import { createChimer } from "./chime.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const mounts = new WeakMap(); // el → cleanup()

// ---------------------------------------------------------------------------
// Urtavlan (SVG, viewBox 0 0 100 100)
// ---------------------------------------------------------------------------

const PIE_R_LARGE = 33;
const PIE_R_CHIP = 44;

function faceSVG(form) {
  if (form === "chip") {
    return `<svg class="wt-face wt-face--chip" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="wt-face__bg" cx="50" cy="50" r="46"/>
      <path class="wt-face__pie" d=""/>
    </svg>`;
  }
  const ticks = [];
  for (let m = 0; m < 60; m++) {
    const a = (m * 6 * Math.PI) / 180;
    const major = m % 5 === 0;
    const r1 = major ? 35 : 36.5;
    const r2 = 40;
    // Minuterna går MOTURS från 12 (som på en "Time Timer").
    const p = (r) => [50 - r * Math.sin(a), 50 - r * Math.cos(a)].map((n) => n.toFixed(2));
    const [x1, y1] = p(r1);
    const [x2, y2] = p(r2);
    ticks.push(`<line class="wt-face__tick${major ? " wt-face__tick--major" : ""}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  }
  const nums = [];
  for (let m = 0; m < 60; m += 5) {
    const a = (m * 6 * Math.PI) / 180;
    const x = (50 - 45.5 * Math.sin(a)).toFixed(2);
    const y = (50 - 45.5 * Math.cos(a)).toFixed(2);
    nums.push(`<text x="${x}" y="${y}">${m}</text>`);
  }
  return `<svg class="wt-face wt-face--large" viewBox="0 0 100 100" aria-hidden="true">
    <circle class="wt-face__bg" cx="50" cy="50" r="49.5"/>
    <path class="wt-face__pie" d=""/>
    ${ticks.join("")}
    <g class="wt-face__nums">${nums.join("")}</g>
    <circle class="wt-face__knob" cx="50" cy="50" r="4.5"/>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Knappar (lärarvyn)
// ---------------------------------------------------------------------------

/** Knapparna som passar ett läge: [{ act, label, icon }]. */
function controlsFor(status) {
  if (status === "idle") return [{ act: "start", label: "Start", icon: "play" }];
  if (status === "running") return [{ act: "pause", label: "Paus", icon: "pause" }, { act: "reset", label: "Återställ", icon: "reset" }];
  if (status === "paused") return [{ act: "resume", label: "Fortsätt", icon: "play" }, { act: "reset", label: "Återställ", icon: "reset" }];
  if (status === "done") return [{ act: "reset", label: "Återställ", icon: "reset" }];
  return [];
}

/** Utför en knapp på nedräkningens körtillstånd. */
export function countdownAct(act, cfg, rt) {
  const now = serverNow();
  if (act === "start") rt.write(startTimer(countdownDurationMs(cfg), now));
  else if (act === "pause") { const s = rt.read(); if (s) rt.write(pauseTimer(s, now)); }
  else if (act === "resume") { const s = rt.read(); if (s) rt.write(resumeTimer(s, now)); }
  else if (act === "reset") rt.write(null);
}

function ctlHTML(status, { withText = false, cls = "" } = {}) {
  return controlsFor(status).map((b) =>
    `<button type="button" class="${cls}" data-wt-act="${b.act}" title="${b.label}" aria-label="${b.label}">${icon(b.icon)}${withText ? `<span>${b.label}</span>` : ""}</button>`).join("");
}

// ---------------------------------------------------------------------------
// Trång rubrikrad: brickornas yta (.lb-widgets) har fast storlek. Ryms inte
// timerbrickorna tas det minst viktiga bort, ett steg i taget:
//   1 "Kvar" (kvar av lektionen), 2 rubrikerna kortas ("Läs…"), 3 rubrikerna
//   bort, 4 "Tiden är ute" blir "0:00", 5 raden vänsterställs (sista brickan
//   klipps i kanten). Siffrorna står alltid kvar. Stilarna: css/ui/widgets.css.
// ---------------------------------------------------------------------------

const FIT_LEVELS = 5;

function fitRow(row) {
  if (!row?.isConnected) return;
  const overflows = () => row.scrollWidth > row.clientWidth + 1;
  let level = 0;
  row.dataset.wtFit = "0";
  while (level < FIT_LEVELS && overflows()) row.dataset.wtFit = String(++level);
}

// ---------------------------------------------------------------------------
// Rendering — en gemensam ritare för båda typerna och båda formerna.
// ---------------------------------------------------------------------------

/**
 * Monterar en timer i el.
 *   viewAt(now) → timer-vyn (timer-logic.js)
 *   label       → fast rubrik ("Kvar", lärarens rubrik, …)
 *   minor       → rubriken är minst viktig (tas bort först i en trång rad)
 *   controls    → nedräkningens knappar (bara lärarvyn)
 */
function mountTimer(el, cfg, ctx, { viewAt, label, minor = false, controls = false }) {
  destroy(el);
  const chip = ctx.form === "chip";
  const look = cfg.look;
  const teacher = ctx.view === "teacher";
  const showCtl = controls && teacher;

  const root = document.createElement(chip ? "span" : "div");
  root.className = `wt wt--${chip ? "chip" : "large"} wt--${look}`;
  root.innerHTML = chip
    ? `${look === "analog" ? faceSVG("chip") : ""}<span class="wt__label"></span><span class="wt__time"></span>${look === "bar" ? `<span class="wt-bar"><span class="wt-bar__fill"></span></span>` : ""}${showCtl ? `<span class="wt-ctl teacher-only"></span>` : ""}`
    : `<div class="wt__label"></div>${look === "analog" ? faceSVG("large") : ""}<div class="wt__time"></div>${look === "bar" ? `<div class="wt-bar"><div class="wt-bar__fill"></div></div>` : ""}<div class="wt__state" aria-live="polite"></div>${showCtl ? `<div class="wt-ctl teacher-only"></div>` : ""}`;
  el.append(root);

  const $ = (s) => root.querySelector(s);
  const labelEl = $(".wt__label");
  labelEl.classList.toggle("wt__label--minor", minor); // tas bort först när raden är trång
  const timeEl = $(".wt__time");
  const stateEl = $(".wt__state");
  const pieEl = $(".wt-face__pie");
  const fillEl = $(".wt-bar__fill");
  const ctlEl = $(".wt-ctl");
  const pieR = chip ? PIE_R_CHIP : PIE_R_LARGE;
  const chimer = createChimer({ view: ctx.view, classId: ctx.classId, widgetId: ctx.widgetId });

  const last = {};
  const WIDTH_KEYS = new Set(["label", "text", "status"]); // ändrar brickans bredd
  let widthChanged = false;
  const set = (key, value, fn) => {
    if (last[key] === value) return;
    last[key] = value;
    if (WIDTH_KEYS.has(key)) widthChanged = true;
    fn(value);
  };
  const row = chip ? el.closest(".lb-widgets") : null;

  function paint(now = serverNow()) {
    const v = viewAt(now);
    // Brickan: "Tiden är ute" ersätter rubriken; stort: egen rad under.
    let lab = label;
    let text = v.text;
    if (chip) {
      // Slut i brickan: nedräkningen säger "Tiden är ute" i stället för
      // "0:00", "Kvar av lektionen" säger "Slut" — ett ord, ingen rubrik.
      if (v.status === "done") { lab = ""; if (v.label && v.text === "0:00") text = `${v.label}\u0000${v.text}`; }
      else if (v.status === "paused") lab = [label, v.label].filter(Boolean).join(" · ");
      else if (v.status !== "running" && v.status !== "idle") lab = ""; // "Börjar om 5 min" står för sig själv
    }
    set("label", lab, (t) => { labelEl.textContent = t; labelEl.hidden = !t; });
    set("text", text, (t) => {
      // "lång\0kort": fitRow väljer den korta när den långa inte ryms.
      const [long, short] = t.split("\u0000");
      if (short == null) timeEl.textContent = t;
      else timeEl.innerHTML = `<span class="wt__long">${esc(long)}</span><span class="wt__short">${esc(short)}</span>`;
    });
    if (stateEl) set("state", v.label, (t) => { stateEl.textContent = t; stateEl.hidden = !t; });
    set("status", v.status, (s) => {
      root.dataset.status = s;
      el.dataset.wtStatus = s; // bärarens färgmarkering (.lb-chip / .mw)
      if (ctlEl) ctlEl.innerHTML = ctlHTML(s, { cls: "wt-ctl__btn" });
    });
    set("alarm", v.alarm, (a) => { root.classList.toggle("is-alarm", a); el.classList.toggle("wt-alarm", a); });
    if (pieEl) set("pie", piePath(v.dial, pieR), (d) => pieEl.setAttribute("d", d));
    if (fillEl) set("fill", Math.round(v.fraction * 1000), (f) => { fillEl.style.transform = `scaleX(${f / 1000})`; });
    root.title = [label, v.text, v.label].filter(Boolean).join(" · ");
    chimer.check(v, cfg.sound, now);
    // Bredden ändras bara när texten/läget gör det — mät då (inte varje tick).
    if (row && widthChanged) fitRow(row);
    widthChanged = false;
  }

  // Ritsignal var 250:e ms i takt med klockan (samma i alla fönster) — stoppar
  // av sig själv om brickan försvinner utan destroy.
  const stopTick = createClockTicker(paint, { periodMs: 250, el: root });
  const offWatch = ctx.runtime?.watch?.(() => paint()) ?? (() => {});
  // Tavlan byter storlek (fönstret, --lb-scale) → pröva igen.
  let ro = null;
  if (row && typeof ResizeObserver === "function") {
    let w = row.clientWidth;
    ro = new ResizeObserver(() => { if (row.clientWidth !== w) { w = row.clientWidth; fitRow(row); } });
    ro.observe(row);
  }

  const onClick = (e) => {
    const b = e.target.closest("[data-wt-act]");
    if (!b || !root.contains(b)) return;
    e.preventDefault();
    e.stopPropagation();
    countdownAct(b.dataset.wtAct, cfg, ctx.runtime);
  };
  if (ctlEl) ctlEl.addEventListener("click", onClick);

  mounts.set(el, () => {
    stopTick();
    offWatch();
    ro?.disconnect();
    ctlEl?.removeEventListener("click", onClick);
    root.remove();
    delete el.dataset.wtStatus;
    el.classList.remove("wt-alarm");
  });
}

function destroy(el) {
  mounts.get(el)?.();
  mounts.delete(el);
}

// ---------------------------------------------------------------------------
// Inställningar — delas av typerna
// ---------------------------------------------------------------------------

let setUid = 0;

function looksHTML(cfg, name) {
  return `<div class="wt-set__looks" role="radiogroup" aria-label="Utseende">
    ${LOOKS.map((l) => `<label class="wt-set__look">
      <input type="radio" name="${name}" value="${l}" data-wt="look"${cfg.look === l ? " checked" : ""}>
      <span>${esc(LOOK_LABELS[l])}</span>
    </label>`).join("")}
  </div>`;
}

const soundHTML = (cfg) => `<label class="wt-set__check">
  <input type="checkbox" data-wt="sound"${cfg.sound ? " checked" : ""}> Ljud när tiden är ute
  <span class="wt-set__hint">(en mjuk ton — spelas på elevskärmen om den är öppen, annars här)</span>
</label>`;

/** Kopplar fälten med data-wt till cfg; onChange(ny cfg) för varje ändring. */
function bindFields(root, cfg, onChange, normalize) {
  let cur = { ...cfg };
  const onInput = (e) => {
    const f = e.target.closest("[data-wt]");
    if (!f) return;
    const k = f.dataset.wt;
    let v;
    if (f.type === "checkbox") v = f.checked;
    else if (f.type === "radio") { if (!f.checked) return; v = f.value; }
    else if (f.type === "number") { if (f.value === "") return; v = Number(f.value); }
    else v = f.value;
    cur = normalize({ ...cur, [k]: v });
    onChange(cur);
  };
  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  return {
    get: () => cur,
    off: () => { root.removeEventListener("input", onInput); root.removeEventListener("change", onInput); },
  };
}

// ---------------------------------------------------------------------------
// Typ 1: "Kvar av lektionen"
// ---------------------------------------------------------------------------

export const timeLeft = {
  id: "time-left",
  name: "Kvar av lektionen",
  names: { morning: "Nedräkning till klockslag" },
  icon: "clock",
  multiple: false,
  defaults: () => normalizeTimeLeftCfg({}),
  normalize: (cfg) => normalizeTimeLeftCfg(cfg),

  renderChip(el, cfg, ctx) {
    const c = normalizeTimeLeftCfg(cfg);
    // Tårtbiten säger "kvar" själv — då får siffrorna platsen.
    mountTimer(el, c, ctx, { label: c.look === "analog" ? "" : "Kvar", minor: true, viewAt: (now) => lessonLeftView(ctx.lesson, now) });
  },
  renderLarge(el, cfg, ctx) {
    const c = normalizeTimeLeftCfg(cfg);
    mountTimer(el, c, ctx, {
      label: c.until ? `Kvar till ${c.until}` : "Kvar",
      viewAt: (now) => untilView(c.until, now),
    });
  },
  destroy,

  settingsHTML(cfg, ctx) {
    const c = normalizeTimeLeftCfg(cfg);
    const name = `wt-${++setUid}`;
    const when = ctx.form === "morning"
      ? `<label class="wt-set__row"><span>Klockslag</span>
          <input type="time" class="input wt-set__time" data-wt="until" value="${esc(c.until)}" required></label>`
      : `<p class="wt-set__hint">Räknar ned till planeringens sluttid (Tid). Före start visas "Börjar om … min", efter sluttiden "Slut".</p>`;
    return `<div class="wt-set">${when}
      <div class="wt-set__row"><span>Utseende</span>${looksHTML(c, name)}</div>
      ${soundHTML(c)}</div>`;
  },
  bindSettings(root, cfg, onChange) {
    const f = bindFields(root, normalizeTimeLeftCfg(cfg), onChange, normalizeTimeLeftCfg);
    return f.off;
  },
};

// ---------------------------------------------------------------------------
// Typ 2: "Nedräkning" (flera samtidigt)
// ---------------------------------------------------------------------------

export const countdown = {
  id: "countdown",
  name: "Nedräkning",
  icon: "reset",
  multiple: true,
  defaults: () => normalizeCountdownCfg({}),
  normalize: (cfg) => normalizeCountdownCfg(cfg),

  renderChip(el, cfg, ctx) {
    const c = normalizeCountdownCfg(cfg);
    mountTimer(el, c, ctx, { label: c.title, controls: true, viewAt: (now) => countdownView(c, ctx.runtime.read(), now) });
  },
  renderLarge(el, cfg, ctx) {
    const c = normalizeCountdownCfg(cfg);
    mountTimer(el, c, ctx, { label: c.title, controls: true, viewAt: (now) => countdownView(c, ctx.runtime.read(), now) });
  },
  destroy,

  settingsHTML(cfg) {
    const c = normalizeCountdownCfg(cfg);
    const name = `wt-${++setUid}`;
    return `<div class="wt-set">
      <label class="wt-set__row"><span>Rubrik</span>
        <input type="text" class="input wt-set__title" data-wt="title" value="${esc(c.title)}" placeholder="Rubrik (valfritt)" maxlength="60"></label>
      <div class="wt-set__row"><span>Tid</span>
        <label class="wt-set__num"><input type="number" class="input" data-wt="minutes" min="0" max="${MAX_MINUTES}" value="${c.minutes}" aria-label="Minuter"> min</label>
        <label class="wt-set__num"><input type="number" class="input" data-wt="seconds" min="0" max="59" step="5" value="${c.seconds}" aria-label="Sekunder"> s</label>
      </div>
      <div class="wt-set__row"><span>Utseende</span>${looksHTML(c, name)}</div>
      ${soundHTML(c)}
      <div class="wt-set__run" data-wt-run>
        <span class="wt-set__status" data-wt-status aria-live="polite"></span>
        <span class="wt-set__btns" data-wt-btns></span>
      </div>
    </div>`;
  },

  /** Fälten + körknapparna (Start, Paus/Fortsätt, Återställ) med levande status. */
  bindSettings(root, cfg, onChange, ctx) {
    const f = bindFields(root, normalizeCountdownCfg(cfg), onChange, normalizeCountdownCfg);
    const rt = {
      read: () => readRuntime(ctx.classId, ctx.widgetId),
      write: (s) => writeRuntime(ctx.classId, ctx.widgetId, s),
    };
    const statusEl = root.querySelector("[data-wt-status]");
    const btnsEl = root.querySelector("[data-wt-btns]");
    let lastStatus = null;
    const paint = () => {
      const v = countdownView(f.get(), rt.read(), serverNow());
      const word = { idle: "Inte startad", running: "Går", paused: "Pausad", done: "Tiden är ute" }[v.status] ?? "";
      const text = `${v.text} · ${word}`;
      if (statusEl.textContent !== text) statusEl.textContent = text;
      statusEl.dataset.status = v.status;
      if (v.status !== lastStatus) {
        lastStatus = v.status;
        btnsEl.innerHTML = ctlHTML(v.status, { withText: true, cls: "btn wt-set__btn" });
      }
    };
    const onClick = (e) => {
      const b = e.target.closest("[data-wt-act]");
      if (!b) return;
      countdownAct(b.dataset.wtAct, f.get(), rt);
      paint();
    };
    btnsEl.addEventListener("click", onClick);
    const stopTick = createClockTicker(() => paint(), { periodMs: 250, el: root });
    const offWatch = watchRuntime(ctx.classId, ctx.widgetId, () => paint());
    return () => {
      f.off();
      stopTick();
      offWatch();
      btnsEl.removeEventListener("click", onClick);
    };
  },
};
