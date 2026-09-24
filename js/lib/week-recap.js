/**
 * VECKANS ÖVERGÅNGAR (issue #36) — veckosammanfattningen för elevskärmen.
 *
 * Räknar fram allt läget "Veckans övergångar" (js/modes/vecka.js) visar ur
 * de delade trafikljuspassen (classes/{cid}/sessions): antal per färg,
 * passen dag för dag, veckans snabbaste, veckomålet och en trend. Ingen ny
 * logik för veckor eller mål — veckan kommer ur js/lib/week.js (måndag 00:00
 * lokal tid, servertid) och målet ur js/lib/week-goal.js (issue #35).
 *
 * ENBART övergångstider: inga lärarnamn (createdBy/createdByName läses
 * aldrig ut), inga noteringar, inget elevspecifikt. Rena funktioner med
 * tiden som parameter — testas i docs/test-week-recap.mjs.
 */

import { addWeeks, inWeek, startOfWeek } from "./week.js";
import { serverNow } from "./clock.js";
import { kindOf, sessionKind, sessionTime, lessonLabel } from "./trafikljus-stats.js";
import { weekGoalStatus, weekSummary, GOAL_METRICS } from "./week-goal.js";

/** Veckodagarna mån–sön (index 0 = måndag, som i week.js). */
export const WEEKDAYS = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];

const COLORS = ["green", "yellow", "red"];

/** Veckodagsindex (mån = 0) för en tidpunkt, lokal tid. */
export const weekdayOf = (ts) => (new Date(ts).getDay() + 6) % 7;

/** Veckans trafikljuspass av en typ med giltigt resultat, äldst först. */
export function weekPasses(sessions, kind, weekStart) {
  const k = kindOf(kind);
  return (sessions ?? [])
    .filter((s) => s?.type === "trafikljus" && sessionKind(s) === k && s.result &&
      Number.isFinite(Number(s.result.durationSec)) && inWeek(sessionTime(s), weekStart))
    .sort((a, b) => sessionTime(a) - sessionTime(b));
}

/** Ett pass som eleverna får se: bara tid, färg, dag och lektion. */
function publicPass(s, subjects) {
  const t = sessionTime(s);
  return {
    id: s.id ?? null,
    at: t,
    weekday: weekdayOf(t),
    color: COLORS.includes(s.result.color) ? s.result.color : "green",
    durationSec: Math.max(0, Math.round(Number(s.result.durationSec))),
    lesson: lessonLabel(s.lesson, subjects) || "",
  };
}

/**
 * Snitt per vecka för de senaste `limit` veckorna MED pass av typen fram
 * till och med weekStart, äldst först. Den valda veckan är alltid med
 * (avgSec null om den saknar pass) så att den kan markeras.
 */
export function avgTrend(sessions, kind, weekStart, limit = 6) {
  const k = kindOf(kind);
  const weeks = new Set([weekStart]);
  for (const s of sessions ?? []) {
    if (s?.type !== "trafikljus" || sessionKind(s) !== k || !s.result) continue;
    const ws = startOfWeek(sessionTime(s));
    if (ws <= weekStart) weeks.add(ws);
  }
  return [...weeks].sort((a, b) => a - b).slice(-limit).map((ws) => ({
    weekStart: ws,
    avgSec: weekSummary(sessions, k, ws)?.avgSec ?? null,
    current: ws === weekStart,
  }));
}

/**
 * Hela veckosammanfattningen för en typ:
 * {
 *   weekStart, kind, count, counts: { green, yellow, red },
 *   days:    [{ weekday, passes: [...] }]  mån–fre, plus lör/sön bara om de har pass
 *   fastest: pass | null                     veckans snabbaste (lägst tid, vilken färg som helst)
 *   goal:    weekGoalStatus()                { summary, goal, progress } ur week-goal.js
 *   metric, nextTargetSec                    nästa veckas mål (= veckans värde i måttet)
 *   trend:   avgTrend()
 *   weekOver                                 veckan är slut (eller det är fredag eftermiddag)
 * }
 */
export function weekRecap(sessions, kind, metric, weekStart = startOfWeek(serverNow()), { subjects = [], now = serverNow() } = {}) {
  const k = kindOf(kind);
  const passes = weekPasses(sessions, k, weekStart).map((s) => publicPass(s, subjects));

  const counts = { green: 0, yellow: 0, red: 0 };
  for (const p of passes) counts[p.color]++;

  const days = WEEKDAYS.map((_, i) => ({ weekday: i, passes: passes.filter((p) => p.weekday === i) }))
    .filter((d) => d.weekday < 5 || d.passes.length > 0);

  let fastest = null;
  for (const p of passes) if (!fastest || p.durationSec < fastest.durationSec) fastest = p;

  const goal = weekGoalStatus(sessions, k, metric, weekStart);
  const m = goal.goal?.metric ?? (GOAL_METRICS[metric] ? metric : "avg");
  const nextTargetSec = goal.summary ? goal.summary[GOAL_METRICS[m].field] : null;

  return {
    weekStart,
    kind: k,
    count: passes.length,
    counts,
    days,
    fastest,
    goal,
    metric: m,
    nextTargetSec,
    trend: avgTrend(sessions, k, weekStart),
    weekOver: isWeekOver(weekStart, now),
  };
}

/**
 * Är veckan i praktiken slut? Tidigare veckor alltid; innevarande vecka
 * från fredag kl. 12 (mentorstiden) — då är "nytt försök nästa vecka"
 * rätt ton, annars "det finns tid kvar".
 */
export function isWeekOver(weekStart, now = serverNow()) {
  if (now >= addWeeks(weekStart, 1)) return true;
  if (!inWeek(now, weekStart)) return false;
  const d = new Date(now);
  const wd = weekdayOf(now);
  return wd > 4 || (wd === 4 && d.getHours() >= 12);
}

/** Fredag eftermiddag (kl. 12–18) — då föreslår Översikt veckans övergångar. */
export function isMentorTime(now = serverNow()) {
  const d = new Date(now);
  return weekdayOf(now) === 4 && d.getHours() >= 12 && d.getHours() < 18;
}

/** Har veckan pass av typen? (Datorer visas bara när det finns sådana.) */
export const hasWeekPasses = (sessions, kind, weekStart) => weekPasses(sessions, kind, weekStart).length > 0;
