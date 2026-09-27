/**
 * TEST — delad Bra jobbat-logik (issue #112).
 *
 *   node docs/test-praise-edit.mjs
 *
 * js/lib/praise-edit.js används av BÅDE Morgonskärmens panel och
 * Lektionsplaneringens fält "Visa Bra jobbat" (via js/ui/praise-editor.js).
 * Ingen DOM, ingen Firestore — datalagret är en liten attrapp i minnet
 * med samma get/once-kontrakt som js/data/datalayer.js. Kontrollerar:
 *   - kryssa i/ur elev, fritext (tom text skrivs aldrig), indata rörs inte
 *   - färskt utgångsläge: förra veckans lista töms, weekOf = innevarande
 *     vecka, framtida weekOf (fel klocka) behåller listan
 *   - editPraise: aktuell lista ändras på plats; en inaktuell lista
 *     arkiveras FÖRST och de nya namnen hamnar i en ren lista
 *   - vyns egna fält (Morgonskärmens showNametavla) följer med orörda
 */

process.env.TZ = "Europe/Stockholm";

// ---- Webbläsarglobaler (auth.js läser inloggad lärare ur localStorage) ----
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => { ls.set(k, String(v)); },
  removeItem: (k) => { ls.delete(k); },
  clear: () => ls.clear(),
  get length() { return ls.size; },
  key: (i) => [...ls.keys()][i] ?? null,
};
localStorage.setItem("classroom:auth:session", "local");

const {
  hasPraiseStudent, togglePraiseStudent, addPraiseFree, freshPraiseState, editPraise,
} = await import("../js/lib/praise-edit.js");
const { praisePath, PRAISE_DOC } = await import("../js/lib/morning.js");
const { praiseArchivePath } = await import("../js/lib/week-rhythm.js");
const { weekKey } = await import("../js/lib/week.js");

