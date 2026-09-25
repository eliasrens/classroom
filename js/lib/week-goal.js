/**
 * VECKOMÅL FÖR TRAFIKLJUSET (issue #35) — förra veckans resultat som mål att slå.
 *
 * Allt räknas fram ur de delade passen (classes/{cid}/sessions). Inget nytt
 * dokument lagras, så ett pass som synkas in sent (skrivet offline) hamnar
 * automatiskt i rätt vecka, både i veckoresultatet och i målet. Veckorna är
 * desamma som i veckorytmen (js/lib/week.js, måndag 00:00 lokal tid) och
 * "nu" är serverNow() (js/lib/clock.js, issue #31).
 *
 *   - Veckoresultat per typ: antal pass, snitt, bästa och totaltid (sekunder).
 *   - "Förra veckan" = närmast föregående vecka SOM HADE PASS av typen, så
 *     en lovvecka utan pass hoppas över (adjacent: false → visas tydligt).
 *   - Målet = förra veckans värde i klassens valda mått (goalMetric per typ,
 *     settings/trafikljus). Målet klaras när veckans värde är UNDER det.
 *
 * Typerna blandas aldrig: datorer jämförs aldrig med övergångar. Rena
 * funktioner med tiden som parameter — testas i docs/test-week-goal.mjs.
 */

import { startOfWeek, addWeeks, inWeek } from "./week.js";
import { serverNow } from "./clock.js";
import { kindOf, sessionKind, sessionTime } from "./trafikljus-stats.js";

/** Måtten läraren kan välja som mål. Lägre är alltid bättre. */
export const GOAL_METRICS = {
  avg:   { key: "avg",   label: "Snitt per pass", short: "snitt",  field: "avgSec" },
  best:  { key: "best",  label: "Bästa tid",      short: "bästa",  field: "bestSec" },
  total: { key: "total", label: "Totaltid",       short: "totalt", field: "totalSec" },
};
export const GOAL_METRIC_KEYS = Object.keys(GOAL_METRICS);
export const DEFAULT_GOAL_METRIC = "avg";
export const goalMetricOf = (m) => (GOAL_METRICS[m] ? m : DEFAULT_GOAL_METRIC);

/** Trafikljuspass av en typ med giltig tid. */
function passesOf(sessions, kind) {
  const k = kindOf(kind);
  return (sessions ?? []).filter((s) =>
    s?.type === "trafikljus" && sessionKind(s) === k && Number.isFinite(Number(s.result?.durationSec)));
}

/**
 * Goal-inställningarna ur settings/trafikljus → value. Samma dokument som
 * gränserna; saknade fält = standard (snitt, visas inte för eleverna).
 */
export function normalizeGoalSettings(raw) {
  return {
    goalMetric: {
      overgang: goalMetricOf(raw?.goalMetric?.overgang),
      datorer: goalMetricOf(raw?.goalMetric?.datorer),
    },
    showGoalToStudents: raw?.showGoalToStudents === true,
  };
}

/** Veckoresultat ur en lista pass: { count, avgSec, bestSec, totalSec } | null. */
function summarize(list) {
  if (list.length === 0) return null;
  const secs = list.map((s) => Math.max(0, Number(s.result.durationSec)));
  const totalSec = secs.reduce((a, b) => a + b, 0);
  return {
    count: secs.length,
    avgSec: Math.round(totalSec / secs.length),
    bestSec: Math.min(...secs),
    totalSec,
  };
}

/** Veckoresultatet för en typ i veckan som börjar weekStart (null = inga pass). */
export function weekSummary(sessions, kind, weekStart) {
  return summarize(passesOf(sessions, kind).filter((s) => inWeek(sessionTime(s), weekStart)));
}

/**
 * Närmast föregående vecka (före weekStart) som hade pass av typen:
 * { weekStart, summary, adjacent } | null. adjacent = veckan precis innan.
 */
export function previousWeekWithPasses(sessions, kind, weekStart) {
  let best = null;
  for (const s of passesOf(sessions, kind)) {
    const t = sessionTime(s);
    if (t < weekStart && (best == null || t > best)) best = t;
  }
  if (best == null) return null;
  const ws = startOfWeek(best);
  return { weekStart: ws, summary: weekSummary(sessions, kind, ws), adjacent: ws === addWeeks(weekStart, -1) };
}

/**
 * Veckans mål för en typ: { metric, targetSec, prev } | null (ingen tidigare
 * vecka med pass → inget mål ännu). prev = previousWeekWithPasses().
 */
export function weekGoal(sessions, kind, metric, weekStart) {
  const prev = previousWeekWithPasses(sessions, kind, weekStart);
  if (!prev) return null;
  const m = goalMetricOf(metric);
  return { metric: m, targetSec: prev.summary[GOAL_METRICS[m].field], prev };
}

/**
 * Framsteg mot målet: { met, valueSec, diffSec, count } | null (inget mål).
 * valueSec = veckans värde i målets mått (null utan pass). met kräver minst
 * ett pass. diffSec = hur många sekunder som saknas (0 när målet klaras).
 */
export function goalProgress(goal, summary) {
  if (!goal) return null;
  if (!summary) return { met: false, valueSec: null, diffSec: null, count: 0 };
  const valueSec = summary[GOAL_METRICS[goal.metric].field];
  const met = valueSec < goal.targetSec;
  return { met, valueSec, diffSec: met ? 0 : valueSec - goal.targetSec + 1, count: summary.count };
}

/** Allt för en vecka: { weekStart, summary, goal, progress }. */
export function weekGoalStatus(sessions, kind, metric, weekStart = startOfWeek(serverNow())) {
  const summary = weekSummary(sessions, kind, weekStart);
  const goal = weekGoal(sessions, kind, metric, weekStart);
  return { weekStart, summary, goal, progress: goalProgress(goal, summary) };
}

/**
 * Markering när ett pass sparas: "met" = passet gjorde att veckans mål
 * klarades (var inte klarat före), "beat" = passet var i sig under målet
 * (snitt/bästa — en enskild tid jämförs inte med en totaltid), annars null.
 */
export function passGoalMark(sessions, kind, metric, pass, now = serverNow()) {
  const ws = startOfWeek(now);
  const before = weekGoalStatus(sessions, kind, metric, ws);
  if (!before.goal) return null;
  const after = weekGoalStatus([...(sessions ?? []), pass], kind, metric, ws).progress;
  if (after.met && !before.progress.met) return "met";
  if (before.goal.metric !== "total" && Number(pass?.result?.durationSec) < before.goal.targetSec) return "beat";
  return null;
}

/**
 * Trend: de senaste `limit` veckorna med pass av typen fram till och med
 * veckan uptoWeekStart, äldst först, med mål och om det nåddes.
 */
export function goalTrend(sessions, kind, metric, uptoWeekStart = startOfWeek(serverNow()), limit = 6) {
  const weeks = new Set();
  for (const s of passesOf(sessions, kind)) {
    const ws = startOfWeek(sessionTime(s));
    if (ws <= uptoWeekStart) weeks.add(ws);
  }
  return [...weeks].sort((a, b) => a - b).slice(-limit)
    .map((ws) => weekGoalStatus(sessions, kind, metric, ws));
}

/** "2:40" (sekunder → m:ss), längre tider "1:05:10". */
export function fmtSec(sec) {
  const t = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "12 s" / "1:05" — kort skillnad för "x kvar till målet". */
export const fmtDiff = (sec) => (sec < 60 ? `${Math.round(sec)} s` : fmtSec(sec));
