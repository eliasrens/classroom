/**
 * TEST — "Efter rasten" i lektionsplaneringen (issue #132),
 * js/lib/efter-rasten.js.
 *
 *   node docs/test-efter-rasten.mjs
 *
 * Kontrollerar:
 *   - radtolkning: punkter (- och •), vanlig text, blandat, tomma rader,
 *     HTML-escape
 *   - minuterna: standard 10, gränser 1–60, normalisering
 *   - timern före, under och efter starttiden; utan starttid och annan dag
 *     står den still med full tid
 *   - "+1 min" förlänger nedräkningen (även efter omladdning — tillägget är data)
 *   - urbockningen sker bara EN gång per nedräkning
 *   - ikryssning efter att tiden gått ut startar om nedräkningen
 *   - kopior får text och minuter men inget körtillstånd
 */

const R = await import("../js/lib/efter-rasten.js");
const { buildCopy } = await import("../js/lib/send-plan.js");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}

// --- radtolkning --------------------------------------------------------------
{
  ok(JSON.stringify(R.breakBlocks("- Läs\n- Rita")) === JSON.stringify([{ kind: "list", items: ["Läs", "Rita"] }]),
    "punktrader i följd hamnar i samma lista");
  ok(JSON.stringify(R.breakBlocks("• Läs\n•Rita")) === JSON.stringify([{ kind: "list", items: ["Läs", "Rita"] }]),
    "• fungerar som -, med eller utan mellanslag");
  ok(JSON.stringify(R.breakBlocks("Hämta boken\nSätt dig")) ===
    JSON.stringify([{ kind: "text", text: "Hämta boken" }, { kind: "text", text: "Sätt dig" }]),
  "vanliga rader blir text, en per rad");
  const mixed = R.breakBlocks("Välj mellan:\n- Läsa\n- Rita\nSen: vila");
  ok(mixed.length === 3 && mixed[0].kind === "text" && mixed[1].kind === "list" && mixed[1].items.length === 2 && mixed[2].text === "Sen: vila",
    "blandat: text, en lista med två punkter, text");
  const gaps = R.breakBlocks("\n  - A  \n\n- B\n   \n");
  ok(gaps.length === 2 && gaps.every((b) => b.kind === "list" && b.items.length === 1) && gaps[0].items[0] === "A",
    "tomma rader hoppas över (och avslutar en lista); rader trimmas");
  ok(R.breakBlocks("-\n- \n•").length === 0, "ett ensamt - blir ingenting");
  ok(R.breakBlocks("").length === 0 && R.breakBlocks(null).length === 0, "tom text → inga block");
  ok(R.breakBlocks("Svar: 5 - 3 = 2")[0].kind === "text", "bindestreck mitt i raden är ingen punkt");

  const html = R.breakBodyHTML("Välj mellan:\n- Läsa\n- Rita");
  ok(html === `<p class="lb-break__text">Välj mellan:</p><ul class="lb-list lb-break__list"><li>Läsa</li><li>Rita</li></ul>`,
    "HTML: <p> för text, EN <ul> för punkterna");
  const evil = R.breakBodyHTML(`<img src=x onerror="alert(1)">\n- <b>&</b>`);
  ok(!evil.includes("<img") && !evil.includes("<b>") && evil.includes("&lt;img") && evil.includes("&quot;") && evil.includes("&amp;"),
    "allt escapas (text och punkter)");
  ok(R.breakBodyHTML("  \n") === "", "tom text → tom HTML");
}

// --- minuterna -----------------------------------------------------------------
{
  ok(R.BREAK_MIN_DEFAULT === 10, "standard 10 minuter");
  ok(R.clampBreakMinutes(undefined) === 10 && R.clampBreakMinutes("") === 10 && R.clampBreakMinutes("abc") === 10,
    "saknat/ogiltigt → 10");
  ok(R.clampBreakMinutes(0) === 1 && R.clampBreakMinutes(-5) === 1 && R.clampBreakMinutes(61) === 60 && R.clampBreakMinutes("15") === 15,
    "gränser 1–60, sträng accepteras");
  ok(R.clampBreakMinutes(7.6) === 8, "avrundas till hela minuter");
  const n = R.normalizeBreakFields({});
  ok(n.efterRasten === "" && n.efterRastenMin === 10 && n.efterRastenPlusMin === 0 && n.efterRastenFrom === null,
    "normalisering: tom text, 10 min, inget tillägg, ingen omstart");
  ok(R.normalizeBreakFields({ efterRasten: ["a", "b"] }).efterRasten === "a\nb", "text som lista → rader");
}

