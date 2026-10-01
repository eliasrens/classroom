/**
 * WIDGET — Ljudmätare (issue #118).
 *
 * Mäter ljudnivån i klassrummet med mikrofonen (getUserMedia + Web Audio
 * AnalyserNode, js/widgets/sound-mic.js) och visar den som en stapel
 * (bricka) eller en halvcirkelmätare (stor) med zonerna grön, gul och röd.
 *
 * DATASKYDD: allt analyseras lokalt. Inget spelas in, lagras eller skickas.
 * Mikrofonen körs i ETT fönster — lärarfönstret, där behörigheten finns —
 * och öppnas bara när läraren trycker Starta. Därifrån går nivån (ett tal
 * per mätning, ~10 per sekund) till elevskärmen via sync-bussen
 * (`widgets:sound`, samma dator). Elevvyn öppnar aldrig mikrofonen och
 * visar ingenting när mätaren inte går (av, nekad, ingen mikrofon).
 *
 * Inställningar (cfg): limit (gränsen för "för högt", 0,1–0,95 på mätarens
 * skala) och linkSign ("Koppla till skylten": gränsen följer den valda
 * nivån på Ljudnivåskylten i samma lista, sound-level.js SIGN_LIMITS).
 * Ligger nivån över gränsen i mer än några sekunder blir mätaren lugnt röd
 * (createOverDetector) — ingen ljudsignal.
 *
 * Mikrofonen stängs helt när läraren trycker Stoppa, när mätaren inte
 * längre visas någonstans i lärarfönstret (widgeten kryssas ur, läget byts)
 * och när fönstret stängs.
 */

import { icon } from "../lib/icons.js";
import { readRuntime, watchRuntime } from "./runtime.js";
import { mic } from "./sound-mic.js";
import { fitSoundRow, watchSoundRow } from "./sound-sign.js";
import {
  clampLimit, effectiveLimit, warnFrom, signLevelOf, normalizeNames, limitForSign,
  createOverDetector, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT,
} from "./sound-level.js";

/** Sync-bussens meddelandetyp (lärare → elevskärm). */
export const SOUND_MSG = "widgets:sound";
/** Elevvyn: ingen nivå på så här länge → mätaren döljs (läraren stängde fönstret e.d.). */
export const STALE_MS = 2500;
export const PRIVACY_TEXT = "Mikrofonen används bara för att mäta ljudnivån här och nu — inget spelas in eller sparas.";

const SIGN_TYPE = "sound-sign";

const defaults = () => ({ limit: DEFAULT_LIMIT, linkSign: false });
const normalize = (cfg) => ({ ...cfg, limit: clampLimit(cfg?.limit), linkSign: cfg?.linkSign === true });

const MESSAGES = {
  off: "Mätaren är av — tryck Starta för att mäta ljudnivån.",
  starting: "Väntar på mikrofonen …",
  denied: "Mikrofonen är blockerad för den här sidan. Tillåt mikrofonen i webbläsaren (ikonen i adressfältet) och tryck Starta igen.",
  unavailable: "Hittar ingen mikrofon. Anslut en mikrofon och tryck Starta igen.",
  error: "Mikrofonen gick inte att starta. Försök igen om en stund.",
};
/** Den stora mätarens text ligger ovanpå halvcirkeln (tar ingen plats) — kortare; hela texten står i inställningarna. */
const LARGE_MESSAGES = {
  off: "Tryck Starta för att mäta.",
  starting: "Väntar på mikrofonen …",
  denied: "Mikrofonen är blockerad. Tillåt den i adressfältet och tryck Starta igen.",
  unavailable: "Hittar ingen mikrofon.",
  error: "Mikrofonen gick inte att starta.",
};
const SHORT = { off: "Av", starting: "…", denied: "Nekad", unavailable: "Saknas", error: "Fel" };

// ---------------------------------------------------------------------------
// Lärarfönstret: en kontroll per mätare — gränsen, "för högt"-hysteresen och
// utskicket till elevskärmen. Vyerna (bricka, stor, inställningar) prenumererar.
// ---------------------------------------------------------------------------

