/**
 * TEST — klassåtgärder (issue #34).
 *
 *   node docs/test-class-actions.mjs
 *
 * Rena funktioner i js/lib/class-actions.js — ingen DOM, ingen Firestore.
 * Kontrollerar:
 *   - namnspärren: skiftlägesokänslig, hela ord, genitiv-s, å/ä/ö,
 *     bindestreck, inga träffar inne i andra ord, markeringens segment
 *   - valideringen speglar firestore.rules (längder, utfall, lektionsfält)
 *   - kopplingen till klasstatistiken: lektionens streck och pass, snitt
 *     för ämnet, före/efter-fönstret
 *   - lektionsvalen i dialogen (pågående först, unika, nyast först)
 */

process.env.TZ = "Europe/Stockholm";

const {
  findStudentNames, highlightSegments, buildActionDoc, buildReplyDoc, cleanLesson,
  lessonIndex, lessonStatsFor, lessonChoices, categoryOptions, categoryKey, TEXT_MAX,
} = await import("../js/lib/class-actions.js");

let failed = 0;
let passed = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL ${msg}\n  väntat: ${e}\n  fick:   ${a}`);
}
const throws = (fn, msg) => {
  try { fn(); } catch { passed++; return; }
  failed++;
  console.error(`FAIL ${msg} — kastade inte`);
};
const names = (text, list) => findStudentNames(text, list).map((h) => h.name);

// ---- Namnspärren ----
const roster = ["Omar", "Åsa", "Anna-Lena", "Anna", "Li", "E"];
eq(names("Testade att låta dem arbeta i par — betydligt lugnare.", roster), [], "text utan namn går igenom");
eq(names("omar pratade mindre", roster), ["Omar"], "skiftlägesokänsligt");
eq(names("OMAR och åsa", roster), ["Omar", "Åsa"], "versaler + å");
eq(names("Omars grupp blev lugn", roster), ["Omar"], "genitiv-s räknas");
eq(names("Omarsson är inget namn här", roster), [], "inte inne i ett längre ord");
eq(names("Lisa kom sent", roster), [], "Li matchar inte i Lisa (hela ord)");
eq(names("Li kom sent", roster), ["Li"], "kort namn som helt ord");
eq(names("E kom sent", roster), [], "enbokstavsnamn ignoreras");
eq(names("Anna-Lena och Anna", roster), ["Anna-Lena", "Anna"], "bindestrecksnamn före delnamn");
eq(names("Placering: (Omar) bredvid dörren.", roster), ["Omar"], "skiljetecken runt namnet");
eq(names("Klassen, några elever", []), [], "tom elevlista");
eq(names("Åsa var lugn", roster), ["Åsa"], "NFD-å normaliseras");
const hits = findStudentNames("Par med Omar gick bra", roster);
eq(highlightSegments("Par med Omar gick bra", hits), [
  { text: "Par med ", hit: false }, { text: "Omar", hit: true }, { text: " gick bra", hit: false },
], "markeringens segment");

// ---- Validering ----
eq(buildActionDoc({ text: "  Par i stället för enskilt  ", outcome: "better", category: "arbetssatt", lesson: null }),
  { text: "Par i stället för enskilt", outcome: "better", category: "arbetssatt", lesson: null }, "trimmad text");
eq(buildActionDoc({ text: "x", outcome: "same", category: "  ", lesson: { date: "2026-09-22", start: "10:15", end: "11:00", subjectId: "ma", title: "Matte", extra: 1 } }).lesson,
  { date: "2026-09-22", start: "10:15", end: "11:00", subjectId: "ma", title: "Matte" }, "lektionen rensas till kända fält");
eq(buildActionDoc({ text: "x", outcome: "same", category: "" }).category, null, "tom kategori → null");
throws(() => buildActionDoc({ text: "", outcome: "better" }), "tom text");
throws(() => buildActionDoc({ text: "x".repeat(TEXT_MAX + 1), outcome: "better" }), "för lång text");
throws(() => buildActionDoc({ text: "x", outcome: "great" }), "okänt utfall");
throws(() => buildActionDoc({ text: "x", outcome: "better", category: "k".repeat(41) }), "för lång kategori");
eq(buildReplyDoc({ actionId: "a1", text: "", outcome: "worse" }), { actionId: "a1", text: "", outcome: "worse" }, "svar utan text");
throws(() => buildReplyDoc({ actionId: "a1", text: "x".repeat(301), outcome: "worse" }), "för långt svar");
eq(cleanLesson({ start: "10:00" }), null, "lektion utan datum → null");

// ---- Kategorifiltret ----
eq(categoryOptions([{ category: "ljud" }, { category: "Läsro" }, { category: "läsro" }, { category: null }, { category: "arbetssatt" }]),
  [{ value: "arbetssatt", name: "Arbetssätt" }, { value: "ljud", name: "Ljud" }, { value: "egen:läsro", name: "Läsro" }],
  "förvalda först, egna skiftlägesokänsligt");
eq(categoryKey("Läsro"), "egen:läsro", "egen kategori-nyckel");

// ---- Koppling till statistiken ----
const L = (date, start, subjectId = "ma") => ({ date, start, end: null, subjectId, title: "" });
const stat = (lesson, typeId = "prat", positive = false) => ({ kind: "typ", typeId, positive, lesson, createdAt: 0 });
const many = (n, lesson, typeId) => Array.from({ length: n }, () => stat(lesson, typeId));
const tue = L("2026-09-22", "10:15");
const noteStats = [
  ...many(6, tue, "prat"), ...many(2, tue, "stol"), stat(tue, "positiv", true),
  ...many(20, L("2026-09-17", "10:15")),  // torsdag veckan före (5 dagar före)
  ...many(16, L("2026-09-15", "10:15")),  // tisdag veckan före (7 dagar före — precis i fönstret)
  ...many(30, L("2026-09-08", "10:15")),  // två veckor före — utanför fönstret
  ...many(4, L("2026-09-24", "10:15")),   // torsdag efter
  ...many(9, L("2026-09-22", "13:00", "sv")), // annat ämne samma dag
];
const sessions = [
  { type: "trafikljus", result: { color: "green", durationSec: 130 }, lesson: tue, startedAt: 1 },
  { type: "trafikljus", result: { color: "red", durationSec: 400 }, lesson: L("2026-09-24", "10:15"), startedAt: 2 },
];
const idx = lessonIndex(noteStats, sessions);
const st = lessonStatsFor({ lesson: tue, createdAt: 0 }, idx);
eq(st.neg, 8, "negativa streck vid lektionen");
eq(st.byType, [{ typeId: "prat", n: 6 }, { typeId: "stol", n: 2 }], "per typ, störst först");
eq(st.positive, 1, "positiva vid lektionen");
eq(st.passes.map((p) => p.result.durationSec), [130], "trafikljuspass vid lektionen");
eq(st.subjectLessons, 5, "matte-lektioner i statistiken");
eq(st.subjectAvg, (8 + 20 + 16 + 30 + 4) / 5, "snitt för ämnet");
eq(st.before, { avg: 18, lessons: 2 }, "veckan före (samma ämne)");
eq(st.after, { avg: 4, lessons: 1 }, "veckan efter (samma ämne)");
eq(lessonStatsFor({ lesson: null }, idx), null, "ingen lektion → ingen statistik");

// ---- Lektionsval ----
const now = new Date("2026-09-24T10:30:00").getTime();
const choices = lessonChoices({
  current: { date: "2026-09-24", start: "10:15", end: "11:00", subjectId: "ma", title: "Matte" },
  plans: [{ date: "2026-09-24", start: "10:15", end: "11:00", subjectId: "ma", name: "Matte" },
    { date: "2026-09-25", start: "08:00", end: "09:00", subjectId: "sv", name: "Framtida" }],
  noteStats, sessions, now,
});
eq(choices[0].title, "Matte", "pågående lektion först");
eq(choices.filter((c) => c.date === "2026-09-24" && c.start === "10:15").length, 1, "unika lektioner");
eq(choices.some((c) => c.date === "2026-09-25"), false, "framtida lektioner tas inte med");
eq(choices.some((c) => c.date === "2026-09-08"), false, "äldre än 14 dagar tas inte med");
eq(choices.slice(1, 3).map((c) => `${c.date} ${c.start}`), ["2026-09-22 13:00", "2026-09-22 10:15"], "nyast först");

console.log(`${passed} ok, ${failed} fel`);
process.exit(failed ? 1 : 0);
