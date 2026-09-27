/**
 * TEST — "Visa på elevskärm": statuslogiken (issue #88).
 *
 *   node docs/test-present.mjs
 *
 * Kontrollerar vad som räknas som "eleverna ser exakt det läraren tittar
 * på" (grön panel) respektive inte (guld panel), och etiketten
 * "Eleverna ser: Lektionsplanering · Bråk intro".
 */

import assert from "node:assert/strict";
import { isExactlyPresented, presentedLabel } from "../js/lib/present.js";

const spot = (modeId, currentId, presentedId, labels = {}) => ({
  modeId,
  current: currentId ? { id: currentId, label: labels.current ?? currentId } : null,
  presented: presentedId ? { id: presentedId, label: labels.presented ?? presentedId } : null,
});

// ---- isExactlyPresented ----

// Annat läge utskickat → aldrig grönt, oavsett spot.
assert.equal(isExactlyPresented({ modeId: "lektion", presentedMode: "trafikljus", spot: null }), false);
assert.equal(isExactlyPresented({ modeId: "lektion", presentedMode: "trafikljus", spot: spot("lektion", "a", "a") }), false);
// Inget utskickat läge alls → guld.
assert.equal(isExactlyPresented({ modeId: "lektion", presentedMode: null, spot: null }), false);
assert.equal(isExactlyPresented({ modeId: null, presentedMode: null, spot: null }), false);

// Läge utan "flera saker" (inget spot): samma läge räcker.
assert.equal(isExactlyPresented({ modeId: "trafikljus", presentedMode: "trafikljus", spot: null }), true);
// Ett kvarglömt spot från ett ANNAT läge räknas inte.
assert.equal(isExactlyPresented({ modeId: "trafikljus", presentedMode: "trafikljus", spot: spot("lektion", "a", "b") }), true);

// Läge med "flera saker": samma läge OCH samma sak = grönt.
assert.equal(isExactlyPresented({ modeId: "lektion", presentedMode: "lektion", spot: spot("lektion", "a", "a") }), true);
// Samma läge men ANNAN planering/karta = guld.
assert.equal(isExactlyPresented({ modeId: "lektion", presentedMode: "lektion", spot: spot("lektion", "b", "a") }), false);
// Läraren tittar på en planering, inget utskickat i läget = guld.
assert.equal(isExactlyPresented({ modeId: "lektion", presentedMode: "lektion", spot: spot("lektion", "a", null) }), false);
// Läraren tittar på tomläge men eleverna ser en planering = guld.
assert.equal(isExactlyPresented({ modeId: "lektion", presentedMode: "lektion", spot: spot("lektion", null, "a") }), false);
// Båda tomma (tomläge ute och hemma) = samma sak = grönt.
assert.equal(isExactlyPresented({ modeId: "lektion", presentedMode: "lektion", spot: spot("lektion", null, null) }), true);

// ---- presentedLabel ----

// Inget utskickat → ingen etikett.
assert.equal(presentedLabel({ presentedMode: null, modeTitle: null, spot: null }), null);
// Läge utan sak → bara lägets titel.
assert.equal(presentedLabel({ presentedMode: "trafikljus", modeTitle: "Trafikljusur", spot: null }), "Trafikljusur");
// Utskickad planering med namn → "Lektionsplanering · Bråk intro".
assert.equal(
  presentedLabel({
    presentedMode: "lektion", modeTitle: "Lektionsplanering",
    spot: spot("lektion", "b", "a", { presented: "Bråk intro" }),
  }),
  "Lektionsplanering · Bråk intro");
// Utskickat tomläge i läget → bara lägets titel.
assert.equal(
  presentedLabel({ presentedMode: "lektion", modeTitle: "Lektionsplanering", spot: spot("lektion", "b", null) }),
  "Lektionsplanering");
// Spot från ett annat läge än det utskickade säger inget om saken.
assert.equal(
  presentedLabel({
    presentedMode: "trafikljus", modeTitle: "Trafikljusur",
    spot: spot("karta", "m1", "m2", { presented: "Rymden" }),
  }),
  "Trafikljusur");

console.log("test-present: alla kontroller gick igenom ✓");
