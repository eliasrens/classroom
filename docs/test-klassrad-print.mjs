/**
 * TEST — Klassråd, utskriften (issue #126, epic #124).
 *
 *   node docs/test-klassrad-print.mjs
 *
 * Rena funktioner (js/lib/klassrad-print.js), påhittade namn. Kontrollerar:
 *   - sidindelningen: en punkt delas aldrig om den ryms på ett ark; bara
 *     en punkt längre än ett ark bryts, mellan två rader, med rubriken kvar
 *     hos minst två rader och ingen ensam rad överst på nästa ark
 *   - varje rad kommer med exakt en gång, i ordning; inget ark flödar över
 *   - filnamnet/dokumenttiteln: "Klassråd 4B v.40 2026-10-01", aldrig elevnamn
 *   - innehållet: Anteckningar:/Det här skickar vi med:/…följa upp…,
 *     linjer för tomma punkter och i den tomma mallen, "Från förra
 *     klassrådet" bara under punkt 2
 */

const K = await import("../js/lib/klassrad.js");
const P = await import("../js/lib/klassrad-print.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}\n   fick     ${a}\n   väntade  ${e}`);
}

/**
 * Kontrollera en sidindelning mot reglerna. Svar: antal ark.
 *   - varje block finns med, i ordning, och varje rad exakt en gång
 *   - inget ark är högre än pageH (utom när ett ensamt block/en rad inte ryms alls)
 *   - ett block som ryms på ett ark ligger helt på ETT ark
 *   - ett brutet block: rubriken med minst min(MIN_LINES, rader) rader
 */
function check(blocks, pages, { pageH, gap = 0, contH = 0 }, label) {
  const seen = blocks.map(() => []);
  let lastBlock = -1;
  pages.forEach((page, pi) => {
    ok(page.length > 0, `${label}: ark ${pi + 1} är inte tomt`);
    let used = 0;
    page.forEach((part, k) => {
      const b = blocks[part.block];
      ok(part.block >= lastBlock, `${label}: blocken i ordning`);
      lastBlock = part.block;
      let h = (part.cont ? contH : b.head);
      for (let i = part.from; i < part.to; i++) { h += b.lines[i]; seen[part.block].push(i); }
      used += (k > 0 ? gap : 0) + h;
    });
    const single = page.length === 1;
    ok(used <= pageH + 0.001 || single, `${label}: ark ${pi + 1} flödar inte över (${used.toFixed(1)} > ${pageH})`);
  });
  blocks.forEach((b, i) => {
    eq(seen[i], b.lines.map((_, k) => k), `${label}: block ${i}s rader exakt en gång, i ordning`);
    const parts = pages.flat().filter((p) => p.block === i);
    const total = b.head + b.lines.reduce((s, x) => s + x, 0);
    if (total <= pageH) eq(parts.length, 1, `${label}: block ${i} (${total} ≤ ${pageH}) delas inte`);
    else {
      ok(parts[0].cont === false && parts.slice(1).every((p) => p.cont), `${label}: block ${i} — rubriken först, sedan fortsättningar`);
      ok(parts[0].to - parts[0].from >= Math.min(P.MIN_LINES, b.lines.length), `${label}: block ${i} — rubriken står med minst ${P.MIN_LINES} rader`);
      const last = parts.at(-1);
      if (parts.length > 1 && b.lines.length >= 2 * P.MIN_LINES) ok(last.to - last.from >= P.MIN_LINES, `${label}: block ${i} — ingen ensam rad på sista arket`);
    }
  });
  return pages.length;
}

