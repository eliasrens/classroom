/**
 * TEST — Lektionsordning i stunden: bocka av steg + timer på pågående steg
 * (issue #146), js/lib/lektionsordning.js och tavlans HTML (boardHTML i
 * js/modes/lektion.js).
 *
 *   node docs/test-lektionsordning.mjs
 *
 * Kontrollerar:
 *   - stegning: null → 1 → … → sista, står still där; Föregående tillbaka
 *     till null; varje byte tar bort timern
 *   - ogiltigt index (steg borttagna) → null
 *   - timern: före start, under nedräkningen, vid 0 → "Klart"; +1 min under
 *     nedräkningen och efter Klart; step !== ordningAktiv → ingen timer
 *   - minutfältet: 0, 91, tomt, text, decimaltal ger fel; 1 och 90 går igenom
 *   - nollställning: annan dag, efter sluttiden, utan sluttid nästa dag;
 *     skrivs en gång och aldrig från elevvyn
 *   - oförändrad tavla: utan markering exakt samma HTML som före #146
 *   - HTML-säkerhet: stegtext med <b> escapas i alla tre tillstånden
 *   - kopiering: Kopiera och Skicka kopia får inte med läget
 */

// ---- Attrapper för webbläsar-API:er som lektion.js rör vid import ----
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
  clear: () => mem.clear(),
};
globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const L = await import("../js/lib/lektionsordning.js");
const { boardHTML, breakBoxHTML, normalizePlan } = await import("../js/modes/lektion.js");
const { SUBJECTS } = await import("../js/lib/color.js");
const { buildCopy } = await import("../js/lib/send-plan.js");
const { resetBreakRun } = await import("../js/lib/efter-rasten.js");
const { readFileSync } = await import("node:fs");

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}

const at = (h, m, s = 0, day = 27) => new Date(2026, 9, day, h, m, s).getTime(); // tis 27 okt 2026
const STEPS = ["Genomgång/Samling", "Mini-whiteboards", "Mattebok s.44-45", "Avslut"];
const PLAN = {
  id: "p1", name: "Matte", date: "2026-10-27", subjectId: "ma", start: "08:00", end: "09:20",
  fields: { attGora: STEPS },
  show: { attGora: true },
};
/** Planeringen med de ändrade fälten (som datalagret sparar dem). */
const withF = (plan, fields) => ({ ...plan, fields });

// --- stegning ------------------------------------------------------------------
{
  const now = at(8, 12);
  ok(L.ordningState(PLAN, now).active === null, "utan läge: inget steg markerat");
  let p = PLAN;
  const seen = [];
  for (let i = 0; i < STEPS.length; i++) {
    const f = L.stepNext(p, now);
    ok(f && f.ordningTimer === null && f.ordningDatum === "2026-10-27", `Nästa steg ${i + 1}: datum satt, ingen timer`);
    p = withF(p, f);
    seen.push(L.ordningState(p, now).active);
  }
  ok(seen.join(",") === "0,1,2,3", `null → 1 → 2 → 3 → 4 (fick ${seen.join(",")})`);
  ok(L.stepNext(p, now) === null, "från sista steget: ingen effekt");
  ok(L.ordningState(p, now).active === 3, "… står still på sista steget");
  for (let i = 3; i > 0; i--) p = withF(p, L.stepPrev(p, now));
  ok(L.ordningState(p, now).active === 0, "Föregående tillbaka till steg 1");
  p = withF(p, L.stepPrev(p, now));
  ok(L.ordningState(p, now).active === null && p.fields.ordningAktiv === null && p.fields.ordningTimer === null,
    "Föregående från steg 1 → null (dagens utseende)");
  ok(L.stepPrev(p, now) === null, "Föregående utan pågående steg: ingen effekt");

  // Varje byte tar bort timern.
  let q = withF(PLAN, L.stepNext(PLAN, now));
  q = withF(q, L.stepStartTimer(q, 10, now));
  ok(L.ordningState(q, now).timer?.durationMs === 600_000, "timer på steg 1");
  ok(L.stepNext(q, now).ordningTimer === null && L.stepPrev(q, now).ordningTimer === null, "Nästa/Föregående tar bort timern");
  ok(L.stepNext(PLAN, now).attGora === STEPS, "stegningen rör inte stegen");
  ok(L.stepNext(withF(PLAN, { attGora: [] }), now) === null, "utan steg: Nästa gör ingenting");
  // Tomma rader räknas inte (index = stegen som visas på tavlan).
  const gaps = withF(PLAN, { attGora: ["A", "  ", "", "B"] });
  ok(L.ordningSteps(gaps.fields).join("|") === "A|B", "tomma rader är inga steg");
  const g2 = withF(gaps, L.stepNext(withF(gaps, L.stepNext(gaps, now)), now));
  ok(L.ordningState(g2, now).active === 1 && L.stepNext(g2, now) === null, "index räknas bland stegen som visas");
}