const controls = new Map(); // widgetId → control
let micOff = null;
let lastOut = null; // { sync, classId } — dit "av" skickas när mikrofonen stängs

/** Den valda skyltnivån i samma lista, eller null om ingen skylt finns. */
function signLevelFor(c) {
  const sign = (c.siblings?.() ?? []).find((w) => w.type === SIGN_TYPE);
  return sign ? signLevelOf(readRuntime(c.classId, sign.id)) : null;
}
const limitFor = (c) => effectiveLimit(c.cfg, signLevelFor(c));

function stateFor(c, snap = { status: mic.status, owner: mic.owner, level: mic.level }, now = Date.now()) {
  const limit = limitFor(c);
  const mine = snap.owner === c.id;
  if (mine && snap.status === "on") {
    const r = c.detector.update(snap.level, limit, now);
    return { status: "on", level: snap.level, limit, zone: r.zone, alert: r.alert };
  }
  c.detector.reset();
  return { status: mine ? snap.status : "off", level: 0, limit, zone: "green", alert: false };
}

function publish(c, s) {
  if (!c.sync) return;
  try {
    c.sync.publish(SOUND_MSG, { classId: c.classId ?? null, widgetId: c.id, ...s });
    lastOut = { sync: c.sync, classId: c.classId ?? null };
  } catch (err) { console.warn("[ljudmätare] sync:", err); }
}

function onMic(snap) {
  const now = Date.now();
  let sent = false;
  for (const c of controls.values()) {
    const s = stateFor(c, snap, now);
    c.last = s;
    for (const v of c.views) v(s);
    if (snap.owner === c.id) { publish(c, s); sent = true; }
  }
  // Mikrofonen stängdes och ingen mätare äger den längre → elevskärmen döljer.
  if (!sent && lastOut && snap.status !== "on") {
    try { lastOut.sync.publish(SOUND_MSG, { classId: lastOut.classId, status: "off", level: 0 }); } catch { /* ok */ }
    lastOut = null;
  }
}

/**
 * Registrera en vy av mätaren `ctx.widgetId` i lärarfönstret. `draw(state)`
 * anropas vid varje mätning. → detach().
 */
function attachView(ctx, cfg, draw) {
  const id = ctx.widgetId;
  let c = controls.get(id);
  if (!c) {
    c = { id, views: new Set(), detector: createOverDetector(), last: null };
    controls.set(id, c);
  }
  c.cfg = normalize(cfg ?? {});
  c.classId = ctx.classId ?? null;
  if (ctx.sync) c.sync = ctx.sync;
  if (ctx.siblings) c.siblings = ctx.siblings;
  c.views.add(draw);
  micOff ??= mic.subscribe(onMic);
  const offMic = mic.attach(id);
  draw(stateFor(c));
  return {
    control: c,
    detach() {
      c.views.delete(draw);
      offMic();
      // Fördröjt: en vy som monteras om i samma omritning behåller kontrollen.
      setTimeout(() => { if (!c.views.size && controls.get(id) === c) controls.delete(id); }, 0);
    },
  };
}

/** Ritar om alla vyer av mätaren (t.ex. när skyltens nivå eller gränsen ändrats). */
function redraw(c) {
  const s = stateFor(c);
  c.last = s;
  for (const v of c.views) v(s);
}

const isRunning = (id) => mic.owner === id && (mic.status === "on" || mic.status === "starting");

