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
 *     golvet) innan rutans text krymps; sidokolumnernas skala rörs aldrig
 */

const { FIT_MIN, FIT_PRECISION, searchScale, fitMidColumn, fitBreakColumn } = await import("../js/lib/board-fit.js");

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
// Mittenraden är 1000 px. Sidokolumnerna ryms om de får minst `sides` px;
// rutan ryms om dess bredd (natural px vid skala 1) får plats i kolumnen.
function breakCol({ sides, box, row = 1000 }) {
  const st = { width: null, brk: 1 };
  return {
    st,
    sidesFit: () => row - st.width >= sides,
    setWidth: (v) => { st.width = v; },
    fits: () => box * st.brk <= st.width,
    setBreak: (v) => { st.brk = v; },
  };
}
{
  const c = breakCol({ sides: 600, box: 250 });
  const r = fitBreakColumn({ want: 300, floor: 160, ...c });
  ok(r.width === 300 && c.st.width === 300, "sidorna ryms → kolumnen får sin önskade bredd");
  ok(r.brk === 1 && c.st.brk === 1, "… och rutans text krymps inte");
}
{
  const c = breakCol({ sides: 760, box: 280 });
  const r = fitBreakColumn({ want: 300, floor: 160, ...c });
  ok(r.width <= 240 && r.width > 240 - 300 * FIT_PRECISION, `sidorna ryms inte → kolumnen ger upp bredd, så lite som möjligt (fick ${r.width})`);
  ok(c.st.width === r.width && c.sidesFit(), "bredden är satt och sidorna ryms");
  const need = r.width / 280;
  ok(r.brk <= need && r.brk > need - FIT_PRECISION && c.fits(), `rutan krymps bara så mycket som behövs (fick ${r.brk})`);
}
{
  const c = breakCol({ sides: 950, box: 200 });
  const r = fitBreakColumn({ want: 300, floor: 160, ...c });
  ok(r.width === 160 && c.st.width === 160, "kolumnen går aldrig under golvet");
  ok(c.fits(), "rutan ryms på golvbredd tack vare sin egen skala");
}
{
  const c = breakCol({ sides: 600, box: 1000 });
  const r = fitBreakColumn({ want: 300, floor: 160, ...c });
  ok(r.brk === FIT_MIN, "ryms inte ens på golvskalan → FIT_MIN (klipps)");
}
{
  // Önskad bredd under golvet (rubrikraden är kort) — ingen sökning nedåt.
  const c = breakCol({ sides: 950, box: 100 });
  const r = fitBreakColumn({ want: 120, floor: 160, ...c });
  ok(r.width === 120 && r.brk === 1, "want < floor → want gäller som den är");
}

console.log(`\n${passed} OK, ${failed} fel`);
if (failed > 0) process.exit(1);