// --- ogiltigt index ------------------------------------------------------------
{
  const now = at(8, 30);
  const p = withF(PLAN, { attGora: STEPS, ordningAktiv: 3, ordningDatum: "2026-10-27", ordningTimer: null });
  ok(L.ordningState(p, now).active === 3, "steg 4 pågår");
  const fewer = withF(p, { ...p.fields, attGora: STEPS.slice(0, 2) });
  ok(L.ordningState(fewer, now).active === null && L.ordningView(fewer, now) === null, "steg borttagna → index utanför listan → null");
  ok(L.ordningState(withF(PLAN, { attGora: STEPS, ordningAktiv: -1, ordningDatum: "2026-10-27" }), now).active === null, "negativt index → null");
  ok(L.ordningState(withF(PLAN, { attGora: STEPS, ordningAktiv: "2", ordningDatum: "2026-10-27" }), now).active === null, "index som text → null");
  ok(L.ordningState(withF(PLAN, { attGora: STEPS, ordningAktiv: 1.5, ordningDatum: "2026-10-27" }), now).active === null, "decimaltal → null");
  ok(L.stepNext(fewer, now).ordningAktiv === 0, "Nästa steg från ett ogiltigt läge börjar på steg 1");
}

// --- timern ----------------------------------------------------------------------
{
  const t0 = at(8, 40);
  const step3 = withF(PLAN, { attGora: STEPS, ordningAktiv: 2, ordningDatum: "2026-10-27", ordningTimer: null });
  ok(L.stepCountdown(step3, t0).phase === "none", "pågående steg utan timer: ingen timer");
  const run = withF(step3, L.stepStartTimer(step3, 20, t0));
  ok(run.fields.ordningTimer.step === 2 && run.fields.ordningTimer.startedAt === t0, "timern hör till det pågående steget");
  const before = L.stepCountdown(run, t0 - 5_000);
  ok(before.phase === "running" && before.text === "20:00", "före startedAt (klockskillnad): full tid");
  ok(L.stepCountdown(run, t0).text === "20:00", "20:00 vid start");
  ok(L.stepCountdown(run, t0 + 1_000).text === "19:59", "20:00 → 19:59");
  ok(L.stepCountdown(run, t0 + 19 * 60_000 + 59_500).text === "0:01", "sista sekunden 0:01");
  const done = L.stepCountdown(run, t0 + 20 * 60_000);
  ok(done.phase === "done" && done.text === "Klart", "vid 0: Klart");
  ok(L.stepCountdown(run, t0 + 30 * 60_000).phase === "done", "Klart ligger kvar (tills lektionen slutar)");
  ok(L.ordningState(run, t0 + 25 * 60_000).active === 2, "Klart går inte vidare av sig självt");

  // +1 min under nedräkningen
  const plus = withF(run, L.stepPlusOneMinute(run, t0 + 5 * 60_000));
  ok(L.stepCountdown(plus, t0 + 5 * 60_000).text === "16:00", "+1 min under nedräkningen: 15:00 → 16:00");
  // +1 min efter Klart → räknar igen
  const late = t0 + 22 * 60_000;
  const again = withF(run, L.stepPlusOneMinute(run, late));
  ok(L.stepCountdown(again, late).phase === "running" && L.stepCountdown(again, late).text === "1:00", "+1 min efter Klart: räknar igen från 1:00");
  ok(L.stepCountdown(again, late + 60_000).phase === "done", "… och blir Klart igen efter en minut");
  ok(L.stepPlusOneMinute(step3, t0) === null, "+1 min utan timer: ingenting");

  // Stoppa timer → steget förblir markerat
  const stopped = withF(run, L.stepStopTimer(run));
  ok(stopped.fields.ordningTimer === null && L.ordningState(stopped, t0).active === 2, "Stoppa timer: timern borta, steget kvar");

  // step !== ordningAktiv → ingen timer
  const other = withF(run, { ...run.fields, ordningAktiv: 3 });
  ok(L.ordningState(other, t0).timer === null && L.stepCountdown(other, t0).phase === "none", "timer på ett annat steg → ingen timer");
  ok(L.stepStartTimer(withF(PLAN, { attGora: STEPS }), 10, t0) === null, "utan pågående steg kan ingen timer startas");
  const broken = withF(step3, { ...step3.fields, ordningTimer: { step: 2, durationMs: "x", startedAt: t0 } });
  ok(L.ordningState(broken, t0).timer === null, "trasig timer → ingen timer");
}

