/**
 * TEST — lektionstavlans skallogik (issue #134, #136), js/lib/board-fit.js.
 *
 *   node docs/test-board-fit.mjs
 *
 * Kontrollerar med påhittade mätningar (ingen webbläsare):
 *   - searchScale: 1 när allt ryms, största skala som ryms annars, min som golv
 *   - fitMidColumn: ryms kolumnen står båda skalorna på 1
 *   - ryms den inte krymps bara Lektionsordning, och bara så mycket som behövs
 *   - reserv: ryms den inte ens med Lektionsordning på min krymps rutan också
 *   - fitBreakColumn (#136): rutans smala kolumn ger upp bredd (ner till
 *     golvet); räcker inte golvet sänks tavlans skala bara så mycket som
 *     behövs (sidokolumnerna klipps aldrig); rutans text krymps med egen skala
 *   - fitMidColumn (#136): kolumn som redan ryms ger steps = 1; horisontellt
 *     överflöd i rutan krymper inte Lektionsordning
 *   - ingen bottenrad (#138): sista steget får sluta vid tavlans ram; få steg
 *     krymps inte, många steg bara så att sista steget slutar vid ramen
 */

const { FIT_MIN, FIT_PRECISION, searchScale, fitMidColumn, fitBreakColumn, stepsWithin } = await import("../js/lib/board-fit.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}

// --- searchScale ---------------------------------------------------------------
{
  let s = null;
  const r = searchScale(1, () => true, (v) => { s = v; });
  ok(r === 1 && s === 1, "allt ryms → 1");
}
{
  let s = null;
  const r = searchScale(1, () => s <= 0.7, (v) => { s = v; });
  ok(r <= 0.7 && r > 0.7 - FIT_PRECISION, `största skala som ryms (fick ${r})`);
  ok(s === r, "den returnerade skalan är satt");
}
{
  let s = null;
  const r = searchScale(1, () => false, (v) => { s = v; });
  ok(r === FIT_MIN && s === FIT_MIN, "inget ryms → golvet FIT_MIN");
}
{
  let s = null;
  const r = searchScale(0.8, () => s <= 0.9, (v) => { s = v; });
  ok(r === 0.8, "startar från hi (Bra jobbat-sökningen fortsätter från tavlans skala)");
}

// --- fitMidColumn -------------------------------------------------------------
// Kolumnens "höjd" = rutan + stegen; ryms om ≤ plats.
function column({ box, steps, room }) {
  const st = { steps: 1, brk: 1, sets: [] };
  return {
    st,
    fits: () => box * st.brk + steps * st.steps <= room,
    setSteps: (v) => { st.steps = v; st.sets.push(["steps", v]); },
    setBreak: (v) => { st.brk = v; st.sets.push(["brk", v]); },
  };
}

{
  const c = column({ box: 30, steps: 60, room: 100 });
  const r = fitMidColumn(c);
  ok(r.steps === 1 && r.brk === 1, "ryms redan → båda 1 (inget krymps i onödan)");
  ok(c.st.steps === 1 && c.st.brk === 1, "… och båda är satta till 1");
}
{
  const c = column({ box: 30, steps: 100, room: 100 });
  const r = fitMidColumn(c);
  ok(r.brk === 1 && c.st.brk === 1, "ryms inte → rutan behåller sin storlek");
  ok(r.steps < 1 && r.steps <= 0.7 && r.steps > 0.7 - FIT_PRECISION, `bara Lektionsordning krymps, så lite som möjligt (fick ${r.steps})`);
  ok(c.st.steps === r.steps, "Lektionsordnings skala är satt");
  ok(c.fits(), "kolumnen ryms efteråt");
}
{
  const c = column({ box: 80, steps: 100, room: 100 });
  const r = fitMidColumn(c);
  ok(r.steps === FIT_MIN, "reserv: Lektionsordning på golvet");
  ok(r.brk < 1 && c.st.brk === r.brk, `reserv: rutan krymps också (fick ${r.brk})`);
  ok(c.fits(), "reserv: kolumnen ryms efteråt");
}
{
  // Lektionsordning ryms precis på golvet → rutan rörs inte.
  const c = column({ box: 55, steps: 100, room: 55 + 100 * FIT_MIN });
  const r = fitMidColumn(c);
  ok(r.steps === FIT_MIN && r.brk === 1, "ryms precis på golvet → rutan behåller sin storlek");
}
{
  // Utan Lektionsordning (bara rutan): stegens setter gör inget.
  const st = { brk: 1 };
  const r = fitMidColumn({
    fits: () => 120 * st.brk <= 100,
    setSteps: () => {},
    setBreak: (v) => { st.brk = v; },
  });
  ok(r.brk < 1 && 120 * r.brk <= 100, "bara rutan i kolumnen → rutan krymps i reserv");
}

{
  // Issue #136: ryms kolumnen på höjden står Lektionsordning på 1, även med rutan.
  const c = column({ box: 45, steps: 55, room: 100 });
  const r = fitMidColumn({ ...c, breakFits: () => true });
  ok(r.steps === 1 && r.brk === 1 && c.st.sets.every(([, v]) => v === 1), "#136: kolumn som redan ryms → steps = 1, inget sätts under 1");
}
{
  // Rutan för bred (t.ex. timern) men kolumnen ryms på höjden → bara rutan krymps.
  const c = column({ box: 30, steps: 60, room: 100 });
  const r = fitMidColumn({ ...c, breakFits: () => c.st.brk <= 0.8 });
  ok(r.steps === 1, "#136: horisontellt överflöd i rutan krymper inte Lektionsordning");
  ok(r.brk <= 0.8 && r.brk > 0.8 - FIT_PRECISION, `#136: … rutan krymps precis så mycket som behövs (fick ${r.brk})`);
}
{
  // Reserv: plats som rutans krympning frigör går tillbaka till Lektionsordning.
  const c = column({ box: 80, steps: 100, room: 100 });
  const r = fitMidColumn(c);
  const room = 100 - 80 * r.brk;
  ok(r.steps > FIT_MIN || room - 100 * FIT_MIN < 100 * FIT_PRECISION, `#136: stegen fyller platsen efter rutans krympning (steps ${r.steps}, brk ${r.brk})`);
  ok(c.fits() && 80 * r.brk + 100 * (r.steps + FIT_PRECISION) > 100, "#136: … och slutar vid nederkanten (inget stort tomrum)");
}

// --- fitBreakColumn (issue #136) ----------------------------------------------
// Mittenraden är 1000 px. Sidokolumnerna behöver `sides` px vid tavlans
// skala 1 (proportionellt mot skalan); rutan ryms om dess bredd (natural px
// vid skala 1) får plats i kolumnen.
function breakCol({ sides, box, row = 1000, scale = 1 }) {
  const st = { width: null, brk: 1, scale, scaleSets: 0 };
  return {
    st,
    scale,
    sidesFit: () => row - st.width >= sides * st.scale,
    setWidth: (v) => { st.width = v; },
    setScale: (v) => { st.scale = v; st.scaleSets++; },
    fits: () => box * st.brk <= st.width,
    setBreak: (v) => { st.brk = v; },
  };
}
{
  const c = breakCol({ sides: 600, box: 250 });
  const r = fitBreakColumn({ want: 300, floor: 160, ...c });
  ok(r.width === 300 && c.st.width === 300, "sidorna ryms → kolumnen får sin önskade bredd");
  ok(r.brk === 1 && c.st.brk === 1, "… och rutans text krymps inte");
  ok(r.scale === 1 && c.st.scaleSets === 0, "… och tavlans skala rörs inte");
}
{
  const c = breakCol({ sides: 760, box: 280 });
  const r = fitBreakColumn({ want: 300, floor: 160, ...c });
  ok(r.width <= 240 && r.width > 240 - 300 * FIT_PRECISION, `sidorna ryms inte → kolumnen ger upp bredd, så lite som möjligt (fick ${r.width})`);
  ok(c.st.width === r.width && c.sidesFit(), "bredden är satt och sidorna ryms");
  ok(r.scale === 1 && c.st.scaleSets === 0, "… utan att tavlans skala rörs");
  const need = r.width / 280;
  ok(r.brk <= need && r.brk > need - FIT_PRECISION && c.fits(), `rutan krymps bara så mycket som behövs (fick ${r.brk})`);
}
{
  // Tavlan står redan på sin största skala som ryms (0.8): med kolumnen på
  // golvet ryms sidorna bara vid 0.8 · 840/950 ≈ 0.707.
  const c = breakCol({ sides: 950 / 0.8, box: 200, scale: 0.8 });
  const r = fitBreakColumn({ want: 300, floor: 160, ...c });
  const need = 840 / (950 / 0.8);
  ok(r.width === 160 && c.st.width === 160, "kolumnen går aldrig under golvet");
  ok(c.sidesFit(), "sidokolumnerna klipps aldrig — tavlans skala sänks i stället");
  ok(r.scale <= need && r.scale > need - FIT_PRECISION && c.st.scale === r.scale, `… bara så mycket som behövs (fick ${r.scale}, behövs ${need.toFixed(3)})`);
  ok(c.fits(), "rutan ryms på golvbredd tack vare sin egen skala");
}
{
  const c = breakCol({ sides: 600, box: 1000 });
  const r = fitBreakColumn({ want: 300, floor: 160, ...c });
  ok(r.brk === FIT_MIN, "ryms inte ens på golvskalan → FIT_MIN (klipps)");
}
{
  // Önskad bredd lika med golvet (rubrikraden är kort) — ingen sökning nedåt.
  const c = breakCol({ sides: 800, box: 100 });
  const r = fitBreakColumn({ want: 160, floor: 160, ...c });
  ok(r.width === 160 && r.brk === 1 && r.scale === 1, "want = floor → bredden står kvar");
}

// --- Ingen bottenrad (issue #138) -----------------------------------------------
// Utan "Du behöver"/"Mål" går mittenkolumnen ända ner till tavlans ram
// (inre nederkant 1057 px, uppmätt på elevskärmen 1920×1080). Gränsen är
// sista stegets underkant mot ramen — fältets luft under steget räknas inte.
{
  ok(stepsWithin(1057, 1057) && stepsWithin(1057.6, 1057), "steget som slutar vid ramen ryms (avrundning)");
  ok(!stepsWithin(1060, 1057), "steget som går förbi ramen ryms inte");
}
// Kolumn utan bottenrad: rutan tar 520 px från kolumnens topp (187), Lektionsordning
// (rubrik + steg) är `steps` px hög vid skala 1 och har 24 px luft under sig.
function noBottomRow({ steps, frame = 1057, top = 187, box = 520, pad = 24 }) {
  const st = { steps: 1, brk: 1 };
  const lastStep = () => top + box * st.brk + steps * st.steps;
  return {
    st, lastStep, pad,
    fits: () => stepsWithin(lastStep(), frame),
    setSteps: (v) => { st.steps = v; },
    setBreak: (v) => { st.brk = v; },
  };
}
{
  // Sista steget slutar exakt vid ramen: ryms — även om fältets luft under
  // steget (24 px) inte gör det.
  const c = noBottomRow({ steps: 1057 - 187 - 520 });
  const r = fitMidColumn(c);
  ok(r.steps === 1 && r.brk === 1, "få steg, ingen bottenrad: Lektionsordning krymps inte");
  ok(c.lastStep() + c.pad > 1057, "… fast fältets luft under steget skulle ha gått förbi ramen");
}
{
  // Många steg: krymps bara så att sista steget slutar vid ramen.
  const c = noBottomRow({ steps: 600 });
  const r = fitMidColumn(c);
  const need = (1057 - 187 - 520) / 600;
  ok(r.brk === 1, "många steg: rutan rörs inte");
  ok(r.steps <= need + 1 / 600 && r.steps > need - FIT_PRECISION, `… stegen krymps bara så mycket som behövs (fick ${r.steps}, behövs ${need.toFixed(3)})`);
  ok(1057 - c.lastStep() < 600 * FIT_PRECISION + 1, "… sista steget slutar vid ramen");
}

// --- Glyfer som sticker ut ur raden (issue #144) ------------------------------
// På Windows (Segoe UI) är glyfernas innehållsyta 1.33 em mot line-height
// 1.2–1.28, så scrollHeight − clientHeight är några px i VARJE skala, fast
// inget block når förbi kolumnens nederkant. Kontrollen i fitBoard är därför
// geometrisk (contentBottom mot innerBottom via stepsWithin), inte
// scrollHeight-baserad. Här modellerat: `glyph` px konstant inre överflöd.
function glyphColumn({ box, steps, room, glyph }) {
  const st = { steps: 1, brk: 1 };
  const bottom = () => box * st.brk + steps * st.steps;
  return {
    st, bottom,
    // Den gamla kontrollen: scrollHeight > clientHeight + 1 — glyferna räknas med.
    scrollFits: () => Math.max(0, bottom() - room) + glyph <= 1,
    // Den nya: sista blockets underkant mot rutans inre nederkant.
    fits: () => stepsWithin(bottom(), room),
    setSteps: (v) => { st.steps = v; },
    setBreak: (v) => { st.brk = v; },
  };
}
{
  const c = glyphColumn({ box: 30, steps: 50, room: 100, glyph: 3 });
  const old = fitMidColumn({ fits: c.scrollFits, setSteps: c.setSteps, setBreak: c.setBreak });
  ok(old.steps === FIT_MIN && old.brk === FIT_MIN, `#144: scrollHeight-kontrollen med 3 px glyföverflöd trycker ner båda till golvet (fick ${old.steps}/${old.brk}) — det var felet`);
  const r = fitMidColumn(c);
  ok(r.steps === 1 && r.brk === 1, `#144: geometriskt ryms kolumnen → båda 1 trots glyföverflödet (fick ${r.steps}/${r.brk})`);
}
{
  // Glyföverflödet ändrar inte heller hur mycket som krymps när det är trångt.
  const c = glyphColumn({ box: 30, steps: 100, room: 100, glyph: 3 });
  const r = fitMidColumn(c);
  // 1 px tolerans i stepsWithin → sista steget får sluta högst vid 101.
  ok(r.brk === 1 && r.steps <= 0.71 && r.steps > 0.7 - FIT_PRECISION, `#144: för många steg → bara Lektionsordning, precis så mycket som behövs (fick ${r.steps})`);
  ok(c.fits() && c.bottom() > 100 - 100 * FIT_PRECISION, "#144: … sista steget slutar vid nederkanten");
}
{
  // Avrundning: ett block som slutar högst 1 px förbi nederkanten ryms (subpixel, zoom 110 %).
  ok(stepsWithin(672.9, 672.5) && !stepsWithin(674, 672.5), "#144: 1 px tolerans för subpixel, inte mer");
}

console.log(`\n${passed} OK, ${failed} fel`);
if (failed > 0) process.exit(1);