let failed = 0;
let passed = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}\n   fick     ${a}\n   väntade  ${e}`);
}

const WEEK = 7 * 86_400_000;
const now = Date.now();
const thisWeek = weekKey(now);
const lastWeek = weekKey(now - WEEK);
const nextWeek = weekKey(now + WEEK);
const stu = (id) => ({ id, kind: "student", studentId: id });
const free = (id, text) => ({ id, kind: "free", text });

// ---- Kryssa i/ur, fritext ----
{
  const list = [stu("a"), free("f", "Bordsgrupp 3")];
  eq(hasPraiseStudent(list, "a"), true, "eleven finns");
  eq(hasPraiseStudent(list, "f"), false, "fritext räknas inte som elev");

  const on = togglePraiseStudent(list, "b");
  eq(on, { praise: [stu("a"), free("f", "Bordsgrupp 3"), stu("b")], added: true }, "kryssa i: sist i listan");
  const off = togglePraiseStudent(on.praise, "a");
  eq(off, { praise: [free("f", "Bordsgrupp 3"), stu("b")], added: false }, "kryssa ur: bara den eleven försvinner");
  eq(list, [stu("a"), free("f", "Bordsgrupp 3")], "indata rörs inte");
  eq(togglePraiseStudent(undefined, "x").praise, [stu("x")], "saknad lista räknas som tom");

  eq(addPraiseFree(list, "  Hela klassen  ", "id1"), [...list, free("id1", "Hela klassen")], "fritext trimmas, läggs sist");
  eq(addPraiseFree(list, "   "), null, "tom fritext → ingenting");
  eq(typeof addPraiseFree([], "Text")[0].id, "string", "fritext får ett id");
}

// ---- Färskt utgångsläge ----
{
  const cur = { praise: [stu("a")], weekOf: thisWeek, showNametavla: false };
  eq(freshPraiseState(cur, now), cur, "innevarande vecka: listan kvar");
  eq(freshPraiseState({ praise: [stu("a")], weekOf: lastWeek }, now), { praise: [], weekOf: thisWeek }, "förra veckan: tom lista");
  eq(freshPraiseState({ praise: [stu("a")], weekOf: null }, now), { praise: [stu("a")], weekOf: thisWeek }, "saknad weekOf (äldre data): listan kvar");
  eq(freshPraiseState({ praise: [stu("a")], weekOf: nextWeek }, now), { praise: [stu("a")], weekOf: thisWeek }, "framtida weekOf (fel klocka): listan kvar, veckan rättas");
  const src = { praise: [stu("a")], weekOf: lastWeek };
  freshPraiseState(src, now);
  eq(src, { praise: [stu("a")], weekOf: lastWeek }, "källan rörs inte (kopia)");
}

// ---- editPraise mot en datalager-attrapp ----
function fakeData(initial = {}) {
  const colls = structuredClone(initial); // path → { id → doc }
  return {
    colls,
    async get(path, id) { return structuredClone(colls[path]?.[id] ?? null); },
    async put(path, doc) { (colls[path] ??= {})[doc.id] = structuredClone(doc); return doc.id; },
    async once(path, id, fn) {
      const writes = fn(structuredClone(colls[path]?.[id] ?? null));
      for (const w of writes ?? []) (colls[w.path] ??= {})[w.doc.id] = structuredClone(w.doc);
    },
  };
}
/** Lektionens sätt: tillståndet = det lokala board-dokumentet, commit skriver bara listan. */
function lessonHost(data, cid) {
  return {
    data, classId: cid,
    get: () => {
      const b = data.colls[praisePath(cid)]?.[PRAISE_DOC];
      return { praise: b?.praise ?? [], weekOf: b?.weekOf ?? null };
    },
    commit: (next) => data.put(praisePath(cid), { id: PRAISE_DOC, praise: next.praise, weekOf: next.weekOf }),
  };
}

{
  const cid = "qa-test";
  const data = fakeData({ [praisePath(cid)]: { board: { id: "board", praise: [stu("a")], weekOf: thisWeek } } });
  await editPraise(lessonHost(data, cid), (next) => { next.praise = togglePraiseStudent(next.praise, "b").praise; });
  eq(data.colls[praisePath(cid)].board, { id: "board", praise: [stu("a"), stu("b")], weekOf: thisWeek }, "aktuell lista: namnet läggs till");
  eq(data.colls[praiseArchivePath(cid)], undefined, "aktuell lista: inget arkiveras");
}

{
  const cid = "qa-test";
  const data = fakeData({ [praisePath(cid)]: { board: { id: "board", praise: [stu("a"), free("f", "Gammal")], weekOf: lastWeek } } });
  await editPraise(lessonHost(data, cid), (next) => { next.praise = togglePraiseStudent(next.praise, "c").praise; });
  eq(data.colls[praisePath(cid)].board.praise, [stu("c")], "inaktuell lista: nya namnet hamnar i en ren lista");
  eq(data.colls[praisePath(cid)].board.weekOf, thisWeek, "inaktuell lista: weekOf = innevarande vecka");
  eq(data.colls[praiseArchivePath(cid)]?.[lastWeek]?.praise, [stu("a"), free("f", "Gammal")], "inaktuell lista: arkiverad FÖRE ändringen");
}

{
  // Morgonskärmens sätt: tillståndet är det sammanslagna inställningsvärdet.
  // Rollover misslyckas här (inget board-dokument) — listan töms ändå.
  let settings = { praise: [stu("a")], weekOf: lastWeek, showNametavla: false, greeting: { variant: "godmorgon" } };
  const data = fakeData();
  let committed = null;
  await editPraise({
    data, classId: "qa-test", get: () => settings,
    commit: (next) => { committed = next; settings = next; },
  }, (next) => {
    const r = togglePraiseStudent(next.praise, "b");
    next.praise = r.praise;
    if (r.added) next.showNametavla = true; // Morgonskärmens onAdded
  });
  eq(committed, { praise: [stu("b")], weekOf: thisWeek, showNametavla: true, greeting: { variant: "godmorgon" } },
    "vyns egna fält följer med; inaktuell lista töms även om arkiveringen inte hade något att göra");
}

{
  const cid = "qa-test";
  const data = fakeData({ [praisePath(cid)]: { board: { id: "board", praise: [stu("a"), stu("b")], weekOf: thisWeek } } });
  await editPraise(lessonHost(data, cid), (next) => { next.praise = []; });
  eq(data.colls[praisePath(cid)].board.praise, [], "Töm Bra jobbat");
}

console.log(`${passed} ok, ${failed} fel`);
process.exit(failed ? 1 : 0);
