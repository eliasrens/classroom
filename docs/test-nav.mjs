/**
 * TEST — menygrupperna i lägesregistret + fästa lägen per lärare (issue #52).
 *
 *   node docs/test-nav.mjs
 *
 * Kontrollerar:
 *   - rutinerna (Morgon, Lektion) står i menyraden; Verktyg i ordningen
 *     Trafikljus, Skrivtavla, Tankekarta, Lottning, Veckan; Elevlista + Översikt i "Lärare ▾"
 *   - `order` styr ordningen inom gruppen: Tankekarta (#53, order 30)
 *     står mellan Skrivtavla och Lottning
 *   - kortkommandonas ordning: rutinerna, sedan verktygen, sist lärarlägena,
 *     och alla lägen nås med en siffra (1–9)
 *   - verktygen är fortfarande elevlägen; lärarlägena aldrig
 *   - varje läge har en känd grupp
 *   - fästa lägen (js/lib/menu-pins.js): standard Morgon, Lektion,
 *     Trafikljus; listans ordning; okända id ignoreras; nya verktyg är
 *     inte fästa; lärarlägen kan inte fästas
 *   - två lärare (olika uid) får var sin meny genom det RIKTIGA
 *     datalagret, och valet ligger under teachers/{uid}/settings/menu
 */

import assert from "node:assert/strict";
import {
  MODES, NAV_GROUPS, NAV_GROUP_ORDER, modesInGroup, navOrder, STUDENT_MODE_IDS, isStudentMode,
} from "../js/modes/registry.js";
import { shortcutModes } from "../js/ui/shortcuts.js";

const ids = (list) => list.map((m) => m.id);

assert.deepEqual(ids(modesInGroup("classroom")), ["morgon", "lektion"]);
assert.deepEqual(ids(modesInGroup("tools")), ["trafikljus", "skriv", "karta", "lotta", "vecka"]);
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

// Tankekarta (order 30) står mellan Skrivtavla och Lottning — både i menyn
// och i sifferordningen.
assert.deepEqual(ids(shortcutModes()),
  ["morgon", "lektion", "trafikljus", "skriv", "karta", "lotta", "vecka", "elever", "oversikt"]);

for (const id of ["morgon", "lektion", "trafikljus", "vecka", "skriv", "karta", "lotta"]) {
  assert.ok(isStudentMode(id), `${id} ska kunna visas på elevskärmen`);
}
for (const id of ["elever", "oversikt"]) {
  assert.ok(!isStudentMode(id), `${id} får ALDRIG nå elevskärmen`);
}
assert.deepEqual([...STUDENT_MODE_IDS].sort(),
  MODES.filter((m) => m.group !== "teacher").map((m) => m.id).sort());


// ---- Fästa lägen ----

const {
  DEFAULT_PINNED, MENU_SETTINGS_DOC, menuSettingsPath, pinnedIds, togglePinned, pinnableModes,
} = await import("../js/lib/menu-pins.js");

assert.deepEqual(pinnedIds(null), ["morgon", "lektion", "trafikljus"], "standard första gången");
assert.deepEqual([...DEFAULT_PINNED], ["morgon", "lektion", "trafikljus"]);
assert.deepEqual(ids(pinnableModes()), ["morgon", "lektion", "trafikljus", "skriv", "karta", "lotta", "vecka"]);
assert.deepEqual(pinnedIds({ pinned: ["vecka", "okänt", "morgon", "elever", "morgon"] }), ["morgon", "vecka"],
  "listans ordning, okända id och lärarlägen faller bort, inga dubbletter");
assert.deepEqual(pinnedIds({ pinned: [] }), [], "inget fäst är ett giltigt val");
assert.deepEqual(togglePinned(["morgon", "trafikljus"], "lotta"), ["morgon", "trafikljus", "lotta"]);
assert.deepEqual(togglePinned(["morgon", "lotta"], "skriv"), ["morgon", "skriv", "lotta"], "sorteras i listans ordning");
assert.deepEqual(togglePinned(["morgon", "lotta"], "morgon"), ["lotta"]);
assert.deepEqual(togglePinned(["morgon"], "oversikt"), ["morgon"], "lärarlägen kan inte fästas");
{
  // Ett nytt verktyg (Tankekarta) är inte fäst hos någon som redan sparat ett val.
  assert.ok(!pinnedIds(null).includes("karta"), "Tankekarta är inte fäst som standard");
  assert.deepEqual(pinnedIds({ pinned: ["morgon", "skriv", "lotta"] }), ["morgon", "skriv", "lotta"]);
  assert.deepEqual(togglePinned(["morgon", "skriv", "lotta"], "karta"), ["morgon", "skriv", "karta", "lotta"]);
}
assert.equal(menuSettingsPath("uidA"), "teachers/uidA/settings");

// ---- Två lärare, det riktiga datalagret (lokalt läge i Node) ----
{
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
    clear: () => mem.clear(),
    get length() { return mem.size; },
    key: (i) => [...mem.keys()][i] ?? null,
  };
  globalThis.window ??= new EventTarget();
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  const pushed = [];
  const factory = ({ onStatus }) => ({
    async start() { onStatus?.("online"); return true; },
    watch() {},
    reset() {},
    async push(op) { pushed.push(`${op.path}/${op.id}`); },
  });
  const { createDataLayer } = await import("../js/data/datalayer.js");
  const data = createDataLayer({ createSync: factory });
  const read = async (uid) => pinnedIds(await data.get(menuSettingsPath(uid), MENU_SETTINGS_DOC));

  assert.deepEqual(await read("uidA"), ["morgon", "lektion", "trafikljus"]);
  await data.put(menuSettingsPath("uidA"), { id: MENU_SETTINGS_DOC, pinned: togglePinned(await read("uidA"), "lotta") });
  await data.put(menuSettingsPath("uidB"), { id: MENU_SETTINGS_DOC, pinned: ["skriv"] });
  assert.deepEqual(await read("uidA"), ["morgon", "lektion", "trafikljus", "lotta"], "lärare A:s meny");
  assert.deepEqual(await read("uidB"), ["skriv"], "lärare B:s meny påverkas inte av A");
  assert.deepEqual(await read("uidC"), ["morgon", "lektion", "trafikljus"], "en ny lärare får standardvalet");
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(pushed.includes("teachers/uidA/settings/menu"), `valet synkas (följer läraren): ${pushed.join(", ")}`);
  assert.ok(pushed.includes("teachers/uidB/settings/menu"));
}

console.log("ok — menygrupper, ordning, elevspärr och fästa lägen per lärare");
