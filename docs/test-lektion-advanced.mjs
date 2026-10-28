/**
 * TEST — "Avancerat" i Lektionsplaneringens sidopanel (issue #149),
 * js/lib/lektion-advanced.js och sidopanelens HTML (fieldsHTML, stepRunHTML,
 * teacherHTML i js/modes/lektion.js).
 *
 *   node docs/test-lektion-advanced.mjs
 *
 * Kontrollerar:
 *   - isAdvanced: saknat dokument, null, fel typ → false; { advanced: true } → true
 *   - advancedPartsInUse: varje del för sig, alla, ingen; stegläge från
 *     igår räknas inte
 *   - fieldsHTML med växeln av: varken Efter rasten, Bra jobbat eller
 *     stegningens plats; på: båda fälten, i samma ordning som före #149
 *   - växeln på: panelens HTML är IDENTISK med före #149 bortsett från
 *     växeln och etiketterna (referensen docs/fixtures/lektion-panel-fore-149.json
 *     togs fram ur koden före ändringen; blanksteg normaliseras)
 *   - växeln ändrar aldrig planeringen (djupjämförelse) och aldrig tavlan
 *   - inställningen: teachers/{uid}/settings/lektionsvy, fältet advanced
 *   - minuter per steg (issue #153): platsen bara med Avancerat på,
 *     stepMinsHTML (en rad per steg, sifferfält 1–90, summan), knappen
 *     "Starta N min" bara när det pågående steget har minuter, och
 *     advancedPartsInUse tar med "planerade minuter"
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

const A = await import("../js/lib/lektion-advanced.js");
const { fieldsHTML, stepRunHTML, stepMinsHTML, teacherHTML, advancedUsedHTML, boardHTML, normalizePlan } = await import("../js/modes/lektion.js");
const L = await import("../js/lib/lektionsordning.js");
const { praiseEditorHTML } = await import("../js/ui/praise-editor.js");
const { SUBJECTS } = await import("../js/lib/color.js");
const { readFileSync } = await import("node:fs");
const BEFORE = JSON.parse(readFileSync(new URL("./fixtures/lektion-panel-fore-149.json", import.meta.url), "utf8"));

let failed = 0;
let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FEL: ${msg}`);
}

const STEP_QUICK_ALL = (h) => [5, 10, 15, 20].every((m) => h.includes(`data-min="${m}">${m} min</button>`));
const at = (h, m, day = 27) => new Date(2026, 9, day, h, m).getTime(); // tis 27 okt 2026
const TAG = `<span class="adv-tag">Avancerat</span>`;
/** Samma normalisering som referensen: Bra jobbat-redigeraren, ikoner, id:n och blanksteg. */
const flat = (h) => h.replace(praiseEditorHTML(), "{PRAISE}").replace(/<svg[\s\S]*?<\/svg>/g, "{SVG}")
  .replace(/cl-\d+/g, "cl-N").replace(/\s+/g, " ").trim();
const noTags = (h) => h.split(TAG).join("");
/** Platsen för "Minuter per steg" (issue #153) — fanns inte före #149-referensen. */
const MINS_SLOT = `<div class="field-edit__mins" data-el="step-mins" hidden></div>`;
const noMins = (h) => h.split(MINS_SLOT).join("");
const wraps = (h) => [...h.matchAll(/data-fieldwrap="(\w+)"/g)].map((m) => m[1]);

// Samma planeringar som referensen togs fram med.
const PLAN_A = normalizePlan({
  id: "a", date: "2026-10-27", start: "08:00", end: "09:20",
  fields: { vad: "Bråk", attGora: ["Ett", "Två <b>", "Tre"], efterRasten: "- Läs", ordningAktiv: 1, ordningDatum: "2026-10-27" },
  show: { vad: true, attGora: true, efterRasten: true, praise: true },
});
const PLAN_B = normalizePlan({ id: "b" });

// --- isAdvanced ----------------------------------------------------------------
ok(A.isAdvanced(undefined) === false, "saknat dokument → av");
ok(A.isAdvanced(null) === false, "null → av");
ok(A.isAdvanced({}) === false, "dokument utan advanced → av");
ok(A.isAdvanced({ advanced: "true" }) === false, "advanced som text → av");
ok(A.isAdvanced({ advanced: 1 }) === false, "advanced som tal → av");
ok(A.isAdvanced("ja") === false, "trasigt dokument (text) → av");
ok(A.isAdvanced({ advanced: false }) === false, "{ advanced: false } → av");
ok(A.isAdvanced({ advanced: true }) === true, "{ advanced: true } → på");

