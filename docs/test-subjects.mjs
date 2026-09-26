/**
 * TEST — Ämnespaletten (issue #77 + #81), js/lib/color.js + css/tokens.css.
 *
 *   node docs/test-subjects.mjs
 *
 * Kontrollerar:
 *   - alla SUBJECTS klarar WCAG AA (kontrast ≥ 4,5) mot sin framräknade textfärg
 *   - SUBJECTS och CSS-tokens (--subject-* i css/tokens.css) stämmer överens
 *     åt båda hållen (samma id:n, samma hexvärden)
 *   - färgfamiljerna följer skolans schema (Sv röd, So gul, Ma blå, No/Tk
 *     mörkgrön och samma färg, En lila, Idh rosa, Sl ljusgrön, Mentorstid grå)
 *   - SO-delämnena (re, hi, ge, sh) ligger i den gula SO-familjen och
 *     NO-delämnena (bi, ke, fy) i den mörkgröna NO-familjen (issue #81),
 *     med nyanser som går att skilja åt sida vid sida
 *   - `group` binder delämnena till sina huvudämnen och groupedSubjects
 *     grupperar dem under rubriker
 *   - `rast` ligger sist (fallback i subjectStyle) och `mentor` finns
 */

import { readFile } from "node:fs/promises";

const { SUBJECTS, SUBJECT_GROUPS, groupedSubjects, contrastRatio, readableTextColor, subjectStyle, hexToRgb, deepTextColor } =
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

// --- Delämnen (issue #81): rätt familj, rätt grupp, lagom olika nyanser ----
const SO_FAMILY = ["so", "re", "hi", "ge", "sh"];
const NO_FAMILY = ["no", "bi", "ke", "fy"];
const NAMES = {
  re: "Religionskunskap", hi: "Historia", ge: "Geografi", sh: "Samhällskunskap",
  bi: "Biologi", ke: "Kemi", fy: "Fysik",
};
for (const [id, name] of Object.entries(NAMES)) {
  ok(get(id)?.name === name, `ämnet ${id}/${name} ska finnas`);
}
for (const id of SO_FAMILY) {
  ok(get(id)?.group === "so", `${id} ska ha group "so"`);
  const c = rgb(id);
  ok(c.r > c.b && c.g > c.b, `${id} ska ligga i den gula SO-familjen (R och G över B)`);
}
for (const id of NO_FAMILY) {
  ok(get(id)?.group === "no", `${id} ska ha group "no"`);
  const c = rgb(id);
  ok(c.g >= c.r && c.g > c.b, `${id} ska ligga i den gröna NO-familjen (G dominerar)`);
}
ok(SUBJECTS.every((s) => !s.group || SO_FAMILY.includes(s.id) || NO_FAMILY.includes(s.id)),
  "bara SO- och NO-familjerna har group");
ok(SUBJECT_GROUPS.map((g) => g.id).join(",") === "so,no", "SUBJECT_GROUPS = so, no");

// Nyanserna ska gå att skilja åt bredvid varandra i planeringslistan.
const dist = (a, b) => {
  const A = hexToRgb(get(a).color); const B = hexToRgb(get(b).color);
  return Math.hypot(A.r - B.r, A.g - B.g, A.b - B.b);
};
for (const fam of [SO_FAMILY, NO_FAMILY]) {
  for (let i = 0; i < fam.length; i++) for (let j = i + 1; j < fam.length; j++) {
    ok(dist(fam[i], fam[j]) >= 25,
      `${fam[i]} och ${fam[j]} ska gå att skilja åt (RGB-avstånd ${dist(fam[i], fam[j]).toFixed(0)} < 25)`);
  }
}

// groupedSubjects: delämnena samlas under sin rubrik, ordningen bevaras.
const groups = groupedSubjects(SUBJECTS);
const soGroup = groups.find((g) => g.group?.id === "so");
const noGroup = groups.find((g) => g.group?.id === "no");
ok(soGroup && soGroup.subjects.map((s) => s.id).join(",") === SO_FAMILY.join(","),
  "groupedSubjects ska samla SO-familjen i ordning");
ok(noGroup && noGroup.subjects.map((s) => s.id).join(",") === NO_FAMILY.join(","),
  "groupedSubjects ska samla NO-familjen i ordning");
ok(groups.flatMap((g) => g.subjects.map((s) => s.id)).join(",") === SUBJECTS.map((s) => s.id).join(","),
  "groupedSubjects ska bevara SUBJECTS ordning");

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
