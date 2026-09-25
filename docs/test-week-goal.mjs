/**
 * TEST — trafikljusets veckomål (issue #35).
 *
 *   node docs/test-week-goal.mjs
 *
 * Rena funktioner i js/lib/week-goal.js med egna tidpunkter — ingen falsk
 * klocka och ingen Firestore. Körs i svensk tid (TZ sätts nedan, innan
 * något datum räknas) så att måndag 00:00 och sommartidsbytet är riktiga.
 * Kontrollerar:
 *   - snitt, bästa och total per typ (övergång och datorer blandas aldrig)
 *   - förra veckan = närmast föregående vecka MED pass (lovvecka hoppas över)
 *   - pass precis runt måndag 00:00 hamnar i rätt vecka
 *   - ett sent synkat pass (dyker upp i efterhand) ändrar målet direkt
 *   - framsteg, "x s kvar", markeringen när ett pass slår målet, trenden
 *   - vecka över sommartidsbytet (vecka ≠ 7 × 24 h)
 */

process.env.TZ = "Europe/Stockholm";

const {
  weekSummary, previousWeekWithPasses, weekGoal, goalProgress, weekGoalStatus,
  passGoalMark, goalTrend, normalizeGoalSettings, fmtSec, fmtDiff,
} = await import("../js/lib/week-goal.js");
const { startOfWeek, addWeeks } = await import("../js/lib/week.js");