function toggle(id) {
  if (isRunning(id)) mic.stop();
  else void mic.start(id);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const R = 80; // halvcirkelns radie (viewBox −100…100 × −100…12)
const pt = (t) => {
  const a = Math.PI * (1 - Math.min(1, Math.max(0, t)));
  return `${(R * Math.cos(a)).toFixed(2)} ${(-R * Math.sin(a)).toFixed(2)}`;
};
/** Bågen från t1 till t2 (0 = vänster, 1 = höger) på halvcirkeln. */
export const arcPath = (t1, t2) => `M${pt(t1)}A${R} ${R} 0 0 1 ${pt(t2)}`;

function chipHTML(teacher) {
  return `<span class="wsound wsound--chip${teacher ? "" : " wsound--student"}" data-status="off">
    ${icon("mic")}
    <span class="wsound__bar" aria-hidden="true"><span class="wsound__zones"></span><span class="wsound__fill"></span><span class="wsound__mark"></span></span>
    ${teacher ? `<span class="wsound__short"></span>
      <span class="wsound__ctl teacher-only"><button type="button" class="wsound__btn" data-sound-toggle></button></span>` : ""}
  </span>`;
}

function largeHTML(teacher) {
  return `<div class="wsound wsound--large${teacher ? "" : " wsound--student"}" data-status="off">
    <svg class="wsound__gauge" viewBox="-100 -96 200 108" aria-hidden="true" focusable="false">
      <path class="wsound__arc wsound__arc--green"/>
      <path class="wsound__arc wsound__arc--yellow"/>
      <path class="wsound__arc wsound__arc--red"/>
      <path class="wsound__level"/>
      <g class="wsound__needle"><line x1="0" y1="0" x2="0" y2="-66"/></g>
      <circle class="wsound__hub" r="7"/>
    </svg>
    ${teacher ? `<p class="wsound__msg" role="status"></p>
      <button type="button" class="wsound__btn wsound__btn--large" data-sound-toggle></button>` : ""}
  </div>`;
}

const cleanups = new WeakMap(); // el → cleanup()

function mount(el, cfg, ctx, form) {
  destroy(el);
  const teacher = ctx?.view === "teacher";
  el.innerHTML = form === "chip" ? chipHTML(teacher) : largeHTML(teacher);
  const root = el.firstElementChild;
  const q = (s) => root.querySelector(s);
  const parts = {
    fill: q(".wsound__fill"), mark: q(".wsound__mark"), zones: q(".wsound__zones"),
    green: q(".wsound__arc--green"), yellow: q(".wsound__arc--yellow"), red: q(".wsound__arc--red"),
    level: q(".wsound__level"), needle: q(".wsound__needle"),
    msg: q(".wsound__msg"), short: q(".wsound__short"), btn: q("[data-sound-toggle]"),
  };
  let drawnLimit = null;
  const row = form === "chip" ? el.closest?.(".lb-widgets") : null;
  let drawnStatus = null;

  const draw = (s) => {
    const st = s?.status ?? "off";
    // Brickans bredd ändras bara med statusen ("Av", "Mikrofon nekad" …).
    const fit = row && st !== drawnStatus;
    drawnStatus = st;
    const live = st === "on";
    root.dataset.status = st;
    root.dataset.zone = live ? s.zone : "green";
    root.dataset.alert = String(!!(live && s.alert));
    const level = live ? s.level : 0;
    const limit = s?.limit ?? DEFAULT_LIMIT;
    root.style.setProperty("--wsound-level", level.toFixed(3));
    if (limit !== drawnLimit) {
      drawnLimit = limit;
      root.style.setProperty("--wsound-limit", String(limit));
      root.style.setProperty("--wsound-warn", String(warnFrom(limit)));
      parts.green?.setAttribute("d", arcPath(0, warnFrom(limit)));
      parts.yellow?.setAttribute("d", arcPath(warnFrom(limit), limit));
      parts.red?.setAttribute("d", arcPath(limit, 1));
    }
    if (parts.level) {
      if (level > 0.005) parts.level.setAttribute("d", arcPath(0, level));
      else parts.level.removeAttribute("d");
    }
    parts.needle?.style.setProperty("transform", `rotate(${(-90 + 180 * level).toFixed(1)}deg)`);
    root.setAttribute("aria-label", live
      ? `Ljudnivå ${Math.round(level * 100)} av 100${s.alert ? " — för högt" : ""}`
      : "Ljudmätaren är av");
    if (teacher) {
      const running = st === "on" || st === "starting";
      if (parts.btn) {
        parts.btn.innerHTML = `${icon(running ? "mic-off" : "mic")}<span>${running ? "Stoppa" : "Starta"}</span>`;
        parts.btn.title = running ? "Stoppa ljudmätaren" : "Starta ljudmätaren";
        parts.btn.setAttribute("aria-label", parts.btn.title);
      }
      if (parts.msg) { parts.msg.textContent = live ? "" : (LARGE_MESSAGES[st] ?? ""); parts.msg.hidden = live; parts.msg.dataset.status = st; }
      if (parts.short) { parts.short.textContent = live ? "" : (SHORT[st] ?? ""); parts.short.hidden = live; }
    }
    if (fit) fitSoundRow(row);
  };

  const offs = [watchSoundRow(row)];
  if (teacher) {
    const view = attachView(ctx, cfg, draw);
    offs.push(() => view.detach());
    // Kopplad till skylten: gränsen ritas om när skyltens nivå byts (även när mätaren är av).
    const sign = (ctx.siblings?.() ?? []).find((w) => w.type === SIGN_TYPE);
    if (sign) offs.push(watchRuntime(ctx.classId ?? null, sign.id, () => redraw(view.control)));
    const onClick = (e) => {
      if (!e.target.closest?.("[data-sound-toggle]")) return;
      e.preventDefault();
      e.stopPropagation();
      toggle(ctx.widgetId);
    };
    el.addEventListener("click", onClick);
    offs.push(() => el.removeEventListener("click", onClick));
  } else {
    // Elevvyn: bara talen från lärarfönstret. Öppnar aldrig mikrofonen.
    draw({ status: "off", limit: clampLimit(cfg?.limit) });
    let stale = null;
    const idle = () => { stale = null; draw({ status: "off", limit: clampLimit(cfg?.limit) }); };
    const off = ctx?.sync?.on?.(SOUND_MSG, (msg) => {
      const p = msg?.payload;
      if (!p || (p.classId ?? null) !== (ctx.classId ?? null)) return;
      clearTimeout(stale);
      draw(p);
      stale = p.status === "on" ? setTimeout(idle, STALE_MS) : null;
    });
    offs.push(() => { off?.(); clearTimeout(stale); });
  }
  cleanups.set(el, () => { for (const f of offs) { try { f(); } catch { /* ok */ } } });
}

function destroy(el) {
  cleanups.get(el)?.();
  cleanups.delete(el);
}

// ---------------------------------------------------------------------------
// Inställningar
// ---------------------------------------------------------------------------

const pct = (v) => `${Math.round(v * 100)} %`;

function settingsHTML(cfg, ctx) {
  const c = normalize(cfg ?? {});
  const teacher = ctx?.view === "teacher";
  return `<div class="wsnd-set wsound-set">
    ${teacher ? `<div class="wsound-set__run">
      <button type="button" class="btn wsound-set__btn" data-wsound-toggle></button>
      <span class="wsound-set__live" aria-hidden="true"><span class="wsound wsound--mini" data-status="off">
        <span class="wsound__bar"><span class="wsound__zones"></span><span class="wsound__fill"></span><span class="wsound__mark"></span></span></span></span>
    </div>
    <p class="wsound-set__status" role="status" data-wsound-status hidden></p>` : ""}
    <p class="wsound-set__privacy">${icon("lock")} ${PRIVACY_TEXT}</p>
    <label class="wsound-set__limit"><span>Gräns för ”för högt”</span>
      <input type="range" min="${MIN_LIMIT * 100}" max="${MAX_LIMIT * 100}" step="5" value="${Math.round(c.limit * 100)}" data-wsound-limit>
      <output data-wsound-limit-out>${pct(c.limit)}</output></label>
    <label class="wopt"><input type="checkbox" data-wsound-link${c.linkSign ? " checked" : ""}>
      <span>Koppla till skylten</span></label>
    <p class="wsound-set__hint" data-wsound-linkhint hidden></p>
  </div>`;
}

function bindSettings(root, cfg, onChange, ctx) {
  let cur = normalize(cfg ?? {});
  const teacher = ctx?.view === "teacher";
  const $ = (s) => root.querySelector(s);
  const btn = $("[data-wsound-toggle]");
  const status = $("[data-wsound-status]");
  const mini = $(".wsound--mini");
  const range = $("[data-wsound-limit]");
  const out = $("[data-wsound-limit-out]");
  const hint = $("[data-wsound-linkhint]");
  const offs = [];

  const sign = () => (ctx?.siblings?.() ?? []).find((w) => w.type === SIGN_TYPE) ?? null;

  function syncLink() {
    const s = sign();
    const linked = cur.linkSign && !!s;
    range.disabled = linked;
    if (linked) {
      const l = signLevelOf(readRuntime(ctx?.classId ?? null, s.id));
      const names = normalizeNames(s.cfg?.names);
      out.textContent = pct(limitForSign(l));
      hint.textContent = `Gränsen följer skylten: ${l} ${names[l]}.`;
      hint.hidden = false;
    } else {
      out.textContent = pct(cur.limit);
      hint.hidden = !cur.linkSign;
      hint.textContent = cur.linkSign ? "Kryssa i Ljudnivåskylt för att koppla — tills dess gäller reglaget." : "";
    }
  }

  let control = null;
  if (teacher && ctx?.widgetId) {
    const draw = (s) => {
      const st = s?.status ?? "off";
      const running = st === "on" || st === "starting";
      if (btn) btn.innerHTML = `${icon(running ? "mic-off" : "mic")}<span>${running ? "Stoppa mätaren" : "Starta mätaren"}</span>`;
      if (status) {
        const text = st === "on" ? "" : (st === "off" ? "" : MESSAGES[st] ?? "");
        status.textContent = text;
        status.hidden = !text;
        status.dataset.status = st;
      }
      if (mini) {
        mini.dataset.status = st;
        mini.dataset.zone = st === "on" ? s.zone : "green";
        mini.dataset.alert = String(!!(st === "on" && s.alert));
        mini.style.setProperty("--wsound-level", String(st === "on" ? s.level : 0));
        mini.style.setProperty("--wsound-limit", String(s.limit));
        mini.style.setProperty("--wsound-warn", String(warnFrom(s.limit)));
      }
    };
    const view = attachView(ctx, cur, draw);
    control = view.control;
    offs.push(() => view.detach());
    const onClick = (e) => { if (e.target.closest?.("[data-wsound-toggle]")) toggle(ctx.widgetId); };
    root.addEventListener("click", onClick);
    offs.push(() => root.removeEventListener("click", onClick));
  }
  const s0 = sign();
  if (s0) {
    offs.push(watchRuntime(ctx?.classId ?? null, s0.id, () => { syncLink(); if (control) redraw(control); }));
  }

  const apply = () => {
    if (control) { control.cfg = cur; redraw(control); }
    syncLink();
    onChange(cur);
  };
  const onInput = (e) => {
    if (e.target === range) {
      cur = { ...cur, limit: clampLimit(Number(range.value) / 100) };
      out.textContent = pct(cur.limit);
      if (control) { control.cfg = cur; redraw(control); }
    }
  };
  // Reglaget sparas när det släpps (change) — inte vid varje steg under dragningen.
  const onChangeEv = (e) => {
    if (e.target === range) apply();
    else if (e.target?.dataset && "wsoundLink" in e.target.dataset) { cur = { ...cur, linkSign: e.target.checked }; apply(); }
  };
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChangeEv);
  offs.push(() => { root.removeEventListener("input", onInput); root.removeEventListener("change", onChangeEv); });
  syncLink();
  return () => { for (const f of offs) { try { f(); } catch { /* ok */ } } };
}

export default {
  id: "sound-meter",
  name: "Ljudmätare",
  icon: "mic",
  multiple: false,
  defaults,
  normalize: (cfg) => normalize({ ...defaults(), ...cfg }),
  renderChip: (el, cfg, ctx) => mount(el, cfg, ctx, "chip"),
  renderLarge: (el, cfg, ctx) => mount(el, cfg, ctx, "large"),
  destroy,
  settingsHTML,
  bindSettings,
};
