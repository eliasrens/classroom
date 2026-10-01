/**
 * TEST — Klassråd (issue #125, epic #124).
 *
 *   node docs/test-klassrad.mjs
 *
 * Rena funktioner (js/lib/klassrad.js) + det riktiga datalagret i Node med
 * en falsk molnattrapp. Påhittade namn och anteckningar. Kontrollerar:
 *   - standardmallen är lärarens egen (rubriker, hjälpfrågor, ordning)
 *   - normalisering av mall och möte: skräp faller bort, gränser, roller
 *   - ett nytt möte KOPIERAR mallens punkter (tomma anteckningar)
 *   - en ändrad mall påverkar inte ett gammalt möte
 *   - "förra klassrådet" hämtar uppföljningen från senaste tidigare möte
 *   - classes/{cid}/klassrad är ENDAST LOKAL (inget når molnet eller outboxen)
 *   - sekreterarens förval sparar aldrig ett elevnamn i molnet
 *   - Tab/Ctrl+Enter/Shift+Tab-navigeringen och bläddringen
 *   - datum → vecka, registreringen i lägesregistret
 */

// ---- Webbläsarglobaler (datalagret läser localStorage) ----
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
};

const K = await import("../js/lib/klassrad.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}\n   fick     ${a}\n   väntade  ${e}`);
}

const STUDENTS = ["Alva", "Bilal", "Cleo", "Dante", "Ebba"]; // påhittade

// ---- Standardmallen (lärarens Word-mall) ----
{
  const t = K.defaultTemplate();
  eq(t.points.map((p) => p.title), [
    "Vi startar", "Förra klassrådet", "Så här har vi det i klassen", "Lektioner och lärande",
    "Raster och trygghet", "Elevernas frågor och förslag", "Till elevrådet", "Till nästa klassråd",
  ], "standardmallens punkter i ordning");
  eq(t.points[0].prompts, ["Ordföranden öppnar klassrådet."], "punkt 1 hjälpfråga");
  eq(t.points[2].prompts, ["Vad fungerar bra?", "Är det något vi behöver förbättra?"], "punkt 3 hjälpfrågor");
  eq(t.points[6].notesLabel, "Det här skickar vi med:", "Till elevrådet: anteckningsrubrik");
  eq(t.points[7].notesLabel, "Det här behöver vi följa upp nästa gång:", "Till nästa klassråd: anteckningsrubrik");
  eq(K.pointNumbers(t.points), [1, 2, 3, 4, 5, 6, 7, null], "1–7 numrerade, Till nästa klassråd onumrerad");
  eq(t.points.map((p) => p.role), [null, "previous", null, null, null, null, "council", "followup"], "rollerna");
  ok(t.points.every((p) => !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(p.title + p.prompts.join(""))), "inga emoji i mallen");
  ok(K.isDefaultTemplate(t), "isDefaultTemplate(standard)");
  t.points[0].title = "Ändrad";
  ok(K.defaultTemplate().points[0].title === "Vi startar", "defaultTemplate() ger en ny kopia varje gång");
}