// ---- Sidindelningen ----
{
  const opts = { pageH: 1000, gap: 20, contH: 30 };
  // Allt ryms på ett ark.
  const small = [{ head: 200, lines: [] }, { head: 100, lines: [25, 25] }, { head: 100, lines: [25] }];
  const p1 = P.printPages(small, opts);
  eq(check(small, p1, opts, "litet"), 1, "litet protokoll: ett ark");

  // Punkt 3 ryms inte i resten av ark 1 → hela punkten till ark 2 (delas inte).
  const push = [{ head: 200, lines: [] }, { head: 100, lines: Array(20).fill(25) }, { head: 100, lines: Array(10).fill(25) }];
  const p2 = P.printPages(push, opts);
  eq(check(push, p2, opts, "flytt"), 2, "punkt som inte ryms: två ark");
  eq(p2[1], [{ block: 2, from: 0, to: 10, cont: false }], "punkt 3 står hel överst på ark 2");

  // Exakt fullt: luften räknas bara mellan block, inte överst.
  const exact = [{ head: 480, lines: [] }, { head: 400, lines: [50, 50] }];
  eq(P.printPages(exact, opts).length, 1, "exakt fullt ark (480 + 20 + 500 = 1000) ryms");
  eq(P.printPages([...exact, { head: 1, lines: [] }], opts).map((p) => p.length), [2, 1], "en pixel till → nästa ark");
}
{
  // En punkt längre än ett ark bryts — rubriken stannar med texten.
  const opts = { pageH: 1000, gap: 20, contH: 30 };
  const long = [{ head: 200, lines: [] }, { head: 120, lines: Array(90).fill(25) }, { head: 100, lines: [] }];
  const pages = P.printPages(long, opts);
  const n = check(long, pages, opts, "lång");
  ok(n >= 3, `lång punkt (2370 px) → minst 3 ark (fick ${n})`);
  eq(pages[0].map((p) => p.block), [0, 1], "den långa punkten börjar på ark 1 under rubriken");
  ok(pages[1][0].cont && pages[1][0].block === 1, "ark 2 börjar med (forts.)");

  // Rubriken får aldrig stå ensam längst ned: ryms inte rubrik + 2 rader → nytt ark.
  const tight = [{ head: 880, lines: [] }, { head: 60, lines: Array(60).fill(25) }];
  const pt = P.printPages(tight, opts);
  check(tight, pt, opts, "trångt");
  eq(pt[0].map((p) => p.block), [0], "rubrik + 2 rader ryms inte (880+20+60+50) → punkten börjar på ark 2");

  // Ingen ensam rad på nästa ark: 1 rad över → en rad till flyttas med.
  const orphan = [{ head: 100, lines: Array(36).fill(25) }];
  const po = P.printPages(orphan, { pageH: 975, contH: 30 });
  check(orphan, po, { pageH: 975, contH: 30 }, "ensam");
  eq(po.map((p) => p.map((x) => [x.from, x.to])), [[[0, 34]], [[34, 36]]], "35 rader ryms, 36:e ensam → två rader till ark 2");

  // Tom mall: standardmallens 8 punkter med 5 linjer vardera, i mm-mått.
  const mm = P.MM_PX;
  const tpl = [{ head: 40 * mm, lines: [] }, ...Array(8).fill(0).map(() => ({ head: 18 * mm, lines: Array(P.TEMPLATE_RULES).fill(9 * mm) }))];
  const o = { pageH: P.SHEET_BODY_PX - 1, gap: 6 * mm, contH: 6 * mm };
  const pp = P.printPages(tpl, o);
  check(tpl, pp, o, "mall");
  ok(pp.flat().every((p) => !p.cont), "den tomma mallens punkter delas aldrig");
}

// Slumpade protokoll: reglerna håller alltid.
{
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let t = 0; t < 300; t++) {
    const pageH = 600 + Math.floor(rnd() * 600);
    const opts = { pageH, gap: Math.floor(rnd() * 30), contH: 20 + Math.floor(rnd() * 20) };
    const blocks = [{ head: 100 + Math.floor(rnd() * 150), lines: [] }];
    const n = 3 + Math.floor(rnd() * 8);
    for (let i = 0; i < n; i++) {
      const lines = Array(Math.floor(rnd() * (rnd() < 0.15 ? 120 : 12))).fill(0).map(() => 20 + Math.floor(rnd() * 3));
      blocks.push({ head: 40 + Math.floor(rnd() * 120), lines });
    }
    const before = failed;
    check(blocks, P.printPages(blocks, opts), opts, `slump ${t}`);
    if (failed > before) { console.error("  block:", JSON.stringify(blocks), JSON.stringify(opts)); break; }
  }
}

// ---- Filnamnet / dokumenttiteln ----
{
  eq(P.printTitle({ className: "4B", date: "2026-10-01" }), "Klassråd 4B v.40 2026-10-01", "protokollets filnamn: klass, vecka, datum");
  eq(P.printTitle({ className: "4B", date: "2027-01-04" }), "Klassråd 4B v.1 2027-01-04", "vecka 1 utan inledande nolla");
  eq(P.printTitle({ kind: "template", className: "4B" }), "Klassråd 4B tom mall", "den tomma mallens filnamn");
  eq(P.printTitle({ className: "4/B: fritids", date: "2026-10-01" }), "Klassråd 4-B- fritids v.40 2026-10-01", "tecken som inte får stå i ett filnamn byts");
  eq(P.printTitle({ className: "", date: "2026-10-01" }), "Klassråd v.40 2026-10-01", "utan klassnamn inga dubbla mellanslag");

  const m = K.newMeeting(K.defaultTemplate(), { date: "2026-10-01", secretary: "Cleo" });
  m.chair = "Bilal";
  m.points[0].notes = "Alva hälsade välkommen";
  const title = P.printTitle({ className: "4B", date: m.date });
  for (const name of ["Alva", "Bilal", "Cleo"]) ok(!title.includes(name), `filnamnet innehåller aldrig elevnamnet ${name}`);
}