// --- stapeln: andelen tid kvar (issue #146) ----------------------------------------------
{
  const t0 = at(8, 40);
  const step3 = withF(PLAN, { attGora: STEPS, ordningAktiv: 2, ordningDatum: "2026-10-27", ordningTimer: { step: 2, durationMs: 20 * 60_000, startedAt: t0 } });
  ok(L.stepCountdown(step3, t0 - 5_000).fraction === 1, "stegtimern före start: full stapel (1)");
  ok(L.stepCountdown(step3, t0).fraction === 1, "stegtimern vid start: 1");
  ok(L.stepCountdown(step3, t0 + 10 * 60_000).fraction === 0.5, "stegtimern halvvägs: 0,5");
  ok(L.stepCountdown(step3, t0 + 20 * 60_000).fraction === 0, "stegtimern vid Klart: 0");
  const plus = withF(step3, L.stepPlusOneMinute(step3, t0 + 10 * 60_000));
  ok(Math.abs(L.stepCountdown(plus, t0 + 10 * 60_000).fraction - 11 / 21) < 1e-9, "+1 min: andelen räknas om mot den nya totalen (11/21)");
  const late = t0 + 25 * 60_000;
  ok(L.stepCountdown(withF(step3, L.stepPlusOneMinute(step3, late)), late).fraction === 1, "+1 min efter Klart: full stapel igen");
  ok(L.ordningView(step3, t0 + 10 * 60_000).fraction === 0.5, "ordningView skickar med andelen");

  const R = await import("../js/lib/efter-rasten.js");
  const brk = { id: "b", date: "2026-10-27", start: "08:00", end: "09:00", fields: { efterRasten: "- Läs", efterRastenMin: 10 }, show: { efterRasten: true } };
  ok(R.breakCountdown(brk, at(7, 50)).fraction === 1, "Efter rasten före start: full stapel (1)");
  ok(R.breakCountdown({ ...brk, start: "" }, at(8, 30)).fraction === 1, "Efter rasten utan starttid: full stapel");
  ok(R.breakCountdown(brk, at(8, 5)).fraction === 0.5, "Efter rasten halvvägs: 0,5");
  ok(R.breakCountdown(brk, at(8, 10)).fraction === 0, "Efter rasten vid 0: 0");
  const brkPlus = { ...brk, fields: R.plusOneMinute(brk.fields) };
  ok(Math.abs(R.breakCountdown(brkPlus, at(8, 5)).fraction - 6 / 11) < 1e-9, "Efter rasten +1 min: andelen räknas om mot 11 min (6/11)");
}

// --- minutfältet --------------------------------------------------------------------
{
  for (const bad of [0, "0", 91, "91", "", "  ", null, undefined, "tio", "5 min", "2.5", -3, "1e1"]) {
    ok(L.parseStepMinutes(bad) === null, `minuter ${JSON.stringify(bad)} → fel`);
  }
  ok(L.parseStepMinutes(1) === 1 && L.parseStepMinutes("1") === 1, "1 går igenom");
  ok(L.parseStepMinutes(90) === 90 && L.parseStepMinutes(" 90 ") === 90, "90 går igenom");
  ok(L.STEP_MIN_ERROR === "Ange 1–90 minuter", "felmeddelandet");
  ok(L.STEP_QUICK_MIN.join(",") === "5,10,15,20", "snabbknapparna 5/10/15/20");
  const p = withF(PLAN, { attGora: STEPS, ordningAktiv: 0, ordningDatum: "2026-10-27" });
  ok(L.stepStartTimer(p, "", at(8, 5)) === null && L.stepStartTimer(p, 91, at(8, 5)) === null, "ogiltiga minuter startar ingen timer");
  ok(L.stepStartTimer(p, "90", at(8, 5)).ordningTimer.durationMs === 90 * 60_000, "90 minuter startar");
}

