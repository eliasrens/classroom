/**
 * TEST — menygrupperna i lägesregistret (issue #52).
 *
 *   node docs/test-nav.mjs
 *
 * Kontrollerar:
 *   - rutinerna (Morgon, Lektion) står i menyraden; Verktyg i ordningen
 *     Trafikljus, Skrivtavla, Lottning, Veckan; Elevlista + Översikt i "Lärare ▾"
 *   - `order` styr ordningen inom gruppen: ett verktyg med order 30
 *     (Tankekarta, #53) hamnar mellan Skrivtavla och Lottning
 *   - kortkommandonas ordning: rutinerna, sedan verktygen, sist lärarlägena,
 *     och alla lägen nås med en siffra (1–9)
 *   - verktygen är fortfarande elevlägen; lärarlägena aldrig
 *   - varje läge har en känd grupp
 */

import assert from "node:assert/strict";
import {
  MODES, NAV_GROUPS, NAV_GROUP_ORDER, modesInGroup, navOrder, STUDENT_MODE_IDS, isStudentMode,
} from "../js/modes/registry.js";
import { shortcutModes } from "../js/ui/shortcuts.js";

const ids = (list) => list.map((m) => m.id);

assert.deepEqual(ids(modesInGroup("classroom")), ["morgon", "lektion"]);
assert.deepEqual(ids(modesInGroup("tools")), ["trafikljus", "skriv", "lotta", "vecka"]);
assert.deepEqual(ids(modesInGroup("teacher")), ["elever", "oversikt"]);

for (const m of MODES) {
  assert.ok(NAV_GROUP_ORDER.includes(m.group), `${m.id}: okänd grupp ${m.group}`);
  assert.ok(NAV_GROUPS[m.group]?.label, `${m.id}: gruppen saknar etikett`);
}

const order = ids(navOrder());
assert.deepEqual(order, [
  ...ids(modesInGroup("classroom")), ...ids(modesInGroup("tools")), ...ids(modesInGroup("teacher")),
]);
assert.equal(order.length, MODES.length, "alla lägen står i menyordningen");
assert.ok(MODES.length <= 9, "alla lägen ska nås med en siffra (1–9)");
assert.deepEqual(ids(shortcutModes()), order);

// Ett nytt verktyg med order 30 hamnar mellan Skrivtavla och Lottning —
// både i menyn och i sifferordningen — oavsett var det står i MODES.
const tankekarta = { id: "tankekarta", title: "Tankekarta", group: "tools", order: 30 };
MODES.push(tankekarta);
try {
  assert.deepEqual(ids(modesInGroup("tools")), ["trafikljus", "skriv", "tankekarta", "lotta", "vecka"]);
  assert.deepEqual(ids(shortcutModes()),
    ["morgon", "lektion", "trafikljus", "skriv", "tankekarta", "lotta", "vecka", "elever", "oversikt"]);
} finally {
  MODES.pop();
}

for (const id of ["morgon", "lektion", "trafikljus", "vecka", "skriv", "lotta"]) {
  assert.ok(isStudentMode(id), `${id} ska kunna visas på elevskärmen`);
}
for (const id of ["elever", "oversikt"]) {
  assert.ok(!isStudentMode(id), `${id} får ALDRIG nå elevskärmen`);
}
assert.deepEqual([...STUDENT_MODE_IDS].sort(),
  MODES.filter((m) => m.group !== "teacher").map((m) => m.id).sort());

console.log("ok — menygrupper, ordning och elevspärr");