// ---- Normalisering av mallen ----
{
  eq(K.normalizeTemplate(null), K.defaultTemplate(), "ingen mall → standardmallen");
  eq(K.normalizeTemplate({ points: [] }), K.defaultTemplate(), "tom mall → standardmallen");
  eq(K.normalizeTemplate({ points: [{ id: "a", title: "   " }] }), K.defaultTemplate(), "bara rubriklösa punkter → standardmallen");
  const t = K.normalizeTemplate({
    points: [
      { id: "a", title: "  Första   punkten ", prompts: ["  Fråga ett ", "", 42, "Fråga två"], icon: "okänd", extra: "x" },
      { id: "a", title: "Dubblett" },
      { id: "b", title: "", prompts: ["utan rubrik"] },
      { id: "bad id!", title: "Trasigt id" },
      null, "skräp",
      { id: "c", title: "Två previous", role: "previous" },
      { id: "d", title: "Andra previous", role: "previous", numbered: false, notesLabel: "  " },
      { id: "e", title: "x".repeat(200), prompts: Array.from({ length: 20 }, (_, i) => `F${i}`) },
    ],
  });
  eq(t.points.map((p) => p.id), ["a", "c", "d", "e"], "dubbletter, rubriklösa och trasiga punkter faller bort");
  eq(t.points[0].title, "Första punkten", "rubriken trimmas");
  eq(t.points[0].prompts, ["Fråga ett", "42", "Fråga två"], "hjälpfrågorna trimmas, tomma faller bort");
  eq(t.points[0].icon, "chat", "okänd ikon → chat");
  ok(!("extra" in t.points[0]), "okända fält följer inte med");
  eq(t.points[1].role, "previous", "första previous behåller rollen");
  eq(t.points[2].role, null, "en roll får bara finnas en gång");
  eq(t.points[2].numbered, false, "numbered: false behålls");
  eq(t.points[2].notesLabel, "Anteckningar", "tom anteckningsrubrik → Anteckningar");
  eq(t.points[3].title.length, K.MAX_TITLE, "rubriken kortas");
  eq(t.points[3].prompts.length, K.MAX_PROMPTS, "högst MAX_PROMPTS hjälpfrågor");
  const many = K.normalizeTemplate({ points: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, title: `P${i}` })) });
  eq(many.points.length, K.MAX_POINTS, "högst MAX_POINTS punkter");
  eq(K.templateFromSettings({ id: "klassrad", template: null }), K.defaultTemplate(), "template: null → standard");
}

// ---- Normalisering av mötet ----
{
  eq(K.normalizeMeeting(null), null, "null → null");
  eq(K.normalizeMeeting({ id: "state", cur: "m-1" }), null, "state-dokumentet är inget möte");
  eq(K.normalizeMeeting({ id: "map-1" }), null, "fel id-prefix → null");
  const m = K.normalizeMeeting({
    id: "m-abc",
    date: "2026-02-30",
    createdAt: new Date(2026, 8, 17, 10).getTime(),
    chair: "  Alva  ",
    secretary: "x".repeat(100),
    points: [
      { id: "start", title: "Vi startar", notes: "Rad ett\r\nRad två\rRad tre" },
      { id: "next", title: "Till nästa", role: "followup", notes: 42 },
    ],
    shown: "finns-inte",
    followDone: ["a", "a", 3, "b"],
    rev: "7",
  });
  eq(m.date, "2026-09-17", "ogiltigt datum → skapelsedagen");
  eq(m.chair, "Alva", "ordföranden trimmas");
  eq(m.secretary.length, K.MAX_NAME, "sekreteraren kortas");
  eq(m.points[0].notes, "Rad ett\nRad två\nRad tre", "radbrytningar normaliseras");
  eq(m.points[1].notes, "", "anteckningar som inte är text → tomma");
  eq(m.shown, "start", "okänd visad punkt → första punkten");
  eq(m.followDone, ["a", "b"], "avbockningar: unika strängar");
  eq(m.rev, 7, "rev är ett tal");
  eq(K.normalizeMeeting({ id: "m-x", points: [{ id: "a", title: "A" }], shown: "all" }).shown, "all", "Visa alla behålls");
  eq(K.noteLines("  ett \n\n två\n   \ntre "), ["ett", "två", "tre"], "noteLines: tomma rader faller bort");
  ok(!K.hasContent(K.newMeeting(K.defaultTemplate())), "ett nytt möte är tomt");
}