// --- nollställning --------------------------------------------------------------------
{
  const live = withF(PLAN, { attGora: STEPS, ordningAktiv: 2, ordningDatum: "2026-10-27", ordningTimer: { step: 2, durationMs: 600_000, startedAt: at(8, 40) } });
  ok(L.ordningLive(live, at(9, 19, 59)) && !L.ordningStale(live, at(9, 19)), "under lektionen gäller läget");
  ok(!L.ordningLive(live, at(9, 20)) && L.ordningView(live, at(9, 20)) === null, "efter sluttiden: ignoreras på tavlan");
  ok(L.ordningStale(live, at(9, 20)), "… och ska nollställas");
  ok(!L.ordningLive(live, at(8, 10, 0, 28)) && L.ordningStale(live, at(8, 10, 0, 28)), "annan dag: nollställs");
  const noEnd = { ...live, end: "" };
  ok(L.ordningLive(noEnd, at(23, 59)), "utan sluttid: gäller resten av dagen");
  ok(!L.ordningLive(noEnd, at(0, 0, 1, 28)) && L.ordningStale(noEnd, at(7, 0, 0, 28)), "utan sluttid: nästa dag nollställs");
  // Planeringens datum spelar ingen roll — läget gäller dagen det sattes.
  const oldPlan = { ...live, date: "2026-09-01" };
  ok(L.ordningLive(oldPlan, at(9, 0)), "en gammal planering som används idag: läget gäller idag");
  ok(!L.ordningStale(withF(PLAN, { attGora: STEPS }), at(12, 0)), "inget läge → inget att nollställa");

  const check = L.createOrdningReset({ teacher: true });
  ok(check(live, at(9, 0)) === false, "under lektionen: ingen nollställning");
  ok(check(live, at(9, 20)) === true, "efter sluttiden: nollställ");
  ok(check(live, at(9, 21)) === false && check(live, at(10, 0)) === false, "bara en gång, även om svaret dröjer");
  ok(check({ ...live, id: "p2" }, at(9, 30)) === true, "en annan planering nollställs för sig");
  const student = L.createOrdningReset({ teacher: false });
  ok(student(live, at(9, 30)) === false && student(live, at(8, 0, 0, 28)) === false, "elevvyn skriver aldrig");

  const reset = L.resetOrdningRun(normalizePlan(live).fields);
  ok(reset.ordningAktiv === null && reset.ordningDatum === null && reset.ordningTimer === null, "nollställningen sätter alla tre till null");
  ok(reset.attGora.join("|") === STEPS.join("|"), "… och rör inte stegen");
  ok(JSON.stringify(L.resetOrdningRun({ vad: "x" })) === JSON.stringify({ vad: "x" }), "gamla planeringar utan fälten får inga nya nycklar");

  // Lärarvyn: nollställningen sitter bara i lärarvyns ticker (elevvyn har ingen).
  const js = readFileSync(new URL("../js/modes/lektion.js", import.meta.url), "utf8");
  const studentPart = js.slice(js.indexOf("// ---------- ELEVVY"), js.indexOf("// ---------- LÄRARVY"));
  ok(studentPart.length > 0 && !/ordningReset|createOrdningReset|patchEditing|data\.(put|patch)/.test(studentPart), "elevvyns del skriver aldrig (ingen nollställning, ingen patch)");
  ok(/createOrdningReset\(\{ teacher: true \}\)/.test(js), "lärarvyn har nollställningen");
}