// --- inställningens plats ---------------------------------------------------------
ok(A.ADVANCED_SETTINGS_DOC === "lektionsvy", "dokumentet heter lektionsvy");
ok(A.advancedSettingsPath("u1") === "teachers/u1/settings", "path: teachers/{uid}/settings");
ok(A.advancedSettingsPath("local") === "teachers/local/settings", "lokalt läge: uid local");
ok(A.ADVANCED_FIELD_KEYS.join(",") === "efterRasten,praise", "ADVANCED_FIELD_KEYS");

// --- advancedPartsInUse -------------------------------------------------------
{
  const now = at(8, 30);
  const base = { id: "p", date: "2026-10-27", start: "08:00", end: "09:20", fields: { attGora: ["Ett", "Två"] } };
  const parts = (p) => A.advancedPartsInUse(p, now).join(", ");
  const steg = { ordningAktiv: 0, ordningDatum: "2026-10-27" };
  ok(parts({ ...base, show: { vad: true, attGora: true } }) === "", "inga avancerade delar → tom lista");
  ok(parts(normalizePlan({ ...base, show: { attGora: true } })) === "", "normaliserad vanlig planering → tom lista");
  ok(parts({ ...base, show: { efterRasten: true } }) === "Efter rasten", "Efter rasten");
  ok(parts({ ...base, show: { praise: true } }) === "Bra jobbat", "Bra jobbat");
  ok(parts({ ...base, show: {}, widgets: [{ id: "w1", type: "clock", cfg: {} }] }) === "widgets", "widgets");
  ok(parts({ ...base, show: {}, widgets: [] }) === "", "tom widgetlista räknas inte");
  ok(parts({ ...base, fields: { ...base.fields, ...steg }, show: { attGora: true } }) === "stegning i Lektionsordning",
    "pågående stegning i dag");
  ok(parts({ ...base, fields: { ...base.fields, ordningAktiv: 0, ordningDatum: "2026-10-26" }, show: { attGora: true } }) === "",
    "stegläge från igår räknas inte");
  ok(A.advancedPartsInUse({ ...base, fields: { ...base.fields, ...steg }, show: { attGora: true } }, at(9, 30)).length === 0,
    "stegläge efter lektionens slut räknas inte");
  ok(parts({ ...base, fields: { ...base.fields, ordningAktiv: 5, ordningDatum: "2026-10-27" }, show: { attGora: true } }) === "",
    "steg utanför listan räknas inte");
  ok(parts({ ...base, fields: { ...base.fields, ...steg }, show: { attGora: false } }) === "",
    "stegning utan Lektionsordning på tavlan räknas inte (syns inte där)");
  const all = {
    ...base, fields: { ...base.fields, ...steg },
    show: { efterRasten: true, praise: true, attGora: true }, widgets: [{ id: "w1", type: "clock", cfg: {} }],
  };
  ok(parts(all) === "Efter rasten, Bra jobbat, widgets, stegning i Lektionsordning", "alla delar, i panelens ordning");
  ok(A.advancedPartsInUse(null, now).length === 0, "ingen planering → tom lista");

  // Informationsraden
  ok(advancedUsedHTML([]) === "", "ingen rad utan avancerade delar");
  const line = advancedUsedHTML(["Efter rasten"]);
  ok(/Den här planeringen använder <strong>Efter rasten<\/strong>\./.test(line), "raden: Den här planeringen använder Efter rasten.");
  ok(line.includes('data-act="show-advanced"') && line.includes("Visa avancerat"), "raden har länken Visa avancerat");
  ok(advancedUsedHTML(["Efter rasten", "Bra jobbat", "widgets"]).includes("<strong>Efter rasten, Bra jobbat, widgets</strong>"),
    "flera delar listas med komma");
}

// --- fieldsHTML: av ------------------------------------------------------------
{
  const off = fieldsHTML(PLAN_A, { advanced: false });
  ok(!off.includes("efterRasten") && !off.includes('data-show="praise"'), "av: varken efterRasten eller praise");
  ok(!off.includes("praise-editor") && !off.includes("Bra jobbat"), "av: ingen Bra jobbat-redigerare");
  ok(!off.includes('data-el="step-run"'), "av: ingen plats för stegningen");
  ok(!off.includes('data-el="step-mins"') && !off.includes("Minuter per steg"), "av: ingen plats för Minuter per steg (issue #153)");
  ok(!off.includes(TAG), "av: inga etiketter");
  ok(wraps(off).join(",") === "vad,hur,varfor,attGora,narKlar,duBehover,mal", "av: Vad … Mål, i vanlig ordning");
  ok(fieldsHTML(PLAN_A) === off, "standard är av");
}