// --- rubrikens ord (issue #139) -----------------------------------------------
{
  ok(R.normalizeBreakFields({}).efterRastenOrd === "rasten", "saknat ord → rasten");
  ok(R.normalizeBreakFields({ efterRastenOrd: "pausen" }).efterRastenOrd === "pausen", "pausen behålls");
  ok(R.normalizeBreakFields({ efterRastenOrd: "lunchen" }).efterRastenOrd === "rasten"
    && R.normalizeBreakFields({ efterRastenOrd: null }).efterRastenOrd === "rasten"
    && R.normalizeBreakFields({ efterRastenOrd: "PAUSEN" }).efterRastenOrd === "rasten", "okänt ord → rasten");
  ok(R.breakLabel({}) === "Efter rasten" && R.breakLabel(undefined) === "Efter rasten", "rubrik utan fält: Efter rasten");
  ok(R.breakLabel({ efterRastenOrd: "pausen" }) === "Efter pausen", "rubrik: Efter pausen");
  ok(R.breakLabel({ efterRastenOrd: "x" }) === "Efter rasten", "rubrik med okänt ord: Efter rasten");
  ok(R.resetBreakRun({ efterRastenOrd: "pausen", efterRastenPlusMin: 2 }).efterRastenOrd === "pausen", "kopians nollställning behåller ordet");
}

// --- timern --------------------------------------------------------------------
const at = (h, m, s = 0) => new Date(2026, 9, 27, h, m, s).getTime(); // tis 27 okt 2026
const PLAN = {
  id: "p1", date: "2026-10-27", start: "08:00", end: "09:00",
  fields: { efterRasten: "- Läs", efterRastenMin: 10 },
  show: { efterRasten: true },
};
{
  ok(R.lessonStartMs("2026-10-27", "08:00") === at(8, 0), "starttiden räknas i lokal tid");
  ok(R.lessonStartMs("2026-10-27", "") === null && R.lessonStartMs("", "08:00") === null && R.lessonStartMs("2026-10-27", "25:00") === null,
    "saknad/ogiltig starttid → null");

  const before = R.breakCountdown(PLAN, at(7, 55));
  ok(before.phase === "waiting" && before.remainingMs === 10 * 60_000 && before.text === "10:00",
    "före starttiden: full tid, står still");
  ok(R.breakCountdown(PLAN, at(7, 59, 30)).text === "10:00", "fortfarande full tid strax före start");
  ok(R.breakVisible(PLAN, at(7, 55)), "rutan syns före starttiden");

  const during = R.breakCountdown(PLAN, at(8, 3, 15));
  ok(during.phase === "running" && during.remainingMs === (6 * 60 + 45) * 1000 && during.text === "6:45",
    "under: räknar ned från starttiden");
  ok(R.breakCountdown(PLAN, at(8, 0)).text === "10:00", "exakt vid start: 10:00");
  ok(R.breakCountdown(PLAN, at(8, 9, 59) + 500).text === "0:01", "sista sekunden visas som 0:01 (avrundat uppåt)");

  const after = R.breakCountdown(PLAN, at(8, 10));
  ok(after.phase === "done" && after.remainingMs === 0 && after.text === "0:00", "efter: klar vid 0:00");
  ok(!R.breakVisible(PLAN, at(8, 10)) && !R.breakVisible(PLAN, at(12, 0)), "rutan döljs när tiden är ute");
  ok(after.endMs === at(8, 10), "sluttiden = start + minuter");

  const timer = R.breakTimer(PLAN, at(8, 1));
  ok(timer && timer.startedAt === at(8, 0) && timer.durationMs === 10 * 60_000 && timer.pausedAt === null,
    "timertillståndet är js/lib/timer.js-formatet");

  const noStart = { ...PLAN, start: "" };
  const idle = R.breakCountdown(noStart, at(8, 30));
  ok(idle.phase === "idle" && idle.text === "10:00" && R.breakVisible(noStart, at(8, 30)),
    "utan starttid: räknar inte, full tid, rutan syns");
  const otherDay = R.breakCountdown({ ...PLAN, date: "2026-10-26" }, at(8, 30));
  ok(otherDay.phase === "idle" && otherDay.text === "10:00", "annan dag (igår): räknar inte, full tid");
  ok(R.breakCountdown({ ...PLAN, date: "2026-10-28" }, at(8, 30)).phase === "idle", "annan dag (imorgon): räknar inte");
  ok(!R.breakVisible({ ...PLAN, show: { efterRasten: false } }, at(7, 0)), "urkryssad → syns inte");
}