// --- tavlan: oförändrad utan markering ------------------------------------------------
// Fångad från boardHTML FÖRE issue #146 (samma planering). Med en
// tom rad bland stegen och HTML i stegtexten.
const BEFORE = [
  "<div class=\"lesson-board\" style=\"--subj:#3a63a6;--subj-ink:#ffffff;--subj-deep:#3a63a6;--lb-break-bg:#e7ecf4;--lb-break-ink:#3a63a6\">\n    <div class=\"lb-top\"><div class=\"lb-subject\">Matematik</div><div class=\"lb-time\">Tid: 08:00–09:20</div></div><div class=\"lb-mid\"><div class=\"lb-col lb-col--mid\"><div class=\"lb-field lb-field--attGora\">\n    <div class=\"lb-field__label\">LEKTIONSORDNING</div>\n    <div class=\"lb-field__body\"><ol class=\"lb-steps\"><li>Genomgång/Samling</li><li>Mini-whiteboards</li><li>Mattebok s.44-45</li><li>Avslut &lt;b&gt;x&lt;/b&gt;</li></ol></div>\n  </div></div><div class=\"lb-col lb-col--right\"><div class=\"lb-field lb-field--narKlar\">\n    <div class=\"lb-field__label\">NÄR DU ÄR KLAR</div>\n    <div class=\"lb-field__body\"><div class=\"lb-text\">Läs</div></div>\n  </div></div></div>\n  </div>",
  "<div class=\"lesson-board\" style=\"--subj:#3a63a6;--subj-ink:#ffffff;--subj-deep:#3a63a6;--lb-break-bg:#e7ecf4;--lb-break-ink:#3a63a6\">\n    <div class=\"lb-top\"><div class=\"lb-subject\">Matematik</div><div class=\"lb-time\">Tid: 08:00–09:20</div></div><div class=\"lb-mid\"><div class=\"lb-col lb-col--mid\"><div class=\"lb-break\"></div><div class=\"lb-field lb-field--attGora\">\n    <div class=\"lb-field__label\">LEKTIONSORDNING</div>\n    <div class=\"lb-field__body\"><ol class=\"lb-steps\"><li>Genomgång/Samling</li><li>Mini-whiteboards</li><li>Mattebok s.44-45</li><li>Avslut &lt;b&gt;x&lt;/b&gt;</li></ol></div>\n  </div></div></div>\n  </div>",
];
{
  const plan = { id: "p1", name: "M", date: "2026-10-27", subjectId: "ma", start: "08:00", end: "09:20",
    fields: { attGora: ["Genomgång/Samling", "Mini-whiteboards", "  ", "Mattebok s.44-45", "Avslut <b>x</b>"], narKlar: "Läs" },
    show: { attGora: true, narKlar: true } };
  const brk = { ...plan, show: { attGora: true, efterRasten: true } };
  ok(boardHTML(plan, SUBJECTS) === BEFORE[0], "utan läge: exakt samma HTML som före #146");
  ok(boardHTML(brk, SUBJECTS, { breakBox: "<div class=\"lb-break\"></div>" }) === BEFORE[1], "med Efter rasten: exakt samma HTML som före #146");
  ok(boardHTML(plan, SUBJECTS, { run: null }) === BEFORE[0], "run: null → samma HTML");
  // Ett läge som inte gäller längre (annan dag) ger också dagens HTML.
  const stale = withF(plan, { ...plan.fields, ordningAktiv: 1, ordningDatum: "2026-10-26", ordningTimer: { step: 1, durationMs: 60_000, startedAt: at(8, 0, 0, 26) } });
  ok(boardHTML(stale, SUBJECTS, { run: L.ordningView(stale, at(8, 30)) }) === BEFORE[0], "utgånget läge → samma HTML");
  const outOfRange = withF(plan, { ...plan.fields, ordningAktiv: 9, ordningDatum: "2026-10-27" });
  ok(boardHTML(outOfRange, SUBJECTS, { run: L.ordningView(outOfRange, at(8, 30)) }) === BEFORE[0], "index utanför listan → samma HTML");
}

