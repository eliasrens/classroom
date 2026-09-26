/**
 * TEST — "Byt lösenord": validering och felmeddelanden (issue #49).
 *
 *   node docs/test-password-change.mjs
 *
 * Rena funktioner — ingen DOM, inget nätverk. Kontrollerar:
 *   - nuvarande lösenord måste fyllas i
 *   - det nya är minst 8 tecken (räknat i tecken, inte UTF-16-enheter)
 *   - båda nya fälten stämmer överens
 *   - det nya är inte samma som det nuvarande
 *   - ordningen på kontrollerna (första felet vinner) och rätt fält pekas ut
 *   - Firebase-felkoderna blir begripliga meddelanden på svenska
 */

const P = await import("../js/lib/password-change.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}\n  fick:     ${JSON.stringify(a)}\n  förväntat: ${JSON.stringify(b)}`);
const v = (current, next, repeat = next) => P.validatePasswordChange({ current, next, repeat });

// ---- Validering ----

eq(P.MIN_PASSWORD_LENGTH, 8, "minsta längd är 8");
eq(v("gammalt1", "nyttlosen"), null, "giltigt byte godkänns");
eq(v("gammalt1", "12345678"), null, "exakt 8 tecken godkänns");
eq(v("", "nyttlosen"), { field: "current", message: P.MESSAGES.currentMissing }, "tomt nuvarande");
eq(v(undefined, "nyttlosen"), { field: "current", message: P.MESSAGES.currentMissing }, "saknat nuvarande");
eq(v("gammalt1", "1234567"), { field: "next", message: P.MESSAGES.tooShort }, "7 tecken är för kort");
eq(v("gammalt1", ""), { field: "next", message: P.MESSAGES.tooShort }, "tomt nytt är för kort");
eq(v("gammalt1", "🙂🙂🙂🙂"), { field: "next", message: P.MESSAGES.tooShort }, "4 emoji = 4 tecken (inte 8 UTF-16-enheter)");
eq(v("gammalt1", "åäöÅÄÖéü"), null, "8 svenska tecken godkänns");
eq(v("gammalt1", "nyttlosen", "nyttlosem"), { field: "repeat", message: P.MESSAGES.mismatch }, "olika nya fält");
eq(v("gammalt1", "nyttlosen", ""), { field: "repeat", message: P.MESSAGES.mismatch }, "tomt upprepa-fält");
eq(v("samma1234", "samma1234"), { field: "next", message: P.MESSAGES.sameAsCurrent }, "nytt = nuvarande nekas");
eq(v("Samma1234", "samma1234"), null, "skiftläge räknas — Samma1234 ≠ samma1234");
// Första felet vinner: kort går före olika och före samma.
eq(v("kort", "kort", "annat").field, "next", "för kort rapporteras före olika fält");
eq(v("", "kort").field, "current", "saknat nuvarande rapporteras först");
eq(v("abcdefgh", "abcdefgh", "abcdefgX").field, "repeat", "olika rapporteras före samma-som-nuvarande");

// Meddelandena är på svenska och nämner gränsen.
ok(P.MESSAGES.tooShort.includes("8 tecken"), "för kort-meddelandet nämner 8 tecken");
ok(P.MESSAGES.done === "Lösenordet är bytt.", "bekräftelsen");

// ---- Firebase-felkoder ----

const m = (code) => P.changePasswordErrorMessage({ code });
eq(m("auth/wrong-password"), { field: "current", message: P.MESSAGES.wrongCurrent }, "wrong-password");
eq(m("auth/invalid-credential"), { field: "current", message: P.MESSAGES.wrongCurrent }, "invalid-credential");
eq(m("auth/invalid-login-credentials"), { field: "current", message: P.MESSAGES.wrongCurrent }, "invalid-login-credentials");
eq(m("auth/weak-password"), { field: "next", message: P.MESSAGES.weak }, "weak-password");
eq(m("auth/network-request-failed"), { message: P.MESSAGES.network }, "network-request-failed");
eq(m("auth/too-many-requests"), { message: P.MESSAGES.tooMany }, "too-many-requests");
eq(m("auth/requires-recent-login"), { message: P.MESSAGES.recentLogin }, "requires-recent-login");
eq(m("auth/något-annat"), { message: P.MESSAGES.failed }, "okänt fel → allmänt meddelande");
eq(P.changePasswordErrorMessage(new Error("x")), { message: P.MESSAGES.failed }, "fel utan kod");
eq(P.changePasswordErrorMessage(null), { message: P.MESSAGES.failed }, "null-fel");

console.log(`${passed} godkända, ${failed} fel`);
if (failed) process.exit(1);