// ---- Innehållet ----
{
  const t = K.defaultTemplate();
  const old = K.newMeeting(t, { date: "2026-09-17", now: 1 });
  old.chair = "Dante";
  old.points.find((p) => p.role === "followup").notes = "Prova tyst läsning\nFråga om utflykt";
  old.points.find((p) => p.role === "council").notes = "Fler bänkar";
  const m = K.newMeeting(t, { date: "2026-10-01", secretary: "Cleo", now: 2 });
  m.chair = "Bilal";
  m.points[0].notes = "Alva hälsade välkommen\n\n  Alla var här  ";
  const prev = K.previousFollowUp([old, m], m);
  m.followDone = [prev.groups[0].items[0].key];

  const pm = P.printModel({ kind: "protocol", meeting: m, prev });
  eq(pm.head, { date: "1 oktober 2026", week: 40, chair: "Bilal", secretary: "Cleo" }, "huvudet: datum, vecka, ordförande, sekreterare");
  eq(pm.points.map((p) => p.num), [1, 2, 3, 4, 5, 6, 7, null], "numren som i mallen");
  eq(pm.points[0].heading, "Anteckningar:", "Anteckningar: med kolon");
  eq(pm.points[6].heading, "Det här skickar vi med:", "punkt 7: Det här skickar vi med:");
  eq(pm.points[7].heading, "Det här behöver vi följa upp nästa gång:", "Till nästa klassråd: följa upp nästa gång");
  eq(pm.points[0].lines, ["Alva hälsade välkommen", "Alla var här"], "anteckningarna rad för rad, tomma rader bort");
  eq(pm.points[0].rules, 0, "ifylld punkt: inga tomma linjer");
  eq(pm.points[3].rules, P.EMPTY_RULES, "tom punkt: några linjer att skriva på");
  ok(pm.points[1].prev && pm.points.filter((p) => p.prev).length === 1, "Från förra klassrådet bara under punkt 2");
  eq(pm.points[1].prev.groups.map((g) => g.items.map((i) => [i.text, i.done])),
    [[["Prova tyst läsning", true], ["Fråga om utflykt", false]], [["Fler bänkar", false]]], "avbockade och ej avbockade rader");
  eq(pm.points[1].prev.date, "17 september 2026", "förra klassrådets datum");

  const first = P.printModel({ kind: "protocol", meeting: old, prev: K.previousFollowUp([old], old) });
  ok(first.points.every((p) => !p.prev), "första klassrådet: ingen ruta");
  const nothing = P.printModel({ kind: "protocol", meeting: m, prev: { from: { id: "x", date: "2026-09-01" }, groups: [] } });
  ok(nothing.points.every((p) => !p.prev), "inget att följa upp: ingen ruta");

  // Den tomma mallen: lärarens AKTUELLA mall, inga namn, linjer överallt.
  const mine = K.normalizeTemplate({ points: [
    { id: "a", title: "Hej och välkommen", prompts: ["Vem leder?"] },
    { id: "b", title: "Förra gången", role: "previous" },
    { id: "c", title: "Till elevrådet", notesLabel: "Det här skickar vi med:", role: "council" },
  ] });
  const tm = P.printModel({ kind: "template", template: mine, meeting: m, prev });
  eq(tm.head, { date: "", week: null, chair: "", secretary: "" }, "mallen: tomma fält (linjer)");
  eq(tm.points.map((p) => p.title), ["Hej och välkommen", "Förra gången", "Till elevrådet"], "mallen: lärarens aktuella punkter");
  ok(tm.points.every((p) => p.rules === P.TEMPLATE_RULES && p.lines.length === 0), `mallen: ${P.TEMPLATE_RULES} linjer per punkt, inga anteckningar`);
  ok(tm.points.every((p) => !p.prev), "mallen: ingen ruta från förra klassrådet");
  eq(tm.points[2].heading, "Det här skickar vi med:", "mallen: egen anteckningsrubrik");
  ok(!JSON.stringify(tm).match(/Alva|Bilal|Cleo|Dante/), "mallen innehåller inga elevnamn");
  ok(P.TEMPLATE_RULES >= 4 && P.TEMPLATE_RULES <= 5, "mallen: 4–5 linjer per punkt");

  eq(P.notesHeading("Beslut"), "Beslut:", "egen rubrik får kolon");
  eq(P.notesHeading("Vad hände?"), "Vad hände?", "rubrik med frågetecken lämnas");
}

// ---- Arkets mått ----
{
  const { width, height, top, side, bottom } = P.SHEET_MM;
  ok(width < 210 && height < 297, "arket strax under A4 (ingen tom extrasida)");
  ok(side >= 18 && side <= 20 && top >= 18 && top <= 20 && bottom >= 18 && bottom <= 20, "marginaler ca 18–20 mm i CSS");
  const css = (await import("node:fs")).readFileSync(new URL("../css/modes/klassrad.css", import.meta.url), "utf8");
  ok(css.includes(`width: ${width}mm;`) && css.includes(`height: ${height}mm;`), "CSS-arket har samma mått som SHEET_MM");
  ok(css.includes(`padding: ${top}mm ${side}mm ${bottom}mm;`), "CSS-arkets padding = SHEET_MM");
  ok(/@page klassrad \{ size: A4 portrait; margin: 0; \}/.test(css), "@page: A4 utan marginal");
  ok(/\.krp-point \{ break-inside: avoid; \}/.test(css), "punkterna: break-inside: avoid");
}

console.log(`${passed} ok, ${failed} fel`);
process.exit(failed ? 1 : 0);
