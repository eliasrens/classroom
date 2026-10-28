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
const { fieldsHTML, stepRunHTML, teacherHTML, advancedUsedHTML, boardHTML, normalizePlan } = await import("../js/modes/lektion.js");
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

const at = (h, m, day = 27) => new Date(2026, 9, day, h, m).getTime(); // tis 27 okt 2026
const TAG = `<span class="adv-tag">Avancerat</span>`;
/** Samma normalisering som referensen: Bra jobbat-redigeraren, ikoner, id:n och blanksteg. */
const flat = (h) => h.replace(praiseEditorHTML(), "{PRAISE}").replace(/<svg[\s\S]*?<\/svg>/g, "{SVG}")
  .replace(/cl-\d+/g, "cl-N").replace(/\s+/g, " ").trim();
const noTags = (h) => h.split(TAG).join("");
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
  ok(!off.includes(TAG), "av: inga etiketter");
  ok(wraps(off).join(",") === "vad,hur,varfor,attGora,narKlar,duBehover,mal", "av: Vad … Mål, i vanlig ordning");
  ok(fieldsHTML(PLAN_A) === off, "standard är av");
}

// --- fieldsHTML / stegning / panel: på = som före #149 ----------------------------
{
  const on = fieldsHTML(PLAN_A, { advanced: true });
  ok(wraps(on).join(",") === "vad,hur,varfor,efterRasten,attGora,narKlar,duBehover,mal,praise", "på: alla fält, samma ordning som i dag");
  ok(on.split(TAG).length - 1 === 2, "på: etikett vid Efter rasten och Bra jobbat");
  ok(flat(noTags(on)) === BEFORE.fieldsA, "på: fälten identiska med före #149 (planering med allt)");
  ok(flat(noTags(fieldsHTML(PLAN_B, { advanced: true }))) === BEFORE.fieldsB, "på: fälten identiska med före #149 (ny planering)");

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

console.log(`${passed} OK, ${failed} FEL`);
if (failed) process.exit(1);