// ---- Nytt möte kopierar mallens punkter ----
{
  const template = K.normalizeTemplate({
    points: [
      { id: "a", title: "Egen start", prompts: ["Hej?"], icon: "hand" },
      { id: "b", title: "Egen uppföljning", role: "followup", numbered: false },
    ],
  });
  const m = K.newMeeting(template, { date: "2026-10-01", secretary: "Lärare", now: 1000 });
  ok(K.isMeetingId(m.id), "nytt möte har ett möte-id");
  eq(m.points.map((p) => p.title), ["Egen start", "Egen uppföljning"], "mötets punkter = mallens");
  eq(m.points.map((p) => p.notes), ["", ""], "tomma anteckningar");
  eq(m.shown, "a", "första punkten visas");
  eq([m.date, m.secretary, m.chair], ["2026-10-01", "Lärare", ""], "datum och sekreterare");
  ok(m.points[0] !== template.points[0] && m.points[0].prompts !== template.points[0].prompts, "punkterna är kopior");
  template.points[0].title = "Ändrad i mallen";
  template.points[0].prompts.push("Ny fråga");
  eq(m.points[0].title, "Egen start", "ändrad mall ändrar inte mötets rubrik");
  eq(m.points[0].prompts, ["Hej?"], "ändrad mall ändrar inte mötets hjälpfrågor");
  const d = K.newMeeting(null, { date: "fel", now: new Date(2026, 9, 1, 9).getTime() });
  eq(d.points.length, 8, "utan mall: standardmallen");
  eq(d.date, "2026-10-01", "ogiltigt datum → dagens");
  ok(K.newMeeting(K.defaultTemplate()).id !== K.newMeeting(K.defaultTemplate()).id, "unika möte-id");
}

// ---- Ändrad mall påverkar inte ett gammalt möte (genom lagringen) ----
{
  const old = K.newMeeting(K.defaultTemplate(), { date: "2026-09-03" });
  old.points[0].notes = "Hugo öppnade";
  const stored = JSON.parse(JSON.stringify(old));
  const settings = { id: "klassrad", template: { points: [{ id: "x", title: "Helt ny mall" }] } };
  const newTemplate = K.templateFromSettings(settings);
  const reread = K.normalizeMeeting(stored);
  eq(reread.points.map((p) => p.title), K.defaultTemplate().points.map((p) => p.title), "gamla mötet har kvar sina punkter");
  eq(reread.points[0].notes, "Hugo öppnade", "och sina anteckningar");
  eq(K.newMeeting(newTemplate).points.map((p) => p.title), ["Helt ny mall"], "ett nytt möte får den nya mallen");
}

// ---- Förra klassrådet ----
{
  const mk = (date, createdAt, notes = {}) => {
    const m = K.newMeeting(K.defaultTemplate(), { date, now: createdAt });
    for (const p of m.points) p.notes = notes[p.id] ?? "";
    return m;
  };
  const sep03 = mk("2026-09-03", 1, { start: "Öppnat", next: "Gammal uppföljning" });
  const sep17 = mk("2026-09-17", 2, { start: "Öppnat", next: "Prova tyst läsning\n\nNytt schema för planen", council: "Fler bänkar" });
  const sep24 = mk("2026-09-24", 3); // tomt möte (aldrig ifyllt) räknas inte
  const oct01 = mk("2026-10-01", 4);
  const oct08 = mk("2026-10-08", 5, { next: "Framtida" });
  const all = [oct08, sep03, oct01, sep24, sep17];

  const prev = K.previousFollowUp(all, oct01);
  eq(prev?.from, { id: sep17.id, date: "2026-09-17" }, "senaste tidigare mötet med innehåll (inte det tomma, inte senare)");
  eq(prev?.groups.map((g) => [g.role, g.title, g.items.map((i) => i.text)]), [
    ["followup", "Till nästa klassråd", ["Prova tyst läsning", "Nytt schema för planen"]],
    ["council", "Till elevrådet", ["Fler bänkar"]],
  ], "Till nästa klassråd (och Till elevrådet) som rader");
  ok(prev.groups[0].items.every((i) => i.key.startsWith(`${sep17.id}:next:`)), "nyckeln pekar på källmötet och punkten");
  eq(new Set(prev.groups.flatMap((g) => g.items.map((i) => i.key))).size, 3, "unika nycklar");
  eq(K.previousFollowUp(all, sep03), null, "inget tidigare klassråd → null (rutan syns inte)");
  eq(K.previousFollowUp(all, sep17)?.from.id, sep03.id, "17 sep → 3 sep");
  eq(K.previousFollowUp([sep17], sep17), null, "mötet självt räknas aldrig");
  // Samma datum: skapelsetiden avgör.
  const sameDayEarly = mk("2026-10-01", 3.5, { next: "Samma dag, tidigare" });
  eq(K.previousFollowUp([...all, sameDayEarly], oct01)?.from.id, sameDayEarly.id, "samma datum: det som skapades först");
  // Ett tidigare möte utan uppföljningsrader → rutan visar "inget att följa upp".
  const noFollow = mk("2026-09-30", 3.7, { start: "Bara start" });
  eq(K.previousFollowUp([...all, noFollow], oct01)?.groups, [], "tidigare möte utan uppföljning → tomma grupper");
  // Mallen utan uppföljningspunkt: inga rader.
  const custom = K.newMeeting(K.normalizeTemplate({ points: [{ id: "a", title: "A" }] }), { date: "2026-09-29", now: 3.8 });
  custom.points[0].notes = "Något";
  eq(K.previousFollowUp([custom], oct01)?.groups, [], "utan uppföljningspunkt: inga rader");
  eq(K.sortMeetings(all).map((m) => m.date), ["2026-10-08", "2026-10-01", "2026-09-24", "2026-09-17", "2026-09-03"], "arkivet: nyaste först");
}

