/**
 * TEST — lektionstavlans skallogik (issue #134), js/lib/board-fit.js.
 *
 *   node docs/test-board-fit.mjs
 *
 * Kontrollerar med påhittade mätningar (ingen webbläsare):
 *   - searchScale: 1 när allt ryms, största skala som ryms annars, min som golv
 *   - fitMidColumn: ryms kolumnen står båda skalorna på 1
 *   - ryms den inte krymps bara Lektionsordning, och bara så mycket som behövs
 *   - reserv: ryms den inte ens med Lektionsordning på min krymps rutan också
 */

const { FIT_MIN, FIT_PRECISION, searchScale, fitMidColumn } = await import("../js/lib/board-fit.js");

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

console.log(`\n${passed} OK, ${failed} fel`);
if (failed > 0) process.exit(1);
