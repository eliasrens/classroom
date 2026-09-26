/**
 * TEST — Mina ämnen (issue #81), js/lib/my-subjects.js.
 *
 *   node docs/test-my-subjects.mjs
 *
 * Kontrollerar filtreringslogiken:
 *   - inget val (inget dokument / tom lista) → ALLA ämnen visas (som förut)
 *   - med val → bara mina ämnen
 *   - ett valt ämne som inte är bland mina (t.ex. kopierad planering)
 *     visas ÄNDÅ via `keep` — inget "försvinner"
 *   - withMine lägger till utan dubbletter
 *   - okända id i keep/mine kraschar inget
 */

const { myIds, isMine, filterSubjects, withMine } = await import("../js/lib/my-subjects.js");
const { SUBJECTS } = await import("../js/lib/color.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}

const ids = (list) => list.map((s) => s.id).join(",");

// --- myIds: inget dokument / tom lista = inget val -------------------------
ok(myIds(null) === null, "inget dokument → null (alla visas)");
ok(myIds({}) === null, "dokument utan mine → null");
ok(myIds({ mine: [] }) === null, "tom lista → null (aldrig 'inga ämnen alls')");
ok(myIds({ mine: "sv" }) === null, "trasig mine (inte array) → null");
ok(myIds({ mine: ["sv", "hi"] })?.join(",") === "sv,hi", "sparade id:n kommer tillbaka");

// --- isMine ------------------------------------------------------------------
ok(isMine(null, "ma"), "utan val är alla ämnen mina");
ok(isMine(["sv", "hi"], "hi"), "valt ämne är mitt");
ok(!isMine(["sv", "hi"], "ma"), "ovalt ämne är inte mitt");

// --- filterSubjects: standard = allt ----------------------------------------
ok(ids(filterSubjects(SUBJECTS, null)) === ids(SUBJECTS),
  "mine=null → hela listan, oförändrad ordning");

// --- filterSubjects: bara mina ----------------------------------------------
const mine = ["sv", "hi", "ge"];
const filtered = filterSubjects(SUBJECTS, mine);
ok(ids(filtered) === "sv,hi,ge", "med val → bara mina, i SUBJECTS ordning");

// --- filterSubjects: valt ämne som inte är mitt syns ändå (keep) ------------
const withKept = filterSubjects(SUBJECTS, mine, { keep: ["ke"] });
ok(withKept.some((s) => s.id === "ke"),
  "planeringens valda ämne (ke, inte mitt) ska ändå synas i väljaren");
ok(ids(withKept) === "sv,hi,ge,ke", "keep lägger inte till något annat");
ok(ids(filterSubjects(SUBJECTS, mine, { keep: ["hi"] })) === "sv,hi,ge",
  "keep av ett redan valt ämne dubblerar inte");
ok(ids(filterSubjects(SUBJECTS, mine, { keep: [null, undefined, ""] })) === "sv,hi,ge",
  "tomma keep-värden ignoreras");
ok(ids(filterSubjects(SUBJECTS, mine, { keep: ["finns-inte"] })) === "sv,hi,ge",
  "okänt keep-id lägger inte till något");

// --- egna ämnen filtreras som alla andra ------------------------------------
const custom = [...SUBJECTS, { id: "eget-klassrad-x1", name: "Klassråd", color: "#4e8f72" }];
ok(ids(filterSubjects(custom, ["eget-klassrad-x1"])) === "eget-klassrad-x1",
  "eget ämne kan vara ett av mina");
ok(ids(filterSubjects(custom, null)).endsWith("eget-klassrad-x1"),
  "utan val visas egna ämnen som förut");

// --- withMine ----------------------------------------------------------------
ok(withMine(["sv"], "hi").join(",") === "sv,hi", "withMine lägger till");
ok(withMine(["sv", "hi"], "hi").join(",") === "sv,hi", "withMine dubblerar inte");
ok(withMine(null, "hi").join(",") === "hi", "withMine utan tidigare val");

console.log(`\n${passed} OK, ${failed} fel`);
if (failed > 0) process.exit(1);