// --- "+1 min" ---------------------------------------------------------------------
{
  const f1 = R.plusOneMinute(PLAN.fields);
  ok(f1.efterRastenPlusMin === 1 && f1.efterRastenMin === 10 && f1.efterRasten === "- Läs", "+1 min lägger till ett tillägg, rör inte resten");
  ok(PLAN.fields.efterRastenPlusMin === undefined, "+1 min ändrar inte originalet");
  const p1 = { ...PLAN, fields: f1 };
  ok(R.breakCountdown(p1, at(8, 5)).text === "6:00", "+1 min: 5:00 kvar blir 6:00");
  ok(R.breakCountdown(p1, at(8, 10)).phase === "running" && R.breakCountdown(p1, at(8, 11)).phase === "done",
    "+1 min flyttar sluttiden en minut");
  const p2 = { ...PLAN, fields: R.plusOneMinute(f1) };
  ok(R.breakCountdown(p2, at(8, 5)).text === "7:00", "två tryck = två minuter");
  ok(R.breakCountdown(p1, at(7, 0)).text === "11:00", "före start visar full tid inklusive tillägget");
  // Tillägget är data i planeringen → samma resultat efter omladdning / på elevskärmen.
  const reloaded = JSON.parse(JSON.stringify(p1));
  ok(R.breakCountdown(reloaded, at(8, 5)).text === "6:00", "tillägget överlever omladdning (JSON)");
}

// --- urbockningen: en gång --------------------------------------------------------
{
  const check = R.createAutoHide();
  ok(check(PLAN, at(8, 5)) === false, "inte under nedräkningen");
  ok(check(PLAN, at(7, 0)) === false, "inte före start");
  ok(check(PLAN, at(8, 10)) === true, "när tiden är ute → bocka ur");
  ok(check(PLAN, at(8, 10, 1)) === false && check(PLAN, at(8, 12)) === false,
    "bara en gång, även om svaret från datalagret dröjer");
  ok(check({ ...PLAN, show: { efterRasten: false } }, at(9, 0)) === false, "redan urbockad → ingenting");
  ok(check({ ...PLAN, start: "" }, at(23, 0)) === false, "utan starttid går tiden aldrig ut");
  ok(check({ ...PLAN, id: "p2" }, at(8, 10)) === true, "en annan planering bockas ur för sig");
  // Ikryssad igen efter att tiden gått ut → ny nedräkning → kan bockas ur igen.
  const again = { ...PLAN, fields: R.enableBreakFields(PLAN, at(9, 0)) };
  ok(again.fields.efterRastenFrom === at(9, 0), "ikryssning efter 0:00 startar om från nu");
  ok(R.breakCountdown(again, at(9, 0)).text === "10:00" && R.breakVisible(again, at(9, 4)), "… med full tid");
  ok(check(again, at(9, 5)) === false && check(again, at(9, 10)) === true && check(again, at(9, 11)) === false,
    "den nya nedräkningen bockas ur en gång");
  ok(check(PLAN, at(10, 0)) === false, "den gamla nedräkningen bockas inte ur en gång till");
}

// --- ikryssning ---------------------------------------------------------------------
{
  const f = R.enableBreakFields({ ...PLAN, fields: { ...PLAN.fields, efterRastenPlusMin: 3, efterRastenFrom: 5 } }, at(7, 0));
  ok(f.efterRastenPlusMin === 0 && f.efterRastenFrom === null, "ikryssning före start: tillägg och omstart nollas");
  ok(R.enableBreakFields({ ...PLAN, date: "2026-10-01" }, at(9, 0)).efterRastenFrom === null,
    "annan dag: ingen omstart (timern räknar inte ändå)");
}

// --- kopior ---------------------------------------------------------------------------
{
  const src = { ...PLAN, name: "Bråk", subjectId: "ma", fields: { ...PLAN.fields, efterRastenPlusMin: 2, efterRastenFrom: at(9, 0) } };
  const c = buildCopy(src, { date: "2026-11-03" }, "larare-x");
  ok(c.fields.efterRasten === "- Läs" && c.fields.efterRastenMin === 10, "Skicka kopia tar med text och minuter");
  ok(c.show.efterRasten === true, "Skicka kopia tar med kryssvalet");
  ok(c.fields.efterRastenPlusMin === 0 && c.fields.efterRastenFrom === null, "… men inte nedräkningens körtillstånd");
  ok(src.fields.efterRastenPlusMin === 2, "originalet är orört");
  const plain = R.resetBreakRun({ vad: "x" });
  ok(JSON.stringify(plain) === JSON.stringify({ vad: "x" }), "gamla planeringar utan fälten får inga nya nycklar");
}

console.log(`\n${passed} OK, ${failed} fel`);
if (failed > 0) process.exit(1);
