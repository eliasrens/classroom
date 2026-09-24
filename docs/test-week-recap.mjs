/**
 * TEST — Veckans övergångar (issue #36), js/lib/week-recap.js.
 *
 *   node docs/test-week-recap.mjs
 *
 * Rena funktioner med egna tidpunkter — ingen falsk klocka, ingen Firestore.
 * Svensk tid (TZ sätts innan något datum räknas). Kontrollerar:
 *   - antal per färg, pass dag för dag (mån–fre, helg bara med pass)
 *   - veckans snabbaste (lägst tid, oavsett färg) med dag och lektion
 *   - målet från #35 (klarat / inte klarat / inget mål ännu → nästa veckas mål)
 *   - typerna blandas aldrig; trenden markerar vald vecka
 *   - INGA lärarnamn eller andra fält än tid/färg/dag/lektion i resultatet
 *   - "veckan är slut" från fredag 12:00, mentorstiden fredag eftermiddag
 */

process.env.TZ = "Europe/Stockholm";

const { weekRecap, avgTrend, isWeekOver, isMentorTime, hasWeekPasses } = await import("../js/lib/week-recap.js");
const { SUBJECTS } = await import("../js/lib/color.js");

let failed = 0;
let passed = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}\n   fick     ${a}\n   väntade  ${e}`);
}

const at = (y, mo, d, h = 10, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
let n = 0;
const pass = (t, durationSec, color = "green", kind = "overgang", extra = {}) => ({
  id: `p${++n}`, type: "trafikljus", kind, startedAt: t, result: { color, durationSec },
  createdBy: "uid-elias", createdByName: "Elias", ...extra,
});

// v.38 = 14–20 sep 2026, v.39 = 21–27 sep 2026.
const W38 = at(2026, 9, 14, 0);
const W39 = at(2026, 9, 21, 0);

const lastWeek = [pass(at(2026, 9, 15), 150), pass(at(2026, 9, 16), 170)]; // snitt 160 = 2:40
const thisWeek = [
  pass(at(2026, 9, 21, 9, 50), 130, "yellow", "overgang", { lesson: { subjectId: "ma" } }),
  pass(at(2026, 9, 22, 10, 15), 98, "green", "overgang", { lesson: { subjectId: "sv", title: "Läsning" } }),
  pass(at(2026, 9, 22, 13, 0), 140, "green"),
  pass(at(2026, 9, 24, 11, 0), 200, "red"),
  pass(at(2026, 9, 24, 11, 30), 400, "green", "datorer"),
  { id: "x", type: "annat", startedAt: at(2026, 9, 23), result: { durationSec: 5 } },
  { id: "y", type: "trafikljus", startedAt: at(2026, 9, 23) }, // utan resultat
];
const all = [...lastWeek, ...thisWeek];

// ---- Grundsiffror + dag för dag ----
{
  const r = weekRecap(all, "overgang", "avg", W39, { subjects: SUBJECTS, now: at(2026, 9, 25, 14) });
  eq(r.count, 4, "fyra övergångar (datorer och andra typer räknas inte)");
  eq(r.counts, { green: 2, yellow: 1, red: 1 }, "antal per färg");
  eq(r.days.map((d) => d.weekday), [0, 1, 2, 3, 4], "mån–fre, ingen helg utan pass");
  eq(r.days.map((d) => d.passes.length), [1, 2, 0, 1, 0], "passen per dag (onsdag/fredag tomma)");
  eq(r.days[1].passes.map((p) => p.durationSec), [98, 140], "dagens pass i tidsordning");
  eq(r.days[0].passes[0].lesson, "Matematik", "lektion ur ämnet");
  eq(r.days[1].passes[0].lesson, "Läsning", "blockets titel vinner");
  eq(r.fastest && { d: r.fastest.durationSec, wd: r.fastest.weekday, l: r.fastest.lesson }, { d: 98, wd: 1, l: "Läsning" }, "veckans snabbaste: tisdag 1:38");
  // Integritet: bara tid, färg, dag, lektion (och id) når vyn.
  eq(Object.keys(r.days[0].passes[0]).sort(), ["at", "color", "durationSec", "id", "lesson", "weekday"], "inga lärarfält i passen");
  eq(JSON.stringify(r).includes("Elias") || JSON.stringify(r).includes("uid-elias"), false, "lärarnamn finns ingenstans i sammanfattningen");
  eq(r.weekOver, true, "fredag 14:00: veckan räknas som slut");
}

// ---- Målet ----
{
  // snitt v.39 = (130+98+140+200)/4 = 142 < 160 → klarat
  const r = weekRecap(all, "overgang", "avg", W39, { now: at(2026, 9, 25, 14) });
  eq([r.goal.goal.targetSec, r.goal.progress.met, r.goal.progress.valueSec], [160, true, 142], "mål snitt 2:40 klarat med 2:22");
  // bästa-mått: förra veckans bästa 150, veckans bästa 98 → klarat
  eq(weekRecap(all, "overgang", "best", W39).goal.progress.met, true, "bästa-mått klarat");
  // Inte klarat: lägg till ett långsamt pass → snitt (568+300)/5 = 174 → 14 s från målet (+1 enligt goalProgress)
  const slow = [...all, pass(at(2026, 9, 25, 9), 300, "red")];
  const r2 = weekRecap(slow, "overgang", "avg", W39, { now: at(2026, 9, 25, 9, 30) });
  eq([r2.goal.progress.met, r2.goal.progress.valueSec, r2.goal.progress.diffSec], [false, 174, 15], "inte klarat: 2:54 mot 2:40");
  eq(r2.weekOver, false, "fredag förmiddag: tid kvar i veckan");
  // Inget mål (första veckan med pass) → nästa veckas mål = veckans värde
  const r3 = weekRecap(lastWeek, "overgang", "avg", W38);
  eq([r3.goal.goal, r3.nextTargetSec, r3.metric], [null, 160, "avg"], "första veckan: nästa veckas mål 2:40");
  // Datorer har eget (inget) mål
  eq(weekRecap(all, "datorer", "avg", W39).goal.goal, null, "datorer jämförs aldrig med övergångar");
}

// ---- Typer, trend, helg ----
{
  eq(hasWeekPasses(all, "datorer", W39), true, "datorpass finns v.39");
  eq(hasWeekPasses(all, "datorer", W38), false, "inga datorpass v.38");
  const t = avgTrend(all, "overgang", W39);
  eq(t.map((w) => [w.avgSec, w.current]), [[160, false], [142, true]], "trend: v.38 2:40, v.39 2:22 markerad");
  eq(avgTrend(all, "overgang", W39 + 7 * 86_400_000).at(-1), { weekStart: W39 + 7 * 86_400_000, avgSec: null, current: true }, "vald vecka utan pass är ändå med");
  const weekend = weekRecap([...all, pass(at(2026, 9, 26, 12), 90)], "overgang", "avg", W39);
  eq(weekend.days.map((d) => d.weekday), [0, 1, 2, 3, 4, 5], "lördag visas bara när den har pass");
  const empty = weekRecap([], "overgang", "avg", W39);
  eq([empty.count, empty.fastest, empty.days.length, empty.goal.goal], [0, null, 5, null], "tom vecka: fem neutrala dagar");
}

// ---- Veckoslut och mentorstid ----
eq(isWeekOver(W38, at(2026, 9, 24)), true, "tidigare vecka är slut");
eq(isWeekOver(W39, at(2026, 9, 24, 15)), false, "torsdag eftermiddag: inte slut");
eq(isWeekOver(W39, at(2026, 9, 25, 12)), true, "fredag 12:00: slut");
eq(isMentorTime(at(2026, 9, 25, 13)), true, "fredag 13:00 = mentorstid");
eq(isMentorTime(at(2026, 9, 25, 11)), false, "fredag 11:00 = inte ännu");
eq(isMentorTime(at(2026, 9, 24, 13)), false, "torsdag = inte mentorstid");

console.log(`${passed} ok, ${failed} fel`);
process.exit(failed ? 1 : 0);
