/**
 * TEST — Ämnespaletten (issue #77), js/lib/color.js + css/tokens.css.
 *
 *   node docs/test-subjects.mjs
 *
 * Kontrollerar:
 *   - alla SUBJECTS klarar WCAG AA (kontrast ≥ 4,5) mot sin framräknade textfärg
 *   - SUBJECTS och CSS-tokens (--subject-* i css/tokens.css) stämmer överens
 *     åt båda hållen (samma id:n, samma hexvärden)
 *   - färgfamiljerna följer skolans schema (Sv röd, So gul, Ma blå, No/Tk
 *     mörkgrön och samma färg, En lila, Idh rosa, Sl ljusgrön, Mentorstid grå)
 *   - `rast` ligger sist (fallback i subjectStyle) och `mentor` finns
 */

import { readFile } from "node:fs/promises";

const { SUBJECTS, contrastRatio, readableTextColor, subjectStyle, hexToRgb, deepTextColor } =
  await import("../js/lib/color.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}

// --- WCAG AA mot framräknad textfärg -------------------------------------
for (const s of SUBJECTS) {
  const text = readableTextColor(s.color);
  const ratio = contrastRatio(s.color, text);
  ok(ratio >= 4.5, `${s.id} (${s.color}) mot text ${text}: kontrast ${ratio.toFixed(2)} < 4,5`);
}

// --- Etikettvarianten (--subj-deep, tavlans fältetiketter på vitt papper) --
for (const s of SUBJECTS) {
  const deep = deepTextColor(s.color);
  const ratio = contrastRatio(deep, "#ffffff");
  ok(ratio >= 4.5, `deepTextColor(${s.id}) = ${deep} mot vitt: kontrast ${ratio.toFixed(2)} < 4,5`);
}

// --- SUBJECTS ↔ CSS-tokens i synk -----------------------------------------
const css = await readFile(new URL("../css/tokens.css", import.meta.url), "utf8");
const tokens = {};
for (const m of css.matchAll(/--subject-([a-z]+):\s*(#[0-9a-fA-F]{3,6})/g)) {
  tokens[m[1]] = m[2].toLowerCase();
}
for (const s of SUBJECTS) {
  ok(tokens[s.id] !== undefined, `token --subject-${s.id} saknas i tokens.css`);
  ok(tokens[s.id] === s.color.toLowerCase(),
    `--subject-${s.id} (${tokens[s.id]}) ≠ SUBJECTS ${s.id} (${s.color})`);
}
for (const id of Object.keys(tokens)) {
  ok(SUBJECTS.some((s) => s.id === id), `token --subject-${id} saknar motsvarighet i SUBJECTS`);
}

// --- Färgfamiljer enligt skolans schema ------------------------------------
const rgb = (id) => hexToRgb(SUBJECTS.find((s) => s.id === id).color);
const get = (id) => SUBJECTS.find((s) => s.id === id);

const sv = rgb("sv");
ok(sv.r > sv.g * 1.8 && sv.r > sv.b * 1.8, "sv ska vara röd (R dominerar)");
const so = rgb("so");
ok(so.r > 150 && so.g > 130 && so.b < so.g * 0.6, "so ska vara gul (R+G höga, B låg)");
const ma = rgb("ma");
ok(ma.b > ma.r && ma.b > ma.g, "ma ska vara blå (B dominerar)");
const no = rgb("no");
ok(no.g > no.r && no.g > no.b && no.g < 140, "no ska vara mörkgrön");
ok(get("tk").color === get("no").color, "tk ska ha samma färg som no (No/Tk delar block i schemat)");
const en = rgb("en");
ok(en.b > en.g && en.r > en.g, "en ska vara lila (R och B över G)");
const idh = rgb("idh");
ok(idh.r > 200 && idh.r > idh.g && idh.g > idh.b, "idh ska vara laxrosa");
const sl = rgb("sl");
ok(sl.g > sl.r && sl.g > sl.b && sl.g > 160, "sl ska vara ljusgrön");
const mentor = rgb("mentor");
ok(Math.abs(mentor.r - mentor.g) < 20 && Math.abs(mentor.g - mentor.b) < 20,
  "mentor ska vara grå (R≈G≈B)");

// --- Struktur ---------------------------------------------------------------
ok(SUBJECTS.at(-1).id === "rast", "rast ska ligga sist (fallback i subjectStyle)");
ok(get("mentor")?.name === "Mentorstid", "ämnet mentor/Mentorstid ska finnas");
ok(new Set(SUBJECTS.map((s) => s.id)).size === SUBJECTS.length, "inga dubblerade id:n");
ok(subjectStyle("okänt-id").id === "rast", "okänt ämne ska falla tillbaka på rast");
ok(typeof subjectStyle("ma").textColor === "string", "subjectStyle ger textColor");

// --- Kontrasttabell (för rapporten) -----------------------------------------
console.log("\nKontrasttabell (WCAG AA kräver ≥ 4,5):");
console.log("| Ämne | Färg | Textfärg | Kvot | AA |");
console.log("|---|---|---|---|---|");
for (const s of SUBJECTS) {
  const text = readableTextColor(s.color);
  const ratio = contrastRatio(s.color, text);
  console.log(`| ${s.name} (${s.id}) | ${s.color} | ${text} | ${ratio.toFixed(2)} | ${ratio >= 4.5 ? "✅" : "❌"} |`);
}

console.log(`\n${passed} OK, ${failed} fel`);
if (failed > 0) process.exit(1);