let failed = 0;
let passed = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}\n   fick     ${a}\n   väntade  ${e}`);
}

// Lokal tid (Europe/Stockholm). Månad 1-baserad för läsbarhet.
const at = (y, mo, d, h = 10, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
let n = 0;
const pass = (t, durationSec, kind = "overgang", extra = {}) =>
  ({ id: `p${++n}`, type: "trafikljus", kind, startedAt: t, result: { color: "green", durationSec }, ...extra });

// Veckor 2026: v.37 = 7–13 sep, v.38 = 14–20 sep, v.39 = 21–27 sep.
const W37 = at(2026, 9, 7, 0);
const W38 = at(2026, 9, 14, 0);
const W39 = at(2026, 9, 21, 0);
eq(startOfWeek(at(2026, 9, 24)), W39, "startOfWeek (torsdag v.39) = måndag 00:00");

// ---- Snitt, bästa, total per typ ----
{
  const s = [
    pass(at(2026, 9, 14), 100),
    pass(at(2026, 9, 15), 200),
    pass(at(2026, 9, 16), 181),
    pass(at(2026, 9, 16, 11), 400, "datorer"),
    { id: "x", type: "annat", startedAt: at(2026, 9, 16), result: { durationSec: 1 } },
    pass(at(2026, 9, 17), 50, undefined, { kind: undefined }), // gammalt pass utan kind = övergång
  ];
  eq(weekSummary(s, "overgang", W38), { count: 4, avgSec: 133, bestSec: 50, totalSec: 531 }, "övergång: snitt (avrundat)/bästa/total/antal");
  eq(weekSummary(s, "datorer", W38), { count: 1, avgSec: 400, bestSec: 400, totalSec: 400 }, "datorer räknas för sig");
  eq(weekSummary(s, "overgang", W39), null, "vecka utan pass → null");
}

// ---- Förra veckan = senaste veckan med pass (lovvecka) ----
{
  const s = [
    pass(at(2026, 9, 1), 300),            // v.36
    pass(at(2026, 9, 2), 100),            // v.36
    // v.37 och v.38: lov, inga övergångar — men datorer v.38
    pass(at(2026, 9, 15), 250, "datorer"),
    pass(at(2026, 9, 22), 180),           // v.39 (denna vecka)
  ];
  const prev = previousWeekWithPasses(s, "overgang", W39);
  eq(prev.weekStart, at(2026, 8, 31, 0), "lovvecka: förra veckan med pass = v.36");
  eq(prev.adjacent, false, "lovvecka: inte veckan precis innan (visas tydligt)");
  eq(prev.summary.avgSec, 200, "lovvecka: v.36:s snitt");
  const prevD = previousWeekWithPasses(s, "datorer", W39);
  eq([prevD.weekStart, prevD.adjacent], [W38, true], "datorer: v.38 är veckan precis innan");
  eq(previousWeekWithPasses(s, "overgang", at(2026, 8, 31, 0)), null, "ingen tidigare vecka → inget mål");
  eq(weekGoal(s, "overgang", "avg", at(2026, 8, 31, 0)), null, "weekGoal null utan historik");
}

// ---- Pass precis runt måndag 00:00 ----
{
  const s = [
    pass(W39 - 1000, 90),   // söndag 23:59:59 → v.38
    pass(W39, 30),          // måndag 00:00:00 → v.39
  ];
  eq(weekSummary(s, "overgang", W38)?.count, 1, "söndag 23:59:59 hör till förra veckan");
  eq(weekSummary(s, "overgang", W39)?.bestSec, 30, "måndag 00:00:00 hör till nya veckan");
  eq(weekGoal(s, "overgang", "best", W39).targetSec, 90, "målet för v.39 = v.38:s bästa");
  eq(previousWeekWithPasses(s, "overgang", W39).adjacent, true, "v.38 är precis innan v.39");
}

// ---- Sent synkade pass: räknas fram, så målet blir rätt direkt ----
{
  const s = [pass(at(2026, 9, 15), 160), pass(at(2026, 9, 22), 150)];
  eq(weekGoal(s, "overgang", "avg", W39).targetSec, 160, "mål före sen synk");
  // Ett pass från förra veckan synkas in först nu (skrivet offline i v.38).
  const late = [...s, pass(at(2026, 9, 18, 14), 100, "overgang", { createdAt: at(2026, 9, 23) })];
  eq(weekGoal(late, "overgang", "avg", W39).targetSec, 130, "sent synkat pass hamnar i sin egen vecka (v.38)");
  eq(weekSummary(late, "overgang", W39).count, 1, "…och inte i veckan det synkades");
  // Ett sent pass i en ännu äldre vecka ändrar inte "förra veckan".
  const older = [...s, pass(at(2026, 9, 8), 10)];
  eq(weekGoal(older, "overgang", "avg", W39).targetSec, 160, "sent pass i v.37 påverkar inte v.39:s mål");
  // Pass med startedAt saknas → createdAt.
  eq(weekSummary([{ type: "trafikljus", createdAt: at(2026, 9, 22), result: { durationSec: 42 } }], "overgang", W39)?.totalSec,
    42, "äldre pass utan startedAt räknas på createdAt");
}

// ---- Framsteg mot målet ----
{
  const last = [pass(at(2026, 9, 14), 160), pass(at(2026, 9, 15), 160)]; // snitt 2:40, bästa 2:40, total 5:20
  const goalAvg = weekGoal(last, "overgang", "avg", W39);
  eq(goalProgress(goalAvg, null), { met: false, valueSec: null, diffSec: null, count: 0 }, "inga pass än");
  eq(goalProgress(goalAvg, { count: 5, avgSec: 135, bestSec: 100, totalSec: 675 }),
    { met: true, valueSec: 135, diffSec: 0, count: 5 }, "snitt 2:15 < 2:40 → klarat");
  eq(goalProgress(goalAvg, { count: 1, avgSec: 160, bestSec: 160, totalSec: 160 }).met, false, "lika med målet räknas inte (under)");
  eq(goalProgress(goalAvg, { count: 1, avgSec: 172, bestSec: 172, totalSec: 172 }).diffSec, 13, "172 s → 13 s kvar (måste under 160)");
  const goalTot = weekGoal(last, "overgang", "total", W39);
  eq(goalTot.targetSec, 320, "totalmål = förra veckans totaltid");
  eq(goalProgress(goalTot, { count: 3, avgSec: 110, bestSec: 90, totalSec: 330 }).met, false, "total över → inte klarat");
  eq(goalProgress(null, null), null, "inget mål → null");
  eq(weekGoal(last, "overgang", "bogus", W39).metric, "avg", "okänt mått → snitt");
}

// ---- Markering när ett pass sparas ----
{
  const now = at(2026, 9, 24);
  const s = [pass(at(2026, 9, 14), 160), pass(at(2026, 9, 22), 200)];
  eq(passGoalMark(s, "overgang", "avg", pass(now, 100), now), "met", "100 → snitt 150 < 160: veckomålet klarat");
  const done = [...s, pass(now, 100)];
  eq(passGoalMark(done, "overgang", "avg", pass(now + 1, 120), now), "beat", "redan klarat, passet 120 < 160 → under målet");
  eq(passGoalMark(done, "overgang", "avg", pass(now + 1, 190), now), null, "långsamt pass → ingen markering");
  eq(passGoalMark([pass(at(2026, 9, 22), 10)], "overgang", "avg", pass(now, 5), now), null, "inget mål → ingen markering");
  eq(passGoalMark([pass(at(2026, 9, 14), 300)], "overgang", "total", pass(now, 100), now), "met", "total: första passet under förra veckans total");
  eq(passGoalMark([pass(at(2026, 9, 14), 300), pass(now, 100)], "overgang", "total", pass(now, 50), now), null,
    "total: enskild tid jämförs inte med totaltiden");
  eq(passGoalMark(s, "datorer", "avg", pass(now, 1, "datorer"), now), null, "datorer har eget (saknat) mål");
}
{
  const now = at(2026, 9, 24);
  const s = [pass(at(2026, 9, 14), 160), pass(at(2026, 9, 22), 200)];
  eq(passGoalMark(s, "overgang", "avg", pass(now, 150), now), "beat", "enskilt pass under snittmålet → beat");
}

// ---- Trend + weekGoalStatus ----
{
  const s = [
    pass(at(2026, 9, 1), 200),             // v.36
    pass(at(2026, 9, 8), 180),             // v.37 → mål 200, klarat
    pass(at(2026, 9, 15), 190),            // v.38 → mål 180, inte klarat
    pass(at(2026, 9, 22), 170),            // v.39 → mål 190, klarat
  ];
  const trend = goalTrend(s, "overgang", "avg", W39);
  eq(trend.map((w) => [w.summary.avgSec, w.progress?.met ?? null]),
    [[200, null], [180, true], [190, false], [170, true]], "trend äldst först, med nått/ej nått");
  eq(goalTrend(s, "overgang", "avg", W38).length, 3, "trend till och med vald vecka");
  eq(goalTrend(s, "overgang", "avg", W39, 2).length, 2, "trend begränsas");
  eq(weekGoalStatus(s, "overgang", "best", W37).goal.targetSec, 200, "status: mål i bästa-mått");
}

// ---- Sommartid: v.44 2026 (25 okt byte) ----
{
  const W44 = at(2026, 10, 26, 0);
  const s = [pass(at(2026, 10, 25, 23, 59), 60), pass(at(2026, 10, 19, 0, 0), 30)];
  eq(weekSummary(s, "overgang", addWeeks(W44, -1))?.count, 2, "vecka över sommartidsbytet (23:59 sön + 00:00 mån)");
  eq(previousWeekWithPasses(s, "overgang", W44).adjacent, true, "veckan precis innan över DST");
}

// ---- Inställningar + format ----
eq(normalizeGoalSettings(null), { goalMetric: { overgang: "avg", datorer: "avg" }, showGoalToStudents: false }, "standard");
eq(normalizeGoalSettings({ goalMetric: { datorer: "total", overgang: "x" }, showGoalToStudents: "ja" }),
  { goalMetric: { overgang: "avg", datorer: "total" }, showGoalToStudents: false }, "ogiltiga värden → standard");
eq([fmtSec(160), fmtSec(1110), fmtSec(3910), fmtDiff(13), fmtDiff(75)], ["2:40", "18:30", "1:05:10", "13 s", "1:15"], "format");

console.log(`${passed} ok, ${failed} fel`);
process.exit(failed ? 1 : 0);