// ---- Sekreterarens förval: aldrig ett elevnamn i molnet ----
{
  eq(K.teacherLabel(null), "Lärare", "lokalt läge: Lärare");
  eq(K.teacherLabel("Elias"), "Elias", "inloggad lärare");
  eq(K.secretaryPref("Jag", "Elias"), "me", "Jag → me");
  eq(K.secretaryPref("elias", "Elias"), "me", "lärarens namn → me");
  eq(K.secretaryPref("Lärare", null), "me", "Lärare (lokalt) → me");
  eq(K.secretaryPref("", "Elias"), null, "tomt → inget förval");
  for (const name of STUDENTS) eq(K.secretaryPref(name, "Elias"), null, `elevnamnet ${name} → inget förval`);

  let doc = null;
  doc = K.withSecretaryPref(doc, "qa-test-a", "Jag", "Elias");
  eq(doc.secretary, { "qa-test-a": "me" }, "Jag sparas som me");
  eq(K.secretaryDefault(doc, "qa-test-a", "Elias"), "Elias", "nästa möte: lärarens namn förifyllt");
  eq(K.secretaryDefault(doc, "qa-test-a", null), "Lärare", "nästa möte, lokalt: Lärare");
  eq(K.secretaryDefault(doc, "qa-test-b", "Elias"), "", "annan klass: inget förval");
  doc = K.withSecretaryPref(doc, "qa-test-b", "Elias", "Elias");
  doc = K.withSecretaryPref(doc, "qa-test-a", "Ebba", "Elias"); // senaste valet: en elev
  eq(doc.secretary, { "qa-test-b": "me" }, "elev vald → klassens förval tas bort, inget namn sparas");
  eq(K.secretaryDefault(doc, "qa-test-a", "Elias"), "", "efter elevval: tomt förval");
  // Ett trasigt dokument med ett namn i kartan städas bort vid nästa sparning.
  const dirty = { id: "klassrad", template: null, secretary: { "qa-test-c": "Cleo", "qa-test-d": "me" } };
  const clean = K.withSecretaryPref(dirty, "qa-test-a", "Bilal", "Elias");
  eq(clean.secretary, { "qa-test-d": "me" }, "bara me-markörer överlever");
  eq(K.secretaryDefault(dirty, "qa-test-c", "Elias"), "", "ett namn i dokumentet förifylls aldrig");
  const json = JSON.stringify([doc, clean]);
  ok(STUDENTS.every((n) => !json.includes(n)), `inget elevnamn i settings-dokumentet: ${json}`);
  eq(doc.id, "klassrad", "dokument-id klassrad");
  eq(K.klassradSettingsPath("uidA"), "teachers/uidA/settings", "privat per lärare");
}

