/**
 * TEST — Mina klasser (issue #102), js/lib/my-classes.js.
 *
 *   node docs/test-my-classes.mjs
 *
 * Kontrollerar filtreringslogiken:
 *   - inget val (inget dokument / tom lista) → ALLA klasser visas (som förut)
 *   - med val → bara mina klasser
 *   - den aktiva klassen visas ÄNDÅ via `keep` — appen byter aldrig
 *     klass i tysthet (#31)
 *   - borttagna klasser (okända id:n) tåls; finns ingen vald klass kvar
 *     räknas det som inget val
 *   - withMyClass lägger till utan dubbletter
 *   - saveMyClasses skriver teachers/{uid}/settings/classes
 */

const {
  MY_CLASSES_DOC, myClassesPath, myClassIds, isMyClass, filterClasses, withMyClass, saveMyClasses,
} = await import("../js/lib/my-classes.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}

const ids = (list) => list.map((c) => c.id).join(",");
const CLASSES = [
  { id: "qa-test-a", name: "QA-TEST-A" },
  { id: "qa-test-b", name: "QA-TEST-B" },
  { id: "qa-test-c", name: "QA-TEST-C" },
  { id: "qa-test-d", name: "QA-TEST-D" },
];

// --- myClassIds: inget dokument / tom lista = inget val ----------------------
ok(myClassIds(null) === null, "inget dokument → null (alla visas)");
ok(myClassIds(undefined) === null, "undefined → null");
ok(myClassIds({}) === null, "dokument utan mine → null");
ok(myClassIds({ mine: [] }) === null, "tom lista → null (aldrig 'inga klasser alls')");
ok(myClassIds({ mine: "qa-test-a" }) === null, "trasig mine (inte array) → null");
ok(myClassIds({ mine: ["qa-test-a", "qa-test-b"] })?.join(",") === "qa-test-a,qa-test-b",
  "sparade id:n kommer tillbaka");

// --- isMyClass ---------------------------------------------------------------
ok(isMyClass(null, "qa-test-c"), "utan val är alla klasser mina");
ok(isMyClass(["qa-test-a"], "qa-test-a"), "vald klass är min");
ok(!isMyClass(["qa-test-a"], "qa-test-c"), "ovald klass är inte min");

// --- filterClasses: inget val → alla ----------------------------------------
ok(filterClasses(CLASSES, null) === CLASSES, "mine=null → hela listan, oförändrad");
ok(ids(filterClasses(CLASSES, myClassIds({ mine: [] }), { keep: ["qa-test-a"] })) === ids(CLASSES),
  "tom sparad lista → alla klasser, som förut");

// --- filterClasses: bara mina ------------------------------------------------
const mine = ["qa-test-b", "qa-test-d"];
ok(ids(filterClasses(CLASSES, mine)) === "qa-test-b,qa-test-d", "med val → bara mina, i listans ordning");

// --- filterClasses: den aktiva klassen syns alltid (keep) --------------------
ok(ids(filterClasses(CLASSES, mine, { keep: ["qa-test-a"] })) === "qa-test-a,qa-test-b,qa-test-d",
  "aktiv klass som inte är min syns ändå");
ok(ids(filterClasses(CLASSES, mine, { keep: ["qa-test-b"] })) === "qa-test-b,qa-test-d",
  "keep av en redan vald klass dubblerar inte");
ok(ids(filterClasses(CLASSES, mine, { keep: [null, undefined, ""] })) === "qa-test-b,qa-test-d",
  "tomma keep-värden ignoreras (ingen aktiv klass)");
ok(ids(filterClasses(CLASSES, mine, { keep: ["finns-inte"] })) === "qa-test-b,qa-test-d",
  "okänt keep-id lägger inte till något");

// --- borttagna klasser -------------------------------------------------------
ok(ids(filterClasses(CLASSES, ["qa-test-b", "borttagen"])) === "qa-test-b",
  "okänt id i mine (borttagen klass) ignoreras");
ok(ids(filterClasses(CLASSES, ["borttagen"], { keep: ["qa-test-a"] })) === ids(CLASSES),
  "ingen vald klass finns kvar → som inget val (alla visas, aldrig tom väljare)");
ok(filterClasses([], mine).length === 0, "tom klasslista kraschar inte");

// --- withMyClass -------------------------------------------------------------
ok(withMyClass(["qa-test-a"], "qa-test-b").join(",") === "qa-test-a,qa-test-b", "withMyClass lägger till");
ok(withMyClass(["qa-test-a", "qa-test-b"], "qa-test-b").join(",") === "qa-test-a,qa-test-b",
  "withMyClass dubblerar inte");
ok(withMyClass(null, "qa-test-b").join(",") === "qa-test-b", "withMyClass utan tidigare val");
const before = ["qa-test-a"];
withMyClass(before, "qa-test-b");
ok(before.join(",") === "qa-test-a", "withMyClass muterar inte originalet");

// --- saveMyClasses: rätt dokument, privat per lärare ------------------------
ok(MY_CLASSES_DOC === "classes", "dokument-id = classes");
ok(myClassesPath("uid-x") === "teachers/uid-x/settings", "path = teachers/{uid}/settings");
const puts = [];
const fakeData = { put: async (path, doc) => { puts.push({ path, doc }); return doc.id; } };
await saveMyClasses(fakeData, ["qa-test-a"]);
await saveMyClasses(fakeData, null);
ok(puts[0]?.path.startsWith("teachers/") && puts[0]?.path.endsWith("/settings"), "sparas under teachers/{uid}/settings");
ok(puts[0]?.doc.id === "classes" && puts[0]?.doc.mine.join(",") === "qa-test-a", "sparar { id: classes, mine }");
ok(Array.isArray(puts[1]?.doc.mine) && puts[1].doc.mine.length === 0, "null sparas som tom lista (= inget val)");

console.log(`\n${passed} OK, ${failed} fel`);
if (failed > 0) process.exit(1);
