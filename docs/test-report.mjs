/**
 * TEST — elevrapporter som krypterad fil + sammanslagning (issue #33).
 *
 *   node docs/test-report.mjs
 *
 * Rena funktioner med egna tidpunkter — ingen falsk klocka, ingen Firestore,
 * inget nätverk. Påhittad testdata (aldrig riktiga elever). Svensk tid.
 * Kontrollerar:
 *   - krypterad rundtur: samma innehåll tillbaka, fel lösenord = fel
 *   - filen innehåller varken elevnamn eller notistext i klartext
 *   - manipulerat filhuvud, nyare container/format ger begripliga fel
 *   - perioder (förra veckan standard, egna datum) och filnamn utan elevnamn
 *   - matchning på namn + tag, sparade namnpar, tvetydiga namn
 *   - sammanslagning: samma notering bara en gång (id + lärarens uid)
 *   - analys: typ × ämne × lärare, insatser "hjälpte 3 av 4 gånger", veckor
 *   - måndagsbannern och påminnelsen före gallring (inkl. awaitingChoice)
 */

process.env.TZ = "Europe/Stockholm";

const C = await import("../js/lib/report-crypto.js");
const R = await import("../js/modes/elever/report-data.js");

let failed = 0;
let passed = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}\n   fick     ${a}\n   väntade  ${e}`);
}
const ok = (cond, msg) => eq(Boolean(cond), true, msg);
async function throwsCode(fn, code, msg) {
  try { await fn(); eq("inget fel", code, msg); } catch (err) { eq(err.code ?? err.message, code, msg); }
}

const at = (y, mo, d, h = 10, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
// v.38 = 14–20 sep 2026, v.39 = 21–27 sep 2026. "Nu" = måndag 21 sep 2026 08:00.
const NOW = at(2026, 9, 21, 8);

const elias = { uid: "uid-elias", name: "Elias" };
const catalin = { uid: "uid-catalin", name: "Catalin" };
const cls = { id: "test33", name: "TEST-33" };

// Elias dator
const eliasStudents = [
  { id: "e1", firstName: "Testa", tag: null, active: true },
  { id: "e2", firstName: "Mohammed", tag: null, active: true },
  { id: "e3", firstName: "Kim", tag: "A", active: true },
  { id: "e4", firstName: "Kim", tag: "B", active: true },
];
const lesson = (subjectId, start, end, title = "") => ({ date: "2026-09-15", start, end, subjectId, title });
const eliasNotes = [
  { id: "n1", studentId: "e1", kind: "typ", typeId: "prat", createdAt: at(2026, 9, 15, 10, 5), lesson: lesson("sv", "10:00", "11:00"), createdBy: "uid-elias", createdByName: "Elias" },
  { id: "n2", studentId: "e1", kind: "text", text: "Hemligtextochmer om uppgiften", followUp: true, createdAt: at(2026, 9, 16, 9), createdBy: "uid-elias", createdByName: "Elias" },
  { id: "n3", studentId: "e1", kind: "insats", text: "Flytta plats", helped: "ja", createdAt: at(2026, 9, 17, 9), createdBy: "uid-elias", createdByName: "Elias" },
  { id: "n4", studentId: "e2", kind: "typ", typeId: "positiv", positive: true, createdAt: at(2026, 9, 18, 13), createdBy: "uid-elias", createdByName: "Elias" },
  { id: "old", studentId: "e1", kind: "typ", typeId: "prat", createdAt: at(2026, 9, 8, 10), createdBy: "uid-elias", createdByName: "Elias" },
];

// ---- Perioder och filnamn ----
{
  const p = R.periodFor("lastWeek", NOW);
  eq([p.from, p.to], [at(2026, 9, 14, 0), at(2026, 9, 21, 0)], "förra veckan = mån 14 sep – mån 21 sep");
  eq(p.label, "v.38 (14–20 sep)", "etikett för förra veckan");
  eq(R.periodFor("okänd", NOW).id, "lastWeek", "standard är förra veckan");
  const c = R.periodFor("custom", NOW, { from: "2026-09-10", to: "2026-09-01" });
  eq([c.from, c.to], [at(2026, 9, 1, 0), at(2026, 9, 11, 0)], "egna datum (omvänd ordning, till-dagen inklusive)");
  eq(R.periodFor("last4", NOW).label, "v.36–39 (31 aug–27 sep)", "senaste 4 veckorna");
  eq(R.periodFor("term", NOW).from, at(2026, 8, 1, 0), "höstterminen från 1 aug");
  eq(R.reportFileName({ className: "4A", period: p, teacherName: "Catalin" }), "klassrum-4A-v38-2026-catalin.klassrum", "filnamn utan elevnamn");
  eq(R.reportFileName({ className: "Åk 4/B", period: c, teacherName: "Åsa" }), "klassrum-Ak-4-B-2026-09-01_2026-09-10-asa.klassrum", "filnamn med egna datum");
}

// ---- Nyttolast ----
const period = R.periodFor("lastWeek", NOW);
const payload = R.buildReportPayload({
  cls, teacher: elias, period, students: eliasStudents, notes: eliasNotes,
  praiseDocs: [{ weekOf: "2026-W38", praise: [{ id: "p", kind: "student", studentId: "e2" }] }, { weekOf: "2026-W30", praise: [{ kind: "student", studentId: "e1" }] }],
  labels: [], subjects: [{ id: "sv", name: "Svenska" }], now: NOW,
});
{
  eq(payload.formatVersion, 1, "formatversion");
  eq([payload.className, payload.exporter, payload.kind], ["TEST-33", elias, "class"], "klass, lärare och typ");
  const testa = payload.students.find((s) => s.name === "Testa");
  eq(testa.notes.map((n) => n.id), ["n1", "n2", "n3"], "bara periodens noteringar, i tidsordning (unika id:n)");
  eq(testa.notes[0].lesson.subjectName, "Svenska", "ämnesnamnet bakas in");
  eq(payload.students.find((s) => s.name === "Mohammed").praise.map((p) => p.weekOf), ["2026-W38"], "Bra jobbat inom perioden");
  const one = R.buildReportPayload({ cls, teacher: elias, period, students: eliasStudents, notes: eliasNotes, studentIds: ["e1"], now: NOW });
  eq([one.kind, one.students.length], ["student", 1], "rapport för en elev");
  const meta = R.reportMeta(payload);
  ok(!JSON.stringify(meta).includes("Testa") && !JSON.stringify(meta).includes("Mohammed"), "META saknar elevnamn");
}

// ---- Krypterad rundtur ----
const PW = "korrekt häst batteri";
const ITER = 100_000; // snabbare i test; appen använder PBKDF2_ITERATIONS (600 000)
eq(C.PBKDF2_ITERATIONS >= 600_000, true, "minst 600 000 iterationer i appen");
const file = await C.encryptReport(payload, PW, { meta: R.reportMeta(payload), iterations: ITER });
{
  const back = await C.decryptReport(file, PW);
  eq(back, payload, "rundtur: identiskt innehåll");
  const raw = Buffer.from(file).toString("latin1");
  const rawUtf = Buffer.from(file).toString("utf8");
  for (const secret of ["Testa", "Mohammed", "Hemligtextochmer", "Flytta plats"]) {
    ok(!raw.includes(secret) && !rawUtf.includes(secret), `inget "${secret}" i klartext i filen`);
  }
  ok(rawUtf.includes("Elias") && rawUtf.includes("TEST-33"), "lärare och klass står i klartext (meta)");
  await throwsCode(() => C.decryptReport(file, "fel lösenord!!"), "wrong-password", "fel lösenord ger fel");
  const tampered = file.slice();
  const i = Buffer.from(tampered).indexOf("TEST-33");
  tampered[i] = "X".charCodeAt(0);
  await throwsCode(() => C.decryptReport(tampered, PW), "wrong-password", "manipulerad meta går inte att öppna");
  const newer = file.slice(); newer[8] = 9;
  await throwsCode(() => C.decryptReport(newer, PW), "newer-version", "nyare container → begripligt fel");
  await throwsCode(() => C.decryptReport(new TextEncoder().encode("hej hej"), PW), "not-klassrum", "annan fil");
  await throwsCode(() => C.encryptReport(payload, "kort"), "Lösenordet måste vara minst 10 tecken.", "för kort lösenord");
  const f2 = await C.encryptReport(payload, PW, { meta: {}, iterations: ITER });
  ok(Buffer.compare(Buffer.from(f2), Buffer.from(file)) !== 0, "slumpad salt/IV per fil");
  eq(R.upgradePayload({ ...payload, formatVersion: 2 }), { ok: false, code: "newer-version" }, "nyare nyttolast → begripligt fel");
  eq(R.upgradePayload({ x: 1 }).code, "corrupt", "okänd nyttolast");
  eq(R.upgradePayload(payload).ok, true, "aktuell version ok");
  eq(C.passwordStrength("abc").ok, false, "styrka: för kort");
  ok(C.passwordStrength("korrekt häst batteri").score >= 3, "styrka: lösenfras är bra");
  ok(C.passwordStrength("aaaaaaaaaa").score <= 1, "styrka: upprepning är svagt");
}

// ---- Catalins fil ----
const catalinStudents = [
  { id: "c1", firstName: " testa ", tag: null, active: true },
  { id: "c2", firstName: "Mohammad", tag: null, active: true },
  { id: "c3", firstName: "Kim", tag: "b", active: true },
];
const catalinNotes = [
  ...Array.from({ length: 9 }, (_, k) => ({ id: `c-prat-${k}`, studentId: "c1", kind: "typ", typeId: "prat", createdAt: at(2026, 9, 15 + (k % 4), 8, 10 + k), lesson: { ...lesson("ma", "08:00", "09:00"), subjectName: "Matematik" }, createdBy: "uid-catalin", createdByName: "Catalin" })),
  { id: "c-in1", studentId: "c1", kind: "insats", text: "flytta plats.", helped: "ja", createdAt: at(2026, 9, 16, 8, 30), createdBy: "uid-catalin", createdByName: "Catalin" },
  { id: "c-in2", studentId: "c1", kind: "insats", text: "Flytta  plats", helped: "ja", createdAt: at(2026, 9, 17, 8, 30), createdBy: "uid-catalin", createdByName: "Catalin" },
  { id: "c-in3", studentId: "c1", kind: "insats", text: "Flytta plats", helped: "nej", createdAt: at(2026, 9, 18, 8, 30), createdBy: "uid-catalin", createdByName: "Catalin" },
  { id: "c-fu", studentId: "c1", kind: "text", text: "Prata med vh", followUp: true, createdAt: at(2026, 9, 18, 9), createdBy: "uid-catalin", createdByName: "Catalin" },
  // Samma id som en av Elias noteringar men ANNAN lärare → ska inte räknas som dubblett
  { id: "n1", studentId: "c2", kind: "typ", typeId: "stol", createdAt: at(2026, 9, 16, 8, 20), createdBy: "uid-catalin", createdByName: "Catalin" },
];
const catPayload = R.buildReportPayload({ cls, teacher: catalin, period, students: catalinStudents, notes: catalinNotes, now: NOW });

// ---- Matchning ----
{
  const s = (name) => catPayload.students.find((x) => x.name.trim() === name);
  eq(R.suggestMatch(s("testa"), eliasStudents), { localId: "e1", reason: "name" }, "namn: skiftlägesokänsligt + trimmat");
  eq(R.suggestMatch(s("Mohammad"), eliasStudents), { localId: null, reason: "none" }, "stavningsvariant föreslås inte automatiskt");
  eq(R.suggestMatch(s("Kim"), eliasStudents), { localId: "e4", reason: "name+tag" }, "tag som särskiljare");
  eq(R.suggestMatch({ localId: "x", name: "Kim", tag: null }, eliasStudents), { localId: null, reason: "ambiguous" }, "två Kim utan tag → tvetydigt");
  const saved = R.updateSavedPairs([], "uid-catalin", [{ name: "Mohammad", tag: null, localId: "e2" }]);
  eq(saved, [{ teacherUid: "uid-catalin", name: "Mohammad", tag: null, localId: "e2" }], "sparat namnpar (bara namn ↔ id)");
  eq(R.suggestMatch(s("Mohammad"), eliasStudents, { saved, teacherUid: "uid-catalin" }), { localId: "e2", reason: "saved" }, "sparat par används nästa gång");
  eq(R.suggestMatch(s("Mohammad"), eliasStudents, { saved, teacherUid: "uid-annan" }).localId, null, "sparat par gäller bara samma lärares filer");
}

// ---- Sammanslagning ----
const decCat = R.upgradePayload(await C.decryptReport(await C.encryptReport(catPayload, PW, { iterations: ITER }), PW)).payload;
const targets = { c1: "local:e1", c2: "local:e2", c3: "local:e4" };
const own = { key: "own", payload, targets: Object.fromEntries(eliasStudents.map((s) => [s.id, `local:${s.id}`])) };
{
  const merged = R.mergeReports([
    own,
    { key: "f1", payload: decCat, targets },
    { key: "f2", payload: decCat, targets }, // samma fil två gånger
    { key: "f3", payload, targets: own.targets }, // Elias egen export + egen lokal data
  ], { locals: eliasStudents });
  const testa = merged.students.find((s) => s.key === "local:e1");
  eq(testa.notes.length, 3 + 13, "inga dubbletter: 3 egna + 13 Catalin (samma fil två gånger, egen fil + lokalt)");
  eq(merged.students.find((s) => s.key === "local:e2").notes.map((n) => n.createdBy), ["uid-catalin", "uid-elias"], "samma id hos olika lärare = två noteringar");
  eq(merged.teachers.map((t) => [t.name, t.color]), [["Catalin", R.TEACHER_COLORS[0]], ["Elias", R.TEACHER_COLORS[1]]], "lärare med egen färg");
  eq(testa.aliases, ["Elias: Testa", "Catalin:  testa "], "vilka namn som slagits ihop framgår");
  const a = R.analyzeNotes(testa.notes, { teachers: merged.teachers, period: merged.period });
  const prat = a.typeSubjectTeacher.find((t) => t.typeId === "prat");
  eq(prat.parts.map((p) => [p.count, p.subject, p.teacherName]), [[9, "Matematik", "Catalin"], [1, "Svenska", "Elias"]], "prat: 9 i Matematik (Catalin), 1 i Svenska (Elias)");
  const flytta = a.interventions[0];
  eq([flytta.total, flytta.ja, flytta.nej, flytta.teachers], [4, 3, 1, ["Catalin", "Elias"]], "insatser sammanräknade över lärarna");
  eq(R.interventionLine(flytta), "hjälpte 3 av 4 gånger", "Flytta plats: hjälpte 3 av 4 gånger");
  eq(a.followUps.map((n) => n.createdByName), ["Elias", "Catalin"], "alla uppföljningar från alla lärare");
  eq(a.byTeacher.map((t) => [t.name, t.total]), [["Catalin", 13], ["Elias", 3]], "fördelning per lärare");
  const sum = R.classSummary(merged);
  eq(sum.withFollowUps, 1, "klassens sammanfattning: elever med öppna uppföljningar");
  // Hålla isär: Kim b → ingen lokal elev
  const apart = R.mergeReports([{ key: "f1", payload: decCat, targets: { c1: "local:e1" } }], { locals: eliasStudents });
  ok(apart.students.some((s) => s.key.startsWith("sep:") && s.fromFile === "Catalin"), "ohopkopplade elever hålls isär");

  // Sparad sammanställning → ny fil → öppnas igen med samma innehåll
  const mp = R.mergedToPayload(merged, { className: "TEST-33", teacher: elias, now: NOW });
  const again = R.upgradePayload(await C.decryptReport(await C.encryptReport(mp, PW, { meta: R.reportMeta(mp), iterations: ITER }), PW)).payload;
  eq(again.kind, "merged", "sammanställningen sparas som eget filslag");
  eq(again.sources.map((s) => s.teacherName).sort(), ["Catalin", "Elias"], "källfilerna och lärarna framgår");
  const re = R.mergeReports([{ key: "m", payload: again, targets: Object.fromEntries(again.students.map((s) => [s.localId, `local:${s.localId}`])) }, own], { locals: eliasStudents });
  eq(re.students.find((s) => s.key === "local:e1").notes.length, 16, "öppnad igen (+ egen data): fortfarande inga dubbletter");
  eq(R.reportMeta(mp).teachers, ["Elias", "Catalin"], "meta visar alla lärare");
}

// ---- Vecka för vecka ----
{
  const p4 = R.periodFor("last4", at(2026, 9, 24, 12));
  const a = R.analyzeNotes(eliasNotes.map((n) => ({ ...n, createdBy: "uid-elias" })), { period: p4 });
  eq(a.weeks.map((w) => [w.weekKey, w.neg]), [["2026-W36", 0], ["2026-W37", 1], ["2026-W38", 1], ["2026-W39", 0]], "jämförelse vecka för vecka");
}

// ---- Måndagsbannern ----
{
  const r = R.mondayReminder({ notes: eliasNotes, now: NOW });
  eq(r && [r.weekKey, r.students, r.notes], ["2026-W38", 1, 1], "måndag: förra veckan 1 elev med uppföljning");
  eq(R.mondayReminder({ notes: eliasNotes, now: at(2026, 9, 22, 8) }), null, "bara på måndagar");
  eq(R.mondayReminder({ notes: eliasNotes, now: NOW, dismissed: { monday: "2026-W38" } }), null, "avvisad för veckan");
  const log = R.logExport(null, { period, now: NOW });
  eq(R.mondayReminder({ notes: eliasNotes, now: NOW, log }), null, "redan exporterad vecka tjatar inte");
  const logOne = R.logExport(null, { period, studentIds: ["e2"], now: NOW });
  ok(R.mondayReminder({ notes: eliasNotes, now: NOW, log: logOne }), "export av en annan elev räcker inte");
  eq(R.exportedWeeks(log), ["2026-W38"], "exporterade veckor sparas");
}

// ---- Påminnelse före gallring ----
{
  const notes = [
    { id: "a", studentId: "e1", followUp: true, createdAt: at(2026, 6, 30, 10) },  // v.27 — gallras 22 sep (12 v)
    { id: "b", studentId: "e2", followUp: true, createdAt: at(2026, 8, 20, 10) },  // ny — inte i fönstret
    { id: "c", studentId: "e1", followUp: false, createdAt: at(2026, 6, 24, 10) }, // ingen uppföljning
  ];
  const r = R.retentionReminder({ notes, weeks: 12, now: NOW });
  eq(r && [r.count, r.weekKeys, r.awaiting], [1, ["2026-W27"], false], "uppföljning som gallras inom 7 dagar");
  eq(new Date(r.purgeAt).toISOString().slice(0, 10), "2026-09-22", "gallringsdatum = notering + 12 veckor");
  eq(R.retentionReminder({ notes, weeks: 12, now: at(2026, 9, 1, 8) }), null, "för tidigt för påminnelse");
  eq(R.retentionReminder({ notes, weeks: 12, now: NOW, dismissed: { retention: ["2026-W27"] } }), null, "avvisad för de veckorna");
  const log = R.logExport(null, { period: { from: at(2026, 6, 29, 0), to: at(2026, 7, 6, 0) }, now: NOW });
  eq(R.retentionReminder({ notes, weeks: 12, now: NOW, log }), null, "redan exporterad → ingen påminnelse");
  // Uppgraderingsskyddet: inget gallras förrän läraren bekräftar — då raderas allt äldre direkt.
  const aw = R.retentionReminder({ notes, weeks: 4, awaitingChoice: true, now: NOW });
  eq(aw && [aw.count, aw.awaiting, aw.purgeAt], [2, true, null], "awaitingChoice: det som raderas vid bekräftelsen");
  eq(R.followUpsAtRisk({ notes, weeks: 12, before: NOW }).length, 0, "inget raderas just nu med 12 veckor");
}

console.log(`\n${passed} ok, ${failed} fel`);
process.exit(failed ? 1 : 0);