// ---- Skrivflödet: Tab / Ctrl+Enter / Shift+Tab ----
{
  const at = (over) => K.notesNavTarget({ selectionStart: 5, selectionEnd: 5, length: 5, index: 2, count: 8, ...over });
  eq(at({ key: "Tab" }), 3, "Tab i slutet → nästa punkt");
  eq(at({ key: "Tab", selectionStart: 2, selectionEnd: 2 }), null, "Tab mitt i texten → fältets eget beteende");
  eq(at({ key: "Tab", selectionStart: 0, selectionEnd: 5 }), null, "Tab med markering → fältets eget beteende");
  eq(at({ key: "Tab", length: 0, selectionStart: 0, selectionEnd: 0 }), 3, "Tab i tomt fält → nästa punkt");
  eq(at({ key: "Enter", ctrlKey: true, selectionStart: 1, selectionEnd: 1 }), 3, "Ctrl+Enter var som helst → nästa punkt");
  eq(at({ key: "Enter", metaKey: true }), 3, "⌘+Enter → nästa punkt");
  eq(at({ key: "Enter" }), null, "Enter → ny rad (fältets eget)");
  eq(at({ key: "Enter", shiftKey: true }), null, "Shift+Enter → fältets eget");
  eq(at({ key: "Tab", shiftKey: true, selectionStart: 3, selectionEnd: 3 }), 1, "Shift+Tab → föregående punkt");
  eq(at({ key: "Tab", shiftKey: true, index: 0 }), null, "Shift+Tab i första punkten → fältets eget");
  eq(at({ key: "Tab", index: 7 }), null, "Tab i sista punkten → lämnar fältet som vanligt");
  eq(at({ key: "Enter", ctrlKey: true, index: 7 }), null, "Ctrl+Enter i sista punkten → inget");
  eq(at({ key: "Tab", altKey: true }), null, "Alt+Tab rörs inte");
  eq(at({ key: "Tab", ctrlKey: true }), null, "Ctrl+Tab (byt flik) rörs inte");
  eq(at({ key: "a" }), null, "vanliga tangenter rörs inte");

  const pts = K.defaultTemplate().points;
  eq(K.stepShown(pts, "start", 1), "previous", "Nästa");
  eq(K.stepShown(pts, "start", -1), "start", "Föregående i första → stannar");
  eq(K.stepShown(pts, "next", 1), "next", "Nästa i sista → stannar");
  eq(K.stepShown(pts, "all", 1), "start", "ur Visa alla framåt → första");
  eq(K.stepShown(pts, "all", -1), "next", "ur Visa alla bakåt → sista");
  eq(K.stepShown([], "x", 1), "all", "inga punkter");
}

// ---- Datum och vecka ----
{
  eq(K.weekOfDate("2026-10-01"), 40, "1 okt 2026 = v. 40");
  eq(K.weekOfDate("2026-01-01"), 1, "1 jan 2026 = v. 1");
  eq(K.weekOfDate("2027-01-01"), 53, "1 jan 2027 = v. 53 (ISO)");
  eq(K.weekOfDate("2026-12-28"), 53, "28 dec 2026 = v. 53");
  eq(K.weekOfDate("2026-13-01"), null, "ogiltigt datum → null");
  ok(K.isIsoDate("2028-02-29") && !K.isIsoDate("2026-02-29"), "skottdag");
  eq(K.formatDate("2026-10-01"), "1 oktober 2026", "långt datum");
  eq(K.formatDate("2026-09-17", { short: true }), "17 sep", "kort datum");
  eq(K.formatDate("2026-09-17", { short: true, year: true }), "17 sep 2026", "kort datum med år");
  eq(K.isoDate(new Date(2026, 9, 1, 23, 59).getTime()), "2026-10-01", "isoDate i lokal tid");
}

// ---- Det eleverna ser ----
{
  const m = K.newMeeting(K.defaultTemplate(), { date: "2026-10-01" });
  const pub = K.publicMeeting(m);
  eq(Object.keys(pub).sort(), ["chair", "date", "followDone", "id", "points", "secretary", "shown"], "bussen bär bara mötets innehåll");
  pub.points[0].notes = "ändrad";
  eq(m.points[0].notes, "", "bussens kopia delar inte objekt med lärarens möte");
  eq(K.publicMeeting(null), null, "inget utskickat → null");
}

