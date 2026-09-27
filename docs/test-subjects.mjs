/**
 * TEST — Ämnespaletten (issue #77 + #81 + #85), js/lib/color.js + css/tokens.css.
 *
 *   node docs/test-subjects.mjs
 *
 * Kontrollerar:
 *   - alla SUBJECTS klarar WCAG AA (kontrast ≥ 4,5) mot sin framräknade textfärg
 *   - SUBJECTS och CSS-tokens (--subject-* i css/tokens.css) stämmer överens
 *     åt båda hållen (samma id:n, samma hexvärden)
 *   - färgfamiljerna följer skolans schema (Sv röd, So gul, Ma blå, No/Tk
 *     mörkgrön och samma färg, En lila, Idh rosa, Sl ljusgrön, Mentorstid grå)
 *   - SO-delämnena (re, hi, ge, sh) har EXAKT samma färg som SO och
 *     NO-delämnena (bi, ke, fy) samma som NO (issue #85) — i CSS genom att
 *     --subject-re m.fl. refererar till huvudämnets token (var(--subject-so))
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
const tokenRefs = {};
for (const m of css.matchAll(/--subject-([a-z]+):\s*(#[0-9a-fA-F]{3,6})/g)) {
  tokens[m[1]] = m[2].toLowerCase();
}
// Delämnen refererar till huvudämnets token: --subject-hi: var(--subject-so);
for (const m of css.matchAll(/--subject-([a-z]+):\s*var\(--subject-([a-z]+)\)/g)) {
  tokenRefs[m[1]] = m[2];
}
for (const [id, ref] of Object.entries(tokenRefs)) {
  ok(tokens[ref] !== undefined, `--subject-${id} refererar till --subject-${ref} som saknar hexvärde`);
  tokens[id] = tokens[ref];
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

// --- Delämnen (issue #81 + #85): rätt grupp, EXAKT huvudämnets färg ------
const SO_FAMILY = ["so", "re", "hi", "ge", "sh"];
const NO_FAMILY = ["no", "bi", "ke", "fy"];
const NAMES = {
  re: "Religionskunskap", hi: "Historia", ge: "Geografi", sh: "Samhällskunskap",
  bi: "Biologi", ke: "Kemi", fy: "Fysik",
};
for (const [id, name] of Object.entries(NAMES)) {
  ok(get(id)?.name === name, `ämnet ${id}/${name} ska finnas`);
}
for (const [main, fam] of [["so", SO_FAMILY], ["no", NO_FAMILY]]) {
  for (const id of fam) {
    ok(get(id)?.group === main, `${id} ska ha group "${main}"`);
    ok(get(id).color === get(main).color,
      `${id} (${get(id).color}) ska ha exakt samma färg som ${main} (${get(main).color})`);
    ok(deepTextColor(get(id).color) === deepTextColor(get(main).color),
      `${id} ska ha samma --subj-deep som ${main}`);
    ok(readableTextColor(get(id).color) === readableTextColor(get(main).color),
      `${id} ska ha samma textfärg som ${main}`);
    if (id !== main) {
      ok(tokenRefs[id] === main,
        `--subject-${id} ska referera till var(--subject-${main}) i tokens.css, inte kopiera hexkoden`);
      ok(get(id).name !== get(main).name, `${id} ska ha ett eget namn (skiljer sig från ${main})`);
    }
  }
}
ok(SUBJECTS.every((s) => !s.group || SO_FAMILY.includes(s.id) || NO_FAMILY.includes(s.id)),
  "bara SO- och NO-familjerna har group");
ok(SUBJECT_GROUPS.map((g) => g.id).join(",") === "so,no", "SUBJECT_GROUPS = so, no");

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
console.log("| Ämne | Färg | Textfärg | Kvot | AA | Etikett (--subj-deep) | Kvot mot vitt |");
console.log("|---|---|---|---|---|---|---|");
for (const s of SUBJECTS) {
  const text = readableTextColor(s.color);
  const ratio = contrastRatio(s.color, text);
  const deep = deepTextColor(s.color);
  const color = s.group && s.id !== s.group ? `${s.color} (= ${s.group.toUpperCase()})` : s.color;
  console.log(`| ${s.name} (${s.id}) | ${color} | ${text} | ${ratio.toFixed(2)} | ${ratio >= 4.5 ? "✅" : "❌"} | ${deep} | ${contrastRatio(deep, "#ffffff").toFixed(2)} |`);
}

console.log(`\n${passed} OK, ${failed} fel`);
if (failed > 0) process.exit(1);