// --- tavlan: markerade steg + HTML-säkerhet ---------------------------------------------
{
  const evil = ["<b>Ett</b>", "<b>Två</b>", "<b>Tre</b>"];
  const base = withF(PLAN, { attGora: evil, ordningDatum: "2026-10-27" });
  const now = at(8, 30);
  const html = (plan) => boardHTML(plan, SUBJECTS, { run: L.ordningView(plan, now) });
  const mid = withF(base, { ...base.fields, ordningAktiv: 1 });
  const h = html(mid);
  ok(!h.includes("<b>") && h.includes("&lt;b&gt;Ett&lt;/b&gt;") && h.includes("&lt;b&gt;Två&lt;/b&gt;") && h.includes("&lt;b&gt;Tre&lt;/b&gt;"),
    "avklarat, pågående och kommande steg: texten escapas");
  ok(h.includes(`<ol class="lb-steps lb-steps--run">`), "markerad lista får klassen lb-steps--run");
  ok(/<li class="lb-step--done"><span class="lb-step__mark" aria-hidden="true">1<svg[^]*?<\/svg><\/span><span class="lb-step__text">&lt;b&gt;Ett&lt;\/b&gt;<\/span><\/li>/.test(h),
    "avklarat steg: bock i bubblan (siffran kvar osynlig) + egen text");
  ok(h.includes(`<li class="lb-step--now" aria-current="step"><span class="lb-step__text">&lt;b&gt;Två&lt;/b&gt;</span></li>`), "pågående steg utan timer: ingen timer");
  ok(h.includes(`<li>&lt;b&gt;Tre&lt;/b&gt;</li>`), "kommande steg: som i dag");
  ok((h.match(/lb-step__timer/g) ?? []).length === 0, "ingen timer utan timer");

  const timed = withF(mid, { ...mid.fields, ordningTimer: { step: 1, durationMs: 20 * 60_000, startedAt: now } });
  const ht = html(timed);
  ok((ht.match(/class="lb-step__timer lb-timer"/g) ?? []).length === 1, "timern visas på EN rad");
  ok(/<li class="lb-step--now lb-step--timer" aria-current="step"><span class="lb-step__text">&lt;b&gt;Två&lt;\/b&gt;<\/span><span class="lb-step__timer lb-timer" role="timer"[^>]*data-phase="running"><svg[^]*?<\/svg><span data-el="step-time">20:00<\/span><span class="wt-bar lb-timer__bar"[^>]*><span class="wt-bar__fill" data-el="step-bar" style="transform:scaleX\(1\.0000\)"><\/span><\/span><\/span><\/li>/.test(ht),
    "timern sitter sist på det pågående stegets rad, inuti raden, och visar 20:00");
  const hd = boardHTML(timed, SUBJECTS, { run: L.ordningView(timed, now + 20 * 60_000) });
  ok(hd.includes(`data-phase="done"`) && hd.includes(">Klart</span>"), "vid 0: Klart");
  const last = withF(timed, { ...timed.fields, ordningAktiv: 2, ordningTimer: null });
  ok((html(last).match(/lb-step--done/g) ?? []).length === 2 && !html(last).includes("lb-step__timer"), "stegbyte: två bockar, timern borta");
  // Lektionsordning urkryssad: tavlan har inga steg (renderBoard skickar då run: null).
  ok(!boardHTML({ ...timed, show: { attGora: false } }, SUBJECTS, { run: null }).includes("lb-steps"), "Lektionsordning urkryssad: inga steg");
}