// ---- Registret ----
{
  const { MODES, modesInGroup, isStudentMode, getMode } = await import("../js/modes/registry.js");
  const tools = modesInGroup("tools").map((m) => m.id);
  ok(tools.indexOf("klassrad") === tools.indexOf("lotta") + 1 && tools.indexOf("vecka") === tools.indexOf("klassrad") + 1,
    `Klassråd står mellan Lottning och Veckan: ${tools.join(", ")}`);
  const kr = getMode("klassrad");
  eq([kr.group, kr.short, kr.order, kr.title], ["tools", "Klassråd", 45, "Klassråd"], "group/short/order");
  ok(isStudentMode("klassrad"), "Klassråd kan visas på elevskärmen");
  ok(MODES.filter((m) => m.id === "klassrad").length === 1, "registrerad en gång");
  const { pinnedIds } = await import("../js/lib/menu-pins.js");
  ok(!pinnedIds(null).includes("klassrad"), "inte fäst från början");
  const { icon } = await import("../js/lib/icons.js");
  const fallback = icon("finns-inte-alls");
  for (const name of [kr.icon, ...K.POINT_ICONS]) ok(icon(name) !== fallback, `ikonen ${name} finns i icons.js`);
}

// ---- ENDAST LOKALT: classes/{cid}/klassrad når aldrig molnet ----
{
  globalThis.window = new EventTarget();
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  const pushed = [];
  const factory = ({ onStatus }) => ({
    async start() { onStatus?.("online"); return true; },
    watch() {},
    reset() {},
    async push(op) { pushed.push({ key: `${op.path}/${op.id}`, json: JSON.stringify(op) }); },
  });
  const { createDataLayer } = await import("../js/data/datalayer.js");
  const { isLocalOnlyPath, localStorageKeyFor } = await import("../js/data/local-only.js");
  const P = K.klassradPath("qa-test-kr");
  ok(isLocalOnlyPath(P), "classes/{cid}/klassrad är ENDAST LOKAL");
  ok(!isLocalOnlyPath("teachers/local/settings"), "lärarens settings (mallen) är inte lokal — den följer läraren");
  const data = createDataLayer({ createSync: factory });
  const m = K.newMeeting(K.defaultTemplate(), { date: "2026-10-01", secretary: "Lärare" });
  m.chair = "Ebba";
  m.points[2].notes = "Cleo vill ha fler grupparbeten";
  await data.put(P, m);
  await data.put(P, { id: K.STATE_ID, cur: m.id, presented: m.id, follow: true, rev: 1 });
  let settings = K.withSecretaryPref(null, "qa-test-kr", "Lärare", null);
  settings = { ...settings, template: K.defaultTemplate() };
  await data.put(K.klassradSettingsPath("uidA"), settings);
  await new Promise((r) => setTimeout(r, 300));
  ok(pushed.some((p) => p.key === "teachers/uidA/settings/klassrad"), `kontroll: mallen synkas (${pushed.map((p) => p.key).join(", ")})`);
  ok(pushed.every((p) => !p.key.includes("/klassrad/")), "inget klassråd når molnet");
  ok(pushed.every((p) => !STUDENTS.some((n) => p.json.includes(n))), "inget elevnamn når molnet");
  const outbox = [...mem.entries()].filter(([k]) => k.startsWith("classroom:outbox")).map(([, v]) => v).join("");
  ok(!outbox.includes("/klassrad") && !STUDENTS.some((n) => outbox.includes(n)), "inget klassråd i outboxen");
  ok(mem.has(localStorageKeyFor(P)), "klassrådet ligger lokalt under classroom:local:");
  eq((await data.get(P, m.id))?.chair, "Ebba", "mötet går att läsa lokalt");
  // "Radera all data för klass" hittar samlingen (privacy.js tar alla samlingar under klassen).
  ok((await data.collections("classes/qa-test-kr/")).includes(P), "Radera all data för klass hittar klassråden");
  const { deleteAllClassData } = await import("../js/lib/privacy.js");
  await data.put("classes", { id: "qa-test-kr", name: "QA-TEST-KR" });
  await deleteAllClassData(data, "qa-test-kr");
  eq(await data.list(P), [], "Radera all data för klass tar bort klassråden");
}

console.log(`${passed} OK, ${failed} fel`);
process.exit(failed ? 1 : 0);