// --- fieldsHTML / stegning / panel: på = som före #149 ----------------------------
{
  const on = fieldsHTML(PLAN_A, { advanced: true });
  ok(wraps(on).join(",") === "vad,hur,varfor,efterRasten,attGora,narKlar,duBehover,mal,praise", "på: alla fält, samma ordning som i dag");
  ok(on.split(TAG).length - 1 === 2, "på: etikett vid Efter rasten och Bra jobbat");
  ok(on.split(MINS_SLOT).length - 1 === 1, "på: en plats för Minuter per steg (issue #153)");
  ok(on.indexOf(MINS_SLOT) > on.indexOf('data-field="attGora"') && on.indexOf(MINS_SLOT) < on.indexOf('data-el="step-run"'),
    "på: Minuter per steg direkt under Lektionsordningens textfält, före stegningen");
  ok(flat(noMins(noTags(on))) === BEFORE.fieldsA, "på: fälten identiska med före #149 (planering med allt) utöver Minuter per steg");
  ok(flat(noMins(noTags(fieldsHTML(PLAN_B, { advanced: true })))) === BEFORE.fieldsB, "på: fälten identiska med före #149 (ny planering) utöver Minuter per steg");

  const run = stepRunHTML(PLAN_A, at(8, 30));
  ok(run.includes(TAG), "stegningen har etiketten");
  ok(flat(noTags(run)) === BEFORE.runA, "stegningen identisk med före #149");

  const panelOn = teacherHTML({ advanced: true });
  const stripped = noTags(panelOn)
    .replace(/<div data-el="widgets-fold">([\s\S]*?<\/section>)\s*<\/div>/, "$1")
    .replace(/<div class="lesson-advanced">[\s\S]*?Ändrar aldrig vad som visas på tavlan\.<\/p>\s*<\/div>/, "");
  ok(flat(stripped) === BEFORE.panel, "på: panelen identisk med före #149 bortsett från växeln och etiketterna");
  ok(panelOn.includes('data-el="advanced-toggle" checked'), "på: växeln ikryssad");

  const panelOff = teacherHTML();
  ok(/<div data-el="widgets-fold" hidden>/.test(panelOff), "av: Widgets dold");
  ok(!/advanced-toggle"[^>]*checked/.test(panelOff), "av: växeln inte ikryssad");
  ok(panelOff.includes(">Avancerat</span>") && panelOff.includes("Kommer ihåg ditt val. Ändrar aldrig vad som visas på tavlan."),
    "växeln: etiketten Avancerat och hjälptexten");
  ok(panelOff.indexOf('class="lesson-advanced"') > panelOff.indexOf('data-el="widgets"'), "växeln står sist i panelen");
  ok(panelOff.lastIndexOf("lesson-advanced") < panelOff.indexOf("</aside>"), "växeln står i sidopanelen");
  for (const s of ["Om lektionen", "Klassåtgärd", 'data-meta="name"', 'data-meta="date"', 'data-meta="subjectId"',
    'data-meta="start"', 'data-meta="end"', 'data-filter="q"', 'data-el="tabs"', 'data-el="list"']) {
    ok(panelOff.includes(s), `av: alltid synligt — ${s}`);
  }
}

// --- växeln ändrar aldrig planeringen eller tavlan -----------------------------
{
  const plan = normalizePlan({
    id: "x", date: "2026-10-27", start: "08:00", end: "09:20",
    fields: { attGora: ["Ett", "Två"], ordningAktiv: 0, ordningDatum: "2026-10-27", efterRasten: "Läs" },
    show: { attGora: true, efterRasten: true, praise: true }, widgets: [{ id: "w1", type: "clock", cfg: {} }],
  });
  const before = structuredClone(plan);
  fieldsHTML(plan, { advanced: false });
  fieldsHTML(plan, { advanced: true });
  stepRunHTML(plan, at(8, 30));
  A.advancedPartsInUse(plan, at(8, 30));
  ok(JSON.stringify(plan) === JSON.stringify(before), "panelens funktioner rör inte planeringen");

  const js = readFileSync(new URL("../js/modes/lektion.js", import.meta.url), "utf8");
  const body = (name) => {
    const i = js.indexOf(`function ${name}(`);
    return i < 0 ? "" : js.slice(i, js.indexOf("\n    }\n", i));
  };
  for (const fn of ["applyAdvanced", "setAdvanced", "renderAdvancedUsed"]) {
    const b = body(fn);
    ok(b.length > 0, `${fn} finns`);
    ok(!/patchEditing|plansPath|data\.patch|data\.remove/.test(b), `${fn} skriver aldrig till planeringen`);
  }
  ok(/data\.put\(advancedSettingsPath\(currentUid\(\)\), \{ id: ADVANCED_SETTINGS_DOC, advanced: on \}\)/.test(body("setAdvanced")),
    "valet sparas i teachers/{uid}/settings/lektionsvy via datalagret");
  ok(!/localStorage/.test(body("setAdvanced")), "valet sparas inte i localStorage");

  // Tavlan (förhandsvisning och elevskärm) vet inget om växeln.
  const boardSrc = js.slice(js.indexOf("function boardHTML("), js.indexOf("/* ============================================================\n   ANPASSNING"));
  const renderSrc = js.slice(js.indexOf("function renderBoard("), js.indexOf("function tickBreak("));
  ok(!/advanced/i.test(boardSrc) && !/advanced/i.test(renderSrc), "tavlan och renderBoard läser aldrig växeln");
  ok(boardHTML(plan, SUBJECTS) === boardHTML(structuredClone(before), SUBJECTS), "tavlans HTML oförändrad");
  // Elevvyn monteras innan lärarvyns växel ens finns.
  const studentSrc = js.slice(js.indexOf("// ---------- ELEVVY"), js.indexOf("// ---------- LÄRARVY"));
  ok(!/advanced/i.test(studentSrc), "elevvyn läser aldrig växeln");
}

// --- Minuter per steg (issue #153) ------------------------------------------------
{
  const STEPS = ["Genomgång/Samling", "Mini-whiteboards", "Mattebok s.44-45", "Avslut"];
  const plan = normalizePlan({ id: "m", date: "2026-10-27", start: "08:00", end: "09:20",
    fields: { attGora: [STEPS[0], "", ...STEPS.slice(1)], attGoraMin: [10, null, 15, 20, null] }, show: { attGora: true } });
  const h = stepMinsHTML(plan);
  ok(h.includes("Minuter per steg") && h.includes(TAG), "rubriken Minuter per steg med etiketten Avancerat");
  const inputs = [...h.matchAll(/<input type="number"[^>]*data-step="(\d)"[^>]*value="([^"]*)"/g)].map((m) => `${m[1]}:${m[2]}`);
  ok(inputs.join(",") === "0:10,1:15,2:20,3:", `ett sifferfält per steg (tomma rader räknas inte) med sparade minuter (fick ${inputs.join(",")})`);
  ok((h.match(/min="1" max="90" step="1"/g) ?? []).length === 4, "fälten: min 1, max 90, steg 1");
  ok(h.includes(">1. Genomgång/Samling</span>") && h.includes(">4. Avslut</span>"), "stegets nummer och text på raden");
  ok((h.match(/data-el="plan-min-error"[^>]*hidden>Ange 1–90 minuter</g) ?? []).length === 4, "ett (dolt) felmeddelande vid varje fält");
  ok(h.includes(">Planerat: 45 min av lektionens 80</p>"), "summan under listan");
  ok(stepMinsHTML(normalizePlan({ id: "e" })) === "", "utan steg: ingenting");
  ok(!stepMinsHTML(normalizePlan({ id: "x", fields: { attGora: ["<b>Ett</b>"] } })).includes("<b>"), "stegtexten escapas");
  ok(/data-el="plan-sum"[^>]*><\/p>/.test(stepMinsHTML(normalizePlan({ id: "x", start: "08:00", end: "09:00", fields: { attGora: ["Ett"] } }))),
    "utan minuter: ingen summa");

  // "Starta N min" — bara när det pågående steget har minuter, först i raden.
  const now = at(8, 30);
  const runAt = (i) => normalizePlan({ ...plan, fields: { ...plan.fields, ordningAktiv: i, ordningDatum: "2026-10-27" } });
  const r2 = stepRunHTML(runAt(2), now); // Mattebok: 20
  ok(r2.includes(`<button type="button" class="btn" data-act="step-timer" data-min="20">Starta 20 min</button>`), "pågående steg med 20 min: Starta 20 min");
  ok(r2.indexOf("Starta 20 min") < r2.indexOf('data-min="5"'), "… först, före snabbknapparna");
  ok(STEP_QUICK_ALL(r2) && r2.includes('data-el="step-min"') && r2.includes(">Starta</button>"), "… snabbknapparna och det egna fältet finns kvar");
  ok(!/Starta \d+ min/.test(stepRunHTML(runAt(3), now)), "pågående steg utan minuter: ingen Starta-knapp");
  ok(!/Starta \d+ min/.test(stepRunHTML(plan, now)), "inget pågående steg: ingen Starta-knapp");
  const timed = normalizePlan({ ...runAt(2), fields: { ...runAt(2).fields, ordningTimer: { step: 2, durationMs: 60_000, startedAt: now } } });
  ok(!/Starta \d+ min/.test(stepRunHTML(timed, now)), "timern går redan: ingen Starta-knapp");
  const started = L.stepStartTimer(runAt(2), "20", now);
  ok(started.ordningTimer.durationMs === 20 * 60_000 && started.ordningTimer.step === 2, "Starta 20 min startar stegtimern på 20 minuter");
  ok(L.stepCountdown(runAt(2), now).phase === "none", "minuterna startar aldrig en timer av sig själva");
  // Samma mekanism som snabbknapparna i lärarvyn (data-act="step-timer" data-min → stepStartTimer).
  const js = readFileSync(new URL("../js/modes/lektion.js", import.meta.url), "utf8");
  ok(/fields = stepStartTimer\(np, own \? input\.value : btn\.dataset\.min, now\);/.test(js), "knappen går genom stepStartTimer med data-min");

  // Minutfältet: "95" skrivs som "9" → "95". Inget får sparas på vägen
  // (Testarens fynd: 9 sparades och låg kvar när 95 gav felet).
  const R = (v, bad) => JSON.stringify(L.readStepMinutes(v, bad));
  ok(R("9") === '{"ok":true,"min":9}' && R("95") === '{"ok":false}', "readStepMinutes: 9 giltigt, 95 ogiltigt");
  ok(R("") === '{"ok":true,"min":null}' && R(" 20 ") === '{"ok":true,"min":20}', "tomt → null, 20 → 20");
  for (const bad of ["0", "91", "2.5", "tio"]) ok(R(bad) === '{"ok":false}', `readStepMinutes(${bad}) → fel`);
  ok(R("", true) === '{"ok":false}', "badInput (t.ex. \"e\") räknas som fel, inte som tomt");
  const fn = js.slice(js.indexOf("async function setPlanMinute("), js.indexOf("// -- Avancerat (issue #149) --"));
  ok(/if \(!r\.ok \|\| !save\) return;/.test(fn) && fn.indexOf("if (!r.ok || !save) return;") < fn.indexOf("patchEditing"),
    "setPlanMinute sparar bara när save är satt och värdet är giltigt");
  const inputSrc = js.slice(js.indexOf('panel.addEventListener("input"'), js.indexOf('panel.addEventListener("keydown"'));
  const changeSrc = js.slice(js.indexOf('panel.addEventListener("change"'), js.indexOf('panel.addEventListener("input"'));
  ok(/setPlanMinute\(e\.target, \{ save: false \}\)/.test(inputSrc) && !/save: true/.test(inputSrc), "under skrivandet (input): bara felet, inget sparas");
  ok(/setPlanMinute\(e\.target, \{ save: true \}\)/.test(changeSrc), "när fältet ändrats klart (change): sparas");
  // Simulerat: input 9, input 95, change → ingenting sparat; input 20, change → 20.
  {
    const saved = [];
    const step = (v, save) => { const r = L.readStepMinutes(v); if (r.ok && save) saved.push(r.min); return r.ok; };
    step("9", false); step("95", false); step("95", true);
    ok(saved.length === 0, "9 → 95 → lämna fältet: ingenting sparat (inte 9)");
    step("2", false); step("20", false); step("20", true);
    ok(saved.join(",") === "20", "2 → 20 → lämna fältet: 20 sparas");
  }

  // advancedPartsInUse
  const parts = (p) => A.advancedPartsInUse(p, now).join(", ");
  ok(parts(plan) === "planerade minuter", "planerade minuter räknas som avancerad del");
  ok(parts(normalizePlan({ ...plan, fields: { ...plan.fields, attGoraMin: [] } })) === "", "utan minuter: ingenting");
  ok(parts({ ...plan, show: { attGora: false } }) === "", "Lektionsordning urkryssad: räknas inte (syns inte på tavlan)");
  ok(parts(runAt(2)) === "planerade minuter, stegning i Lektionsordning", "med stegning: båda");

  // Avancerat av: tavlan visar ändå kolumnen (växeln styr bara panelen).
  ok(boardHTML(plan, SUBJECTS).includes("lb-field--min"), "tavlan visar Min-kolumnen oavsett växeln");
}

console.log(`${passed} OK, ${failed} FEL`);
if (failed) process.exit(1);