// --- timerbrickan: ifylld bricka, stegtexten utan begränsande bredd ---------------------
{
  const css = readFileSync(new URL("../css/modes/lektion.css", import.meta.url), "utf8");
  const rule = (sel) => {
    const i = css.indexOf(`${sel} {`);
    return i < 0 ? null : css.slice(i + sel.length + 2, css.indexOf("}", i));
  };
  const now = at(8, 30);
  const p = withF(PLAN, { attGora: STEPS, ordningAktiv: 2, ordningDatum: "2026-10-27", ordningTimer: { step: 2, durationMs: 600_000, startedAt: now } });
  const h = boardHTML(p, SUBJECTS, { run: L.ordningView(p, now) });
  ok(/<span class="lb-step__timer lb-timer" role="timer"[^>]*>/.test(h), "stegtimern har brickklassen lb-timer");
  // Efter rastens timer har SAMMA brickklass (en gemensam stil, ingen variant).
  const brkPlan = { ...p, show: { attGora: true, efterRasten: true }, fields: { ...p.fields, efterRasten: "- Läs", efterRastenMin: 10 } };
  const brkHTML = breakBoxHTML(brkPlan, at(8, 5));
  ok(/<div class="lb-break__time lb-timer" role="timer"/.test(brkHTML), "Efter rastens timer har samma brickklass lb-timer");
  ok(/<span class="wt-bar lb-timer__bar"[^>]*><span class="wt-bar__fill" data-el="brk-bar" style="transform:scaleX\(0\.5000\)">/.test(brkHTML), "Efter rasten halvvägs: stapeln halv (widgetens wt-bar/wt-bar__fill)");
  ok(!/lb-timer/.test(breakBoxHTML({ ...brkPlan, fields: { ...brkPlan.fields, efterRastenTimer: false } }, at(8, 5))), "Efter rasten utan timer: ingen bricka");
  const badge = rule(".lb-timer") ?? "";
  ok(/background: var\(--subj\);/.test(badge) && /color: var\(--subj-ink\);/.test(badge), "brickan är ifylld: ämnesfärg som bakgrund, ämnets textfärg");
  ok(/padding: 0\.05em var\(--lb-timer-px, 0\.4em\) 0\.15em;/.test(badge) && /border-radius: var\(--radius-m\);/.test(badge) && /tabular-nums/.test(badge), "radius-m, padding 0.05em 0.4em (+ luft för stapeln), tabular-nums");
  const bar = rule(".lb-timer > .lb-timer__bar") ?? "";
  ok(/height: 0\.12em;/.test(bar) && /position: absolute;/.test(bar) && /currentColor 25%/.test(bar), "stapeln: 0.12em, inuti brickans nederkant, spår i currentColor 25 %");
  ok(/background: currentColor;/.test(rule(".lb-timer > .lb-timer__bar > .wt-bar__fill") ?? ""), "fyllningen i currentColor");
  const stepT = rule(".lb-step__timer") ?? "";
  ok(/font-size: 1em;/.test(stepT) && /height: 1\.28em;/.test(stepT), "stegbrickan: stegtextens storlek, en textrad hög (raden blir inte högre)");
  ok(/flex: none;/.test(stepT) && !/margin-left/.test(stepT + badge), "brickan: flex none, mellanrum via gap (ingen margin-left: auto)");
  ok(/animation: lb-step-pulse/.test(rule('.lb-step__timer[data-phase="done"]') ?? ""), "Klart: hela brickan pulserar");
  const text = rule(".lb-step--timer > .lb-step__text") ?? "";
  ok(/flex: 1 1 auto;/.test(text) && /min-width: 0;/.test(text), "stegtexten: flex 1 1 auto, min-width 0");
  ok(!/(max-width|[^-]width|flex-basis)\s*:/.test(text), `stegtexten har ingen begränsande bredd (fick ${text})`);
  ok(!/li\.lb-step--timer \{[^}]*flex-wrap/.test(css), "brickan hamnar aldrig på en egen rad (ingen flex-wrap)");
}

// --- kopiering ---------------------------------------------------------------------------
{
  const src = withF(PLAN, { attGora: STEPS, ordningAktiv: 2, ordningDatum: "2026-10-27", ordningTimer: { step: 2, durationMs: 600_000, startedAt: at(8, 40) } });
  const c = buildCopy(normalizePlan(src), { date: "2026-11-03" }, "larare-x");
  ok(c.fields.ordningAktiv === null && c.fields.ordningDatum === null && c.fields.ordningTimer === null, "Skicka kopia: inget läge");
  ok(c.fields.attGora.join("|") === STEPS.join("|"), "Skicka kopia: stegen följer med");
  // Kopiera (copyPlan i lektion.js) nollställer på samma sätt som Efter rasten.
  const js = readFileSync(new URL("../js/modes/lektion.js", import.meta.url), "utf8");
  ok(/copy\.fields = resetOrdningRun\(resetBreakRun\(copy\.fields\)\);/.test(js), "Kopiera nollställer läget (samma ställe som resetBreakRun)");
  const copied = L.resetOrdningRun(resetBreakRun(normalizePlan(src).fields));
  ok(copied.ordningAktiv === null && copied.ordningTimer === null && copied.ordningDatum === null, "Kopiera: inget läge");
  ok(src.fields.ordningAktiv === 2, "originalet är orört");
  // normalizePlan bevarar läget (annars tappar fältredigeringen det).
  const np = normalizePlan(src);
  ok(np.fields.ordningAktiv === 2 && np.fields.ordningTimer.durationMs === 600_000, "normalizePlan behåller läget");
  ok(normalizePlan({}).fields.ordningAktiv === null && normalizePlan({}).fields.ordningTimer === null, "normalizePlan utan läge: null");
}

console.log(`\n${passed} OK, ${failed} fel`);
if (failed > 0) process.exit(1);
