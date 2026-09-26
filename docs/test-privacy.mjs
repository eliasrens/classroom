/**
 * TEST — lokal gallring: standard 20 veckor och sparade val (issue #60).
 *
 *   node docs/test-privacy.mjs
 *
 * Rena funktioner + ett minimalt datalager i minnet — ingen Firestore,
 * inget nätverk. Påhittad testdata. Kontrollerar:
 *   - ny dator / ny klass (inget dokument) → 20 veckor
 *   - ett tidigare aktivt val (8 veckor, även 12) behålls oförändrat
 *   - pausen från #32 (awaitingChoice) gallrar inte, förvalet är 20 veckor
 *   - migreringen (#32) sätter pausen och rör inte ett sparat val
 *   - gallringen med standardvärdet: äldre än 20 veckor raderas, yngre inte
 *   - initial-läget är borttaget: studentLabel ger alltid förnamn (+ tag),
 *     ett gammalt settings/display tas bort idempotent
 */

// ---- Webbläsarglobaler (migreringen läser localStorage) ----
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
};

const P = await import("../js/lib/privacy.js");
const N = await import("../js/lib/names.js");
const M = await import("../js/data/migrate-local.js");

let failed = 0;
let passed = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}\n   fick     ${a}\n   väntade  ${e}`);
}

/** Minimalt datalager i minnet (samma API-yta som js/data/datalayer.js). */
function memData() {
  const colls = new Map();
  const coll = (p) => { if (!colls.has(p)) colls.set(p, new Map()); return colls.get(p); };
  return {
    colls,
    async list(p) { return [...coll(p).values()]; },
    async get(p, id) { return coll(p).get(id) ?? null; },
    async put(p, doc) { coll(p).set(doc.id, { ...doc }); return doc.id; },
    async remove(p, id) { coll(p).delete(id); },
  };
}

const WEEK = 7 * 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 26, 12).getTime();

// ---- Standardvärdet ----
eq(P.DEFAULT_RETENTION_WEEKS, 20, "standard = 20 veckor");
eq(P.RETENTION_OPTIONS.find((o) => o.weeks === 20)?.label, "20 veckor (ca en termin)", "etikett 20 veckor");
eq(P.RETENTION_OPTIONS.find((o) => o.weeks === 12)?.label, "12 veckor", "12 veckor heter inte längre 'en termin'");
eq(P.RETENTION_OPTIONS.map((o) => o.weeks), [1, 2, 4, 8, 12, 20], "befintliga val behålls");

eq(P.parsePrivacy(undefined), { noteRetentionWeeks: 20, awaitingChoice: false }, "inget dokument → 20 veckor");
eq(P.parsePrivacy({ noteRetentionWeeks: 0 }), { noteRetentionWeeks: 20, awaitingChoice: false }, "ogiltigt → 20 veckor");
eq(P.parsePrivacy({ noteRetentionWeeks: 8 }), { noteRetentionWeeks: 8, awaitingChoice: false }, "aktivt val 8 behålls");
eq(P.parsePrivacy({ noteRetentionWeeks: 12 }), { noteRetentionWeeks: 12, awaitingChoice: false }, "aktivt val 12 behålls");
eq(P.parsePrivacy({ noteRetentionWeeks: 12, awaitingChoice: true }), { noteRetentionWeeks: 20, awaitingChoice: true },
  "pausad: platshållaren 12 ignoreras, förval 20");

// ---- Datalagret: ny dator och sparat val ----
{
  const data = memData();
  eq(await P.loadPrivacy(data, "t1"), { noteRetentionWeeks: 20, awaitingChoice: false }, "ny dator → 20 veckor");
  await P.savePrivacy(data, "t1", { noteRetentionWeeks: 8 });
  eq(await P.loadPrivacy(data, "t1"), { noteRetentionWeeks: 8, awaitingChoice: false }, "sparat val 8 läses tillbaka");

  // Gallring med standardvärdet (ny klass t2): 21 v raderas, 19 v blir kvar.
  await data.put("classes/t2/notes", { id: "gammal", createdAt: NOW - 21 * WEEK });
  await data.put("classes/t2/notes", { id: "ung", createdAt: NOW - 19 * WEEK });
  eq(await P.runRetention(data, "t2", NOW), 1, "standardgallring raderar bara det äldre än 20 veckor");
  eq((await data.list("classes/t2/notes")).map((n) => n.id), ["ung"], "19 veckor gammal notering finns kvar");

  // Pausad gallring (#32) raderar inget.
  await data.put("classes/t3/privacy", { id: "privacy", value: { noteRetentionWeeks: 12, awaitingChoice: true } });
  await data.put("classes/t3/notes", { id: "gammal", createdAt: NOW - 30 * WEEK });
  eq(await P.runRetention(data, "t3", NOW), 0, "pausad gallring raderar inget");
  // Aktivt val häver pausen.
  await P.savePrivacy(data, "t3", { noteRetentionWeeks: 20 });
  eq(await P.loadPrivacy(data, "t3"), { noteRetentionWeeks: 20, awaitingChoice: false }, "bekräftat val häver pausen");
}

// ---- Migreringen (#32): paus för ingen inställning, sparat val orört ----
{
  mem.clear();
  const cache = (cid, docs) => mem.set(`classroom:data:classes/${cid}/settings`, JSON.stringify(docs));
  cache("a", { privacy: { id: "privacy", value: { noteRetentionWeeks: 8 } } });
  cache("b", { other: { id: "other", value: {} } });
  M.migrateStudentDataToLocal();
  const local = (cid) => JSON.parse(mem.get(`classroom:local:classes/${cid}/privacy`) ?? "{}").privacy?.value;
  eq(P.parsePrivacy(local("a")), { noteRetentionWeeks: 8, awaitingChoice: false }, "migrering: sparat 8 behålls");
  eq(P.parsePrivacy(local("b")), { noteRetentionWeeks: 20, awaitingChoice: true }, "migrering: inget val → paus, förval 20");
}

// ---- Initial-läget borttaget (#60) ----
eq(N.studentLabel({ firstName: "Elsa", tag: "🐱" }), "Elsa 🐱", "förnamn + tag");
eq(N.studentLabel({ firstName: "Anna-Lena" }), "Anna-Lena", "alltid förnamn");
eq(N.studentLabel({ firstName: "Bo" }, { initials: true }), "Bo", "gammal initials-flagga ignoreras");
eq("initialsFor" in N, false, "initialsFor är borttagen");
{
  const data = memData();
  await data.put("classes/t4/settings", { id: "display", value: { nameDisplay: "initials" } });
  await data.put("classes/t4/settings", { id: "elevlista", value: {} });
  eq(await N.removeLegacyNameDisplay(data, "t4", await data.list("classes/t4/settings")), true, "settings/display tas bort");
  eq((await data.list("classes/t4/settings")).map((d) => d.id), ["elevlista"], "andra inställningar orörda");
  eq(await N.removeLegacyNameDisplay(data, "t4", await data.list("classes/t4/settings")), false, "idempotent: inget att ta bort");
}

console.log(`${failed ? "FAIL" : "OK  "} test-privacy — ${passed} ok, ${failed} fel`);
if (failed) process.exit(1);
