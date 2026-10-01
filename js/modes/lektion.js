/**
 * LÄGE 2 — LEKTIONSPLANERING
 *
 * Ersätter lärarens PowerPoint-mall (Bilaga A) men behåller layouten
 * eleverna känner igen: toppfält (ämne + tid), tre kolumner
 * (VAD/HUR/VARFÖR · ATT GÖRA · NÄR DU ÄR KLAR) och bottenfält
 * (DU BEHÖVER · MÅL). Finare typografi, mjukare former, ämnesfärg
 * som ram/band/accent mot ljus pappersyta.
 *
 * - Kryssruta per fält (lärarvy): av-/påslag omfördelar layouten utan
 *   tomma hål. Kryssvalen sparas MED planeringen (`show`).
 * - Spara/hämta: namngivna planeringar per klass + datum. Listan grupperas
 *   per vecka, med sök + ämnesfilter. Kopiera (till samma veckodag i
 *   kommande vecka), ta bort en eller flera (med bekräftelse). En sparad
 *   lektion öppnas med exakt samma kryssval. Planeringar raderas ALDRIG
 *   automatiskt — bara när läraren själv tar bort dem.
 * - "Skicka kopia till klass…" (issue #103, ⋯-menyn direkt efter Kopiera,
 *   och "Skicka markerade till klass…" i Välj flera): en oberoende kopia
 *   till en ANNAN klass, med datum/tid inställda direkt i dialogen
 *   (js/ui/send-plan-dialog.js, logik i js/lib/send-plan.js). Eget ämne
 *   följer med till målklassens settings/subjects; målklassens elevskärm
 *   rörs inte. Läraren står kvar i sin klass och planering — statusraden
 *   visar "Kopia skickad till 4B · …" med knappen "Öppna i 4B"
 *   (setActiveClass + setEditingPlanId).
 * - Tavlans text skalas mot tavlans bredd och krymps stegvis BARA när
 *   innehållet inte ryms (fitBoard) — tavlan scrollar aldrig.
 * - Valfri "Bra jobbat"-ruta i högerkolumnen (show.praise), samma
 *   komponent och data som morgonskärmen (js/ui/praise-board.js,
 *   LOKALA classes/{id}/praise/board — elevdata, aldrig i molnet).
 *   När "Visa Bra jobbat" är ikryssad väljs namnen direkt i fältet med
 *   samma redigerare som på morgonskärmen (js/ui/praise-editor.js, #112).
 * - Ämnesfärg + automatisk läsbar text (luminans, js/lib/color.js);
 *   läraren kan lägga till egna ämnen/färger utan oläslig text.
 * - "Redigerar nu" och "Visas för eleverna" är två skilda saker (issue #39):
 *   • editingId — planeringen som är öppen i redigeraren. Bara UI-tillstånd
 *     för fliken (minnet + sessionStorage, se data/plans.js).
 *   • presentedPlanId — planeringen som elevskärmen visar. Ändras BARA när
 *     läraren trycker "Visa på elevskärm" i elevskärmspanelen (issue #88,
 *     lägets onPresent nedan); skapa/kopiera/ta bort rör den aldrig.
 *     Tas den visade bort visar elevvyn ett tomläge.
 * - Elevvyn visar planeringen ren (inga kontroller), synkad via
 *   datalagret (presentedPlanId + planeringens innehåll).
 *
 * - Fällbart i vänsterkolumnen (issue #72, js/ui/collapsible.js): varje
 *   veckogrupp i listan (standard: bara aktuell vecka öppen), "Om lektionen"
 *   och "Fält" (standard: infällda, med sammanfattning). Läget sparas per
 *   dator i localStorage. Innehållet i blocken är oförändrat.
 * - Städad verktygsrad + flikar (issue #82): rad 1 är "+ Ny planering" och
 *   en ⋯-meny (Kopiera/Skicka kopia till klass…/Ta bort/Välj flera,
 *   js/ui/menu-button.js), rad 2
 *   sök + ämnesfilter. Under dem en flikrad Denna vecka · Kommande · Arkiv
 *   (vald flik sparas per dator i localStorage). Sök/filter gäller inom
 *   fliken; träffar i andra flikar visas som en diskret rad. Lärarvyn
 *   begär bred sida (.view--wide, css/app.css).
 * - Ingen statusrad över tavlan (issue #88): tavlan börjar direkt överst.
 *   När den öppna planeringen INTE är den som visas för eleverna får den
 *   den streckade förhandsramen (#82) med etiketten "Förhandsvisning ·
 *   Eleverna ser: … · Gå dit"; visas exakt samma sak finns ingen ram alls
 *   ("Visas nu"-brickan i listan räcker). Utskicket görs av
 *   elevskärmspanelens enda knapp via lägets onPresent (js/lib/present.js).
 *
 * - Widgets (issue #115, js/widgets/README.md): plan.widgets visas som
 *   brickor i rubrikraden mellan ämnet och "Tid: …" (högst 3), valda i
 *   den fällbara sektionen "Widgets" efter "Fält". Utan widgets är tavlans
 *   markup exakt som förut; brickorna påverkar aldrig fitBoard.
 *
 * Kontrakt: docs/MODULKONTRAKT.md. Data: DATAMODELL.md.
 * Planeringar OCH presentedPlanId är PRIVATA per lärare
 * (teachers/{uid}/classes/{id}/lessonPlans resp. …/settings/lektion, se
 * js/data/plans.js); ämnen och namnvisning delas (classes/{id}/settings).
 */

import { icon } from "../lib/icons.js";
import { deepTextColor, groupedSubjects, readableTextColor, SUBJECTS } from "../lib/color.js";
import {
  MY_SUBJECTS_DOC, mySubjectsPath, myIds, filterSubjects, withMine, saveMine,
} from "../lib/my-subjects.js";
import { openMySubjectsDialog } from "../ui/my-subjects-dialog.js";
import {
  plansPath as plansPathFor, currentUid,
  lessonSettingsPath, LESSON_SETTINGS_DOC, getEditingPlanId, setEditingPlanId, presentedPlanOf,
} from "../data/plans.js";
import { createPraiseBoard } from "../ui/praise-board.js";
import { praiseEditorHTML, mountPraiseEditor } from "../ui/praise-editor.js";
import { normalize as normalizeMorning, PRAISE_DOC, praisePath, currentPraise } from "../lib/morning.js";
import { editPraise } from "../lib/praise-edit.js";
import { studentLabel } from "../lib/names.js";
import { serverNow } from "../lib/clock.js";
import { openClassActionDialog } from "../ui/class-actions.js";
import { collapsibleHTML, mountCollapsibles } from "../ui/collapsible.js";
import { createMenuButton } from "../ui/menu-button.js";
import { openSendPlanDialog } from "../ui/send-plan-dialog.js";
import { setActiveClass } from "../ui/class-picker.js";
import { normalizeLessonWidgets, copyLessonWidgets } from "../widgets/registry.js";
import { chipsHTML, createChipHost } from "../widgets/host.js";
import { mountWidgetSettings, widgetsSummary } from "../widgets/settings-ui.js";

/* De nio av-/påslagbara delarna, i den ordning kryssrutorna visas.
   `slot` säger var i tavlan de bor; `list` = flerradsfält. */
const PARTS = [
  { key: "subject",   label: "Ämne",          slot: "top",    kind: "subject" },
  { key: "time",      label: "Tid",           slot: "top",    kind: "time" },
  { key: "vad",       label: "Vad",           slot: "left",   kind: "text" },
  { key: "hur",       label: "Hur",           slot: "left",   kind: "text" },
  { key: "varfor",    label: "Varför",        slot: "left",   kind: "text" },
  { key: "attGora",   label: "Att göra",      slot: "mid",    kind: "steps" },
  { key: "narKlar",   label: "När du är klar", slot: "right",  kind: "list" },
  { key: "duBehover", label: "Du behöver",    slot: "bottom", kind: "list" },
  { key: "mal",       label: "Mål",           slot: "bottom", kind: "text" },
];

const FIELD_KEYS = ["vad", "hur", "varfor", "attGora", "narKlar", "duBehover", "mal"];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/* ---- Datum (lokal tid — toISOString() ger UTC och fel dag strax efter midnatt) ---- */

const pad2 = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayISO = () => isoLocal(new Date(serverNow()));
function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
/** Måndagen i samma vecka (svensk vecka: mån–sön). */
function mondayOf(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
/** ISO-veckonummer. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}
const fmtDay = (d) => d.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" });
const fmtShort = (d) => d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
/** Samma veckodag, idag eller senare: "samma som förra tisdagen" → kommande tisdag. */
function nextSameWeekday(iso) {
  const d = parseISO(iso);
  if (!d) return todayISO();
  const today = parseISO(todayISO());
  let x = d;
  while (x < today) x = addDays(x, 7);
  return isoLocal(x);
}

/** "Matte · tis 22 sep · 10:15" — kort etikett för raden "Eleverna ser". */
function planLabel(p) {
  const d = parseISO(p.date);
  return [p.name || "Namnlös planering", d ? fmtDay(d) : "", p.start ?? ""].filter(Boolean).join(" · ");
}

/* ---- Ämneshjälpare: inbyggd palett + lärarens egna ämnen ---- */

function mergedSubjects(settingsDocs) {
  const custom = settingsDocs.find((d) => d.id === "subjects")?.value?.list ?? [];
  const seen = new Set(SUBJECTS.map((s) => s.id));
  const extra = custom.filter((s) => s?.id && s?.color && !seen.has(s.id));
  return [...SUBJECTS, ...extra];
}

/** { id, name, color, textColor } — textColor räknas ur luminansen. */
function styleFor(subjectId, subjects) {
  const s = subjects.find((x) => x.id === subjectId) ?? subjects.find((x) => x.id === "rast") ?? SUBJECTS.at(-1);
  return { ...s, textColor: readableTextColor(s.color) };
}

/* ---- Normalisering: en planering med alla fält på plats ---- */

function normalizePlan(plan) {
  const p = plan ?? {};
  const f = p.fields ?? {};
  const show = p.show ?? {};
  return {
    id: p.id,
    // Ägaren stämplas på planeringen (privat per lärare). Pathen bär redan
    // ägarskapet; fältet gör det uttryckligt och matchar firestore.rules.
    ownerUid: p.ownerUid ?? currentUid(),
    name: p.name ?? "Ny planering",
    date: p.date ?? todayISO(),
    subjectId: p.subjectId ?? "so",
    start: p.start ?? "",
    end: p.end ?? "",
    fields: {
      vad: f.vad ?? "",
      hur: f.hur ?? "",
      varfor: f.varfor ?? "",
      attGora: Array.isArray(f.attGora) ? f.attGora : (f.attGora ? String(f.attGora).split("\n") : []),
      narKlar: f.narKlar ?? "",
      duBehover: f.duBehover ?? "",
      mal: f.mal ?? "",
    },
    show: {
      subject: show.subject ?? true,
      time: show.time ?? true,
      vad: show.vad ?? false,
      hur: show.hur ?? false,
      varfor: show.varfor ?? false,
      attGora: show.attGora ?? false,
      narKlar: show.narKlar ?? false,
      duBehover: show.duBehover ?? false,
      mal: show.mal ?? false,
      // "Bra jobbat"-rutan i högerkolumnen (delas med "När du är klar").
      praise: show.praise ?? false,
    },
    // Widgets (issue #115): brickor i rubrikraden, [{ id, type, cfg }].
    // Följer med i Kopiera och Skicka kopia.
    widgets: normalizeLessonWidgets(p.widgets),
  };
}

/* ============================================================
   TAVLAN — delas av lärarförhandsvisning och elevvy.
   Fält med show=false renderas inte → flexboxen omfördelar
   (inga tomma hål). Ämnesfärgen kommer in via inline --subj.
   ============================================================ */

function stepsHTML(items) {
  const rows = items.map((s) => String(s).trim()).filter(Boolean);
  if (rows.length === 0) return `<div class="lb-empty">—</div>`;
  return `<ol class="lb-steps">${rows.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
}

function listHTML(value) {
  const rows = String(value ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (rows.length === 0) return `<div class="lb-empty">—</div>`;
  if (rows.length === 1) return esc(rows[0]);
  return `<ul class="lb-list">${rows.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`;
}

function textHTML(value) {
  const v = String(value ?? "").trim();
  return v ? esc(v).replace(/\n/g, "<br>") : `<div class="lb-empty">—</div>`;
}

function fieldHTML(part, plan) {
  const val = plan.fields[part.key];
  let body;
  if (part.kind === "steps") body = stepsHTML(val);
  else if (part.kind === "list") body = listHTML(val);
  else body = textHTML(val);
  return `<div class="lb-field lb-field--${part.key}">
    <div class="lb-field__label">${esc(part.label.toUpperCase())}</div>
    <div class="lb-field__body">${body}</div>
  </div>`;
}

/** `opts.praise` = rendera en plats för Bra jobbat-rutan (fylls i efteråt, se renderBoard). */
function boardHTML(rawPlan, subjects, { praise = false } = {}) {
  const plan = normalizePlan(rawPlan);
  const st = styleFor(plan.subjectId, subjects);
  const show = plan.show;
  const part = (k) => PARTS.find((p) => p.key === k);

  // Toppfält
  let top = "";
  if (show.subject || show.time) {
    const subjEl = show.subject ? `<div class="lb-subject">${esc(st.name)}</div>` : `<span></span>`;
    const timeEl = show.time && (plan.start || plan.end)
      ? `<div class="lb-time">Tid: ${esc(plan.start)}${plan.end ? "–" + esc(plan.end) : ""}</div>`
      : (show.time ? "" : "");
    // Widgetbrickorna (issue #115) mellan ämnet och tiden — "" utan widgets,
    // så att tavlan då är exakt som förut.
    top = `<div class="lb-top">${subjEl}${chipsHTML(plan.widgets)}${timeEl || `<span></span>`}</div>`;
  }

  // Mitten — tre kolumner, var och en utelämnas helt om tom
  const leftKeys = ["vad", "hur", "varfor"].filter((k) => show[k]);
  const leftCol = leftKeys.length
    ? `<div class="lb-col lb-col--left">${leftKeys.map((k) => fieldHTML(part(k), plan)).join("")}</div>`
    : "";
  const midCol = show.attGora
    ? `<div class="lb-col lb-col--mid">${fieldHTML(part("attGora"), plan)}</div>`
    : "";
  const rightCol = show.narKlar || praise
    ? `<div class="lb-col lb-col--right${praise ? " lb-col--has-praise" : ""}">${show.narKlar ? fieldHTML(part("narKlar"), plan) : ""}${praise ? `<div class="lb-praise-slot"></div>` : ""}</div>`
    : "";
  const mid = `<div class="lb-mid">${leftCol}${midCol}${rightCol}</div>`;

  // Bottenfält
  const bottomKeys = ["duBehover", "mal"].filter((k) => show[k]);
  const bottom = bottomKeys.length
    ? `<div class="lb-bottom">${bottomKeys.map((k) => fieldHTML(part(k), plan)).join("")}</div>`
    : "";

  return `<div class="lesson-board" style="--subj:${st.color};--subj-ink:${st.textColor};--subj-deep:${deepTextColor(st.color)}">
    ${top}${mid}${bottom}
  </div>`;
}

/* ============================================================
   ANPASSNING — tavlan scrollar aldrig. Texten startar stor (skalad
   mot tavlans bredd i CSS) och krymps i små steg via --lb-scale BARA
   om något fält inte ryms. Bra jobbat-rutan anpassar sig själv
   (kolumner, se js/ui/praise-board.js) och räknas inte här.
   ============================================================ */

const FIT_MIN = 0.45;
const FIT_PRECISION = 0.01;

function boardOverflows(boardEl) {
  const nodes = [boardEl, ...boardEl.querySelectorAll(".lb-top, .lb-field__body")];
  return nodes.some((n) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1);
}

/** Ryms Bra jobbat-rutan (efter att komponenten lagt ut namnen)? */
function praiseFits(praiseBoard) {
  const el = praiseBoard.el;
  const list = el.querySelector(".praise-board__names");
  const slot = el.parentElement;
  return el.offsetWidth <= slot.clientWidth + 1 && list.scrollHeight <= list.clientHeight + 1;
}

/**
 * Största --lb-scale i [FIT_MIN, 1] där allt ryms (binärsökning, ~6 layoutmätningar).
 * `praiseBoard` (valfri): rutan i högerkolumnen. Den lägger ut sig själv i
 * kolumner och krymper sin egen text; räcker inte det krymps hela tavlan
 * lite till — alla namn ska alltid synas.
 */
function fitBoard(fitEl, praiseBoard = null) {
  const boardEl = fitEl?.querySelector(".lesson-board");
  if (!boardEl?.isConnected) return;
  const withPraise = praiseBoard && fitEl.contains(praiseBoard.el);
  const setScale = (s) => boardEl.style.setProperty("--lb-scale", s.toFixed(3));
  const search = (hi, fits) => {
    setScale(hi);
    if (fits()) return hi;
    let lo = FIT_MIN;
    while (hi - lo > FIT_PRECISION) {
      const mid = (lo + hi) / 2;
      setScale(mid);
      if (fits()) lo = mid; else hi = mid;
    }
    setScale(lo);
    return lo;
  };
  let scale = search(1, () => !boardOverflows(boardEl));
  if (withPraise) {
    praiseBoard.fit();
    if (!praiseFits(praiseBoard)) {
      scale = search(scale, () => { praiseBoard.fit(); return praiseFits(praiseBoard); });
      praiseBoard.fit();
    }
  }
  boardEl.dataset.scale = scale.toFixed(2);
}

/**
 * Ritar tavlan i `container` (lärarens förhandsvisning eller elevvyn),
 * hänger in Bra jobbat-rutan och anpassar texten.
 * `praise` = { board, names, emptyText } — board skapas en gång per montering.
 * `chips` = widgetbrickornas värd (js/widgets/host.js), en per montering.
 */
function renderBoard(container, rawPlan, subjects, praise, chips) {
  const plan = normalizePlan(rawPlan);
  const withPraise = plan.show.praise && (praise.names.length > 0 || !!praise.emptyText);
  container.innerHTML = `<div class="lb-fit">${boardHTML(plan, subjects, { praise: withPraise })}</div>`;
  const fitEl = container.firstElementChild;
  const slot = fitEl.querySelector(".lb-praise-slot");
  if (slot) {
    slot.append(praise.board.el);
    praise.board.setNames(praise.names, { emptyText: praise.emptyText });
  }
  chips?.mount(fitEl);
  fitBoard(fitEl, slot ? praise.board : null);
}

/** Anpassa om efter storleksändring (samma innehåll). */
function refitBoard(container, praise) {
  const fitEl = container.querySelector(".lb-fit");
  if (fitEl) fitBoard(fitEl, praise.board);
}

/* ============================================================
   LISTAN — gruppering per vecka + sök/filter
   ============================================================ */

/** Sökbar text för en planering: namn, ämne, datum och fältens innehåll. */
function searchText(p, subjects) {
  const np = normalizePlan(p);
  const d = parseISO(np.date);
  return [
    np.name, styleFor(np.subjectId, subjects).name, np.date, d ? fmtDay(d) : "",
    np.fields.vad, np.fields.hur, np.fields.varfor, np.fields.attGora.join(" "),
    np.fields.narKlar, np.fields.duBehover, np.fields.mal,
  ].join(" ").toLocaleLowerCase("sv");
}

/**
 * [{ key, label, name, range, plans }] — veckor nyast först, inom veckan dag +
 * tid stigande. `label` = hela etiketten; `name` ("Vecka 39 · denna vecka")
 * och `range` ("21 sep.–27 sep.") separat, så infälld vecka kan korta den.
 */
function groupByWeek(list) {
  const groups = new Map();
  const thisMonday = mondayOf(parseISO(todayISO()));
  for (const p of list) {
    const d = parseISO(p.date);
    const key = d ? isoLocal(mondayOf(d)) : "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const keys = [...groups.keys()].sort((a, b) => (b || "0").localeCompare(a || "0"));
  return keys.map((key) => {
    let name = "Utan datum";
    let range = "";
    if (key) {
      const mon = parseISO(key);
      const diff = Math.round((mon - thisMonday) / (7 * 86400000));
      const rel = { 0: "denna vecka", 1: "nästa vecka", [-1]: "förra veckan" }[diff];
      name = `Vecka ${isoWeek(mon)}${rel ? ` · ${rel}` : ""}`;
      range = `${fmtShort(mon)}–${fmtShort(addDays(mon, 6))}`;
    }
    const label = range ? `${name} · ${range}` : name;
    const plans = groups.get(key).sort((a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") ||
      (a.start ?? "").localeCompare(b.start ?? "") ||
      (a.name ?? "").localeCompare(b.name ?? "", "sv"));
    return { key, label, name, range, plans };
  });
}

/* ---- Fällbara block (issue #72): nycklar + sammanfattningar ---- */

/** Veckogruppens nyckel ("" = utan datum) — samma som groupByWeek. */
const weekKeyOf = (p) => { const d = parseISO(p?.date); return d ? isoLocal(mondayOf(d)) : ""; };
/** Nyckel för veckans fällbara block (sparas i localStorage). */
const weekFoldKey = (weekKey) => `week:${weekKey || "utan-datum"}`;

/** "Bråk intro · SO · lör 26 sep." — "Om lektionen" när blocket är infällt. */
function aboutSummary(rawPlan, subjects) {
  if (!rawPlan) return "Ingen planering";
  const p = normalizePlan(rawPlan);
  const d = parseISO(p.date);
  return [p.name.trim() || "Ny planering", styleFor(p.subjectId, subjects).name, d ? fmtDay(d) : ""]
    .filter(Boolean).join(" · ");
}

/** "Vad, Att göra, Mål visas" — "Fält" när blocket är infällt. */
function fieldsSummary(rawPlan) {
  if (!rawPlan) return "";
  const show = normalizePlan(rawPlan).show;
  const names = FIELD_KEYS.filter((k) => show[k]).map((k) => PARTS.find((p) => p.key === k).label);
  if (show.praise) names.push("Bra jobbat");
  return names.length ? `${names.join(", ")} visas` : "Inga fält visas";
}

/** "Klocka (digital)" / "Inga widgets" — "Widgets" när blocket är infällt. */
function lessonWidgetsSummary(rawPlan) {
  return rawPlan ? widgetsSummary(normalizePlan(rawPlan).widgets) : "";
}

/* ============================================================
   MODEN
   ============================================================ */

/** Exporterad för docs/test-widgets.mjs (widgets följer med planeringen). */
export { normalizePlan };

export default {
  id: "lektion",
  title: "Lektionsplanering",
  icon: "book",

  async mount(el, ctx) {
    this._offs = [];
    const { data, activeClass, view, store, sync } = ctx;

    // Bred sida (issue #82): lektionsläget använder mer av skärmbredden än
    // standardramen (#61) via .view--wide (css/app.css). Bara lärarvyn —
    // elevvyn (data-theme="student") har sin egen .view-regel. Klassen tas
    // bort vid avmontering så andra lärarsidor behåller ramen.
    const viewEl = el.closest(".view");
    if (viewEl && view !== "student") {
      viewEl.classList.add("view--wide");
      this._offs.push(() => viewEl.classList.remove("view--wide"));
    }

    if (!activeClass) {
      el.innerHTML = `<div class="lesson-empty">
        ${icon("book", { size: 40, strokeWidth: 1.4 })}
        <h1>Lektionsplanering</h1>
        <p>Välj en klass i topbaren för att planera lektioner.</p>
      </div>`;
      return;
    }

    const base = `classes/${activeClass.id}`;
    // Planeringar och vad elevskärmen visar är PRIVATA per lärare
    // (teachers/{uid}/…), se data/plans.js. Ämnen och namnvisning ligger
    // kvar i den DELADE klassnoden.
    const plansPath = plansPathFor(activeClass.id);
    const privatePath = lessonSettingsPath(activeClass.id);
    const settingsPath = `${base}/settings`;
    const isTeacher = view !== "student";

    let plans = [];
    let subjects = SUBJECTS;
    // Lärarens privata settings/lektion ({ value: { presentedPlanId } }), null = finns inte ännu.
    let presentedDoc = null;
    // Mina ämnen (issue #81): lärarens PRIVATA val (teachers/{uid}/settings/
    // subjects). null = inget val → alla ämnen visas, som innan.
    let myDoc = null;
    const mine = () => myIds(myDoc);
    // "Visa alla ämnen…" — visar tillfälligt hela paletten i väljaren.
    let showAllSubjects = false;

    // "Bra jobbat"-namnen: samma LOKALA data som morgonskärmen (issue #32) —
    // listan innehåller elevdata och lagras bara på den här datorn.
    let praiseItems = [];
    let praiseWeekOf = null;
    let students = [];
    // Listan som ska VISAS nu — tom om den hör till förra veckan (som på morgonskärmen).
    const shownPraise = () => currentPraise({ praise: praiseItems, weekOf: praiseWeekOf });

    const settingDoc = (id) => this._settings?.find((d) => d.id === id) ?? null;

    const presentedPlan = () => presentedPlanOf(plans, presentedDoc, serverNow());

    // Förvalet (dagens planering) beror på klockan så länge läraren inte
    // valt något — rita om varje minut tills dess.
    const tickUntilChosen = (render) => {
      const t = setInterval(() => { if (!presentedDoc) render(); }, 60_000);
      this._offs.push(() => clearInterval(t));
    };
    const watchPresented = (onChange) => {
      this._offs.push(data.watch(privatePath, (docs) => {
        presentedDoc = docs.find((d) => d.id === LESSON_SETTINGS_DOC) ?? null;
        onChange();
      }));
    };

    const sortedPlans = () =>
      [...plans].sort((a, b) =>
        (a.date ?? "").localeCompare(b.date ?? "") ||
        (a.start ?? "").localeCompare(b.start ?? "") ||
        (a.name ?? "").localeCompare(b.name ?? "", "sv"));

    // ---------- Bra jobbat-rutan (en instans per montering) ----------
    const praiseBoard = createPraiseBoard({
      className: "lb-praise",
      // Rutan får högst bli lika bred som högerkolumnen — därefter krymper texten.
      maxWidth: () => praiseBoard.el.parentElement?.clientWidth ?? Infinity,
    });
    this._offs.push(() => praiseBoard.destroy());

    // ---------- Widgetbrickorna i rubrikraden (issue #115) ----------
    const chipHost = createChipHost({ view, classId: activeClass.id, sync });
    this._offs.push(() => chipHost.destroy());

    function praiseNames() {
      return shownPraise().map((p) => {
        if (p.kind === "free") return p.text;
        const s = students.find((x) => x.id === p.studentId);
        return s ? studentLabel(s) : null;
      }).filter(Boolean);
    }
    const praise = () => ({
      board: praiseBoard,
      names: praiseNames(),
      // Elevvyn visar aldrig en tom ruta; läraren får en ledtråd i förhandsvisningen.
      emptyText: isTeacher ? "Inga namn ännu — kryssa i elever under Visa Bra jobbat" : "",
    });

    function applySharedSettings(docs) {
      this._settings = docs;
      subjects = mergedSubjects(docs);
    }

    // Bra jobbat läses ur den lokala lagringen (aldrig molnet).
    const watchPraise = (onChange) => {
      this._offs.push(data.watch(praisePath(activeClass.id), (docs) => {
        const board = docs.find((d) => d.id === PRAISE_DOC);
        const norm = normalizeMorning({ praise: board?.praise, weekOf: board?.weekOf });
        praiseItems = norm.praise;
        praiseWeekOf = norm.weekOf;
        onChange();
      }));
    };

    // Tavlans storlek följer ytan → anpassa om texten när ytan ändras.
    const observeStage = (stage) => {
      if (typeof ResizeObserver !== "function") return;
      let frame = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => refitBoard(stage, praiseBoard));
      });
      ro.observe(stage);
      document.fonts?.ready?.then(() => refitBoard(stage, praiseBoard));
      this._offs.push(() => { cancelAnimationFrame(frame); ro.disconnect(); });
    };

    const watchStudents = (onChange) => {
      this._offs.push(data.watch(`${base}/students`, (docs) => {
        students = docs.filter((s) => s.active !== false);
        onChange();
      }));
    };

    // ---------- ELEVVY: bara tavlan, synkad ----------
    if (!isTeacher) {
      el.innerHTML = `<div class="lesson-stage-student"></div>`;
      const stage = el.querySelector(".lesson-stage-student");
      const renderStudent = () => {
        if (!stage.isConnected) return;
        const p = presentedPlan();
        if (p) renderBoard(stage, p, subjects, praise(), chipHost);
        else { chipHost.destroy(); stage.innerHTML = `<div class="lesson-empty"><h1>Ingen planering visas</h1><p>Läraren väljer en lektion att visa.</p></div>`; }
      };
      observeStage(stage);
      this._offs.push(data.watch(plansPath, (docs) => { plans = docs; renderStudent(); }));
      watchPresented(renderStudent);
      tickUntilChosen(renderStudent);
      this._offs.push(data.watch(settingsPath, (docs) => {
        applySharedSettings.call(this, docs);
        renderStudent();
      }));
      watchStudents(renderStudent);
      watchPraise(renderStudent);
      return;
    }

    // ---------- LÄRARVY: panel + levande förhandsvisning ----------
    el.innerHTML = `
      <div class="lesson">
        <aside class="lesson-panel teacher-only">
          <section class="lesson-panel__group">
            <h2>Planeringar</h2>
            <div class="plan-toolbar">
              <button class="btn btn--primary" data-act="new">${icon("plus")} Ny planering</button>
              <div class="plan-more" data-el="more">
                <button type="button" class="btn btn--icon plan-more__btn" data-el="more-btn" title="Fler åtgärder" aria-label="Fler åtgärder">${icon("more")}</button>
                <div class="plan-more__menu" data-el="more-menu" aria-label="Fler åtgärder">
                  <button type="button" role="menuitem" class="plan-more__item" data-act="dup" title="Kopiera den valda planeringen till samma veckodag, idag eller framåt">${icon("copy")} Kopiera</button>
                  <button type="button" role="menuitem" class="plan-more__item" data-act="send" title="Skicka en kopia av den valda planeringen till en annan klass — du ställer in datum och tid direkt">${icon("copy")} Skicka kopia till klass…</button>
                  <button type="button" role="menuitem" class="plan-more__item" data-act="del" title="Ta bort den valda planeringen">${icon("trash")} Ta bort</button>
                  <button type="button" role="menuitem" class="plan-more__item" data-act="select" aria-pressed="false" title="Markera flera planeringar och ta bort dem på en gång">${icon("check")} Välj flera</button>
                </div>
              </div>
            </div>
            <div class="plan-filter">
              <label class="plan-filter__search">${icon("search", { size: 16 })}
                <input type="search" data-filter="q" placeholder="Sök namn eller innehåll" aria-label="Sök planering" autocomplete="off">
              </label>
              <select data-filter="subject" aria-label="Filtrera på ämne"></select>
            </div>
            <div class="plan-tabs" role="tablist" aria-label="Visa planeringar för" data-el="tabs">
              <button type="button" class="plan-tab" role="tab" data-tab="week" aria-selected="false" tabindex="-1">Denna vecka</button>
              <button type="button" class="plan-tab" role="tab" data-tab="upcoming" aria-selected="false" tabindex="-1">Kommande</button>
              <button type="button" class="plan-tab" role="tab" data-tab="archive" aria-selected="false" tabindex="-1">Arkiv</button>
            </div>
            <div class="plan-tab-hits" data-el="tab-hits" hidden></div>
            <div class="plan-bulk" data-el="bulk" hidden></div>
            <div class="plan-confirm" data-el="confirm" role="alertdialog" aria-live="assertive" hidden></div>
            <p class="plan-status" data-el="status" aria-live="polite" hidden></p>
            <div class="plan-list" data-el="list"></div>
          </section>

          ${collapsibleHTML({ key: "about", level: 2, className: "lesson-fold", title: "Om lektionen",
            trail: `<button class="btn ca-add" data-act="class-action"
                title="Testade ni något nytt arbetssätt på lektionen? Dela hur det gick med de andra lärarna">${icon("plus")}<span>Klassåtgärd</span></button>`,
            body: `<div class="lesson-panel__group">
            <label class="field-label">Namn
              <input type="text" data-meta="name" autocomplete="off">
            </label>
            <div class="row-2">
              <label class="field-label">Datum
                <input type="date" data-meta="date">
              </label>
              <label class="field-label">Ämne
                <select data-meta="subjectId"></select>
              </label>
            </div>
            <div class="subject-mine-hint" data-el="subject-hint" hidden></div>
            <div class="row-2">
              <label class="field-label">Start
                <input type="time" data-meta="start">
              </label>
              <label class="field-label">Slut
                <input type="time" data-meta="end">
              </label>
            </div>
          </div>` })}

          ${collapsibleHTML({ key: "fields", level: 2, className: "lesson-fold", title: "Fält", body: `<div class="lesson-panel__group">
            <p class="field-edit__hint">Kryssrutan slår av/på fältet på tavlan — layouten omfördelar sig automatiskt. Valen sparas med planeringen.</p>
            <div data-el="fields"></div>
          </div>` })}

          ${collapsibleHTML({ key: "widgets", level: 2, className: "lesson-fold", title: "Widgets", body: `<div class="lesson-panel__group">
            <div data-el="widgets"></div>
          </div>` })}
        </aside>

        <div class="lesson__main">
          <div class="lesson__stage" data-el="stage"></div>
        </div>
      </div>`;

    const listEl = el.querySelector('[data-el="list"]');
    const fieldsEl = el.querySelector('[data-el="fields"]');
    const widgetsEl = el.querySelector('[data-el="widgets"]');
    const stageEl = el.querySelector('[data-el="stage"]');
    const bulkEl = el.querySelector('[data-el="bulk"]');
    const confirmEl = el.querySelector('[data-el="confirm"]');
    const statusEl = el.querySelector('[data-el="status"]');
    const subjectFilterEl = el.querySelector('[data-filter="subject"]');
    const selectBtn = el.querySelector('[data-act="select"]');
    const tabsEl = el.querySelector('[data-el="tabs"]');
    const tabHitsEl = el.querySelector('[data-el="tab-hits"]');
    const metaInputs = () => [...el.querySelectorAll("[data-meta]")];
    const panel = el.querySelector(".lesson-panel");

    // ⋯-menyn (issue #82) — samma menykomponent som toppmenyns rullgardiner
    // (tangentbord + ARIA, js/ui/menu-button.js). Valen bubblar som vanliga
    // [data-act]-klick till panelens delegering nedan.
    const moreRoot = el.querySelector('[data-el="more"]');
    const moreMenu = createMenuButton({
      root: moreRoot,
      button: moreRoot.querySelector('[data-el="more-btn"]'),
      menu: moreRoot.querySelector('[data-el="more-menu"]'),
    });
    this._offs.push(() => moreMenu.close());

    // Listans vy-tillstånd (inte data — sparas inte)
    const filter = { q: "", subject: "" };
    let selecting = false;
    const selected = new Set();
    let pendingDelete = null; // [ids] som väntar på bekräftelse

    // -- Flikar: Denna vecka · Kommande · Arkiv (issue #82). Vald flik
    // sparas per dator (bara UI-tillstånd, ingen elevdata).
    const TABS = ["week", "upcoming", "archive"];
    const TAB_LABELS = { week: "Denna vecka", upcoming: "Kommande", archive: "Arkiv" };
    const TAB_STORE = "classroom:ui:lektion:planTab";
    let listTab = (() => {
      try { const v = localStorage.getItem(TAB_STORE); return TABS.includes(v) ? v : "week"; }
      catch { return "week"; }
    })();
    /** Fliken en planering hör hemma i ("utan datum" → Denna vecka). */
    const tabOf = (p) => {
      const k = weekKeyOf(p);
      if (!k) return "week";
      const tw = thisWeekKey();
      return k === tw ? "week" : k > tw ? "upcoming" : "archive";
    };
    function applyTabUI() {
      for (const b of tabsEl.querySelectorAll("[data-tab]")) {
        const sel = b.dataset.tab === listTab;
        b.setAttribute("aria-selected", String(sel));
        b.tabIndex = sel ? 0 : -1;
      }
    }
    function setListTab(tab, { render = true } = {}) {
      if (!TABS.includes(tab)) return;
      listTab = tab;
      try { localStorage.setItem(TAB_STORE, tab); } catch { /* ok */ }
      applyTabUI();
      if (render) renderList();
    }
    applyTabUI();
    tabsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (b) setListTab(b.dataset.tab);
    });
    // Pilarna flyttar OCH väljer flik (segmenterad kontroll — ett tabbstopp).
    tabsEl.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const i = TABS.indexOf(listTab);
      const next = TABS[(i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
      setListTab(next);
      tabsEl.querySelector(`[data-tab="${next}"]`)?.focus();
    });

    // -- Fällbara block (issue #72). Standard: bara aktuell vecka öppen,
    // "Om lektionen" och "Fält" infällda. Lärarens egna klick sparas per
    // dator (collapsible.js). Veckor som öppnats automatiskt — för att den
    // valda planeringen ligger där — hålls öppna i minnet men sparas inte.
    const thisWeekKey = () => isoLocal(mondayOf(parseISO(todayISO())));
    const autoOpenWeeks = new Set();
    let revealEditing = false; // öppna den valda planeringens vecka vid nästa listritning
    const folds = mountCollapsibles(panel, {
      scope: "lektion",
      defaults: (key) => key === weekFoldKey(thisWeekKey()),
      onToggle: (key) => autoOpenWeeks.delete(key),
    });
    this._offs.push(() => folds.destroy());

    // -- Redigerar nu (bara den här fliken) --
    let editingId = null;
    const editingPlan = () => plans.find((p) => p.id === editingId) ?? null;
    // `reveal` = läraren valde planeringen → öppna dess vecka i listan.
    // Vid inläsning (flikens senaste planering) gäller det sparade läget.
    function setEditing(id, { reveal = true } = {}) {
      editingId = id ?? null;
      setEditingPlanId(activeClass.id, editingId);
      revealEditing = reveal;
    }

    // -- Visas för eleverna (lärarens PRIVATA inställning, delas med elevskärmen) --
    async function present(id) {
      presentedDoc = { id: LESSON_SETTINGS_DOC, value: { presentedPlanId: id ?? null } };
      await data.put(privatePath, presentedDoc);
    }
    // "Visa på elevskärm" i elevskärmspanelen (issue #88): skicka ut exakt
    // den planering läraren tittar på (tomläge om ingen är öppen).
    this.onPresent = async () => { await present(editingPlan()?.id ?? null); };
    this._offs.push(() => { this.onPresent = null; store?.set({ presentSpot: null }); });

    // Rapportera lägets "sak" till elevskärmspanelen (js/lib/present.js):
    // vilken planering som är öppen och vilken som är utskickad.
    function updateSpot() {
      const p = editingPlan();
      const shown = presentedPlan();
      const spot = {
        modeId: "lektion",
        current: p ? { id: p.id, label: p.name || "Namnlös planering" } : null,
        presented: shown ? { id: shown.id, label: shown.name || "Namnlös planering" } : null,
      };
      if (JSON.stringify(store?.get().presentSpot) !== JSON.stringify(spot)) {
        store?.set({ presentSpot: spot });
      }
    }
    // Utan sparat val visas dagens planering som förval (presentedPlanOf).
    // Innan läraren ändrar i planeringarna låses förvalet fast, så att en
    // ny/kopierad/ändrad planering aldrig i tysthet tar över elevskärmen.
    async function pinDefault() {
      if (!presentedDoc) await present(presentedPlan()?.id ?? null);
    }

    // -- Ämnesväljare (inbyggda + egna, + skapa nytt) --
    // Visar bara MINA ämnen när läraren valt sådana (issue #81), plus
    // planeringens redan valda ämne (t.ex. kopierad från annan lärare) —
    // inget "försvinner". "Visa alla ämnen…" öppnar tillfälligt hela
    // paletten; "Välj mina ämnen…" öppnar dialogen. SO-/NO-delämnena
    // grupperas under sina rubriker (groupedSubjects).
    const ADD_SUBJECT = "__add_subject__";
    const SHOW_ALL = "__show_all__";
    const PICK_MINE = "__pick_mine__";
    function fillSubjectSelect(sel, current) {
      sel.innerHTML = "";
      const visible = showAllSubjects ? subjects : filterSubjects(subjects, mine(), { keep: [current] });
      for (const g of groupedSubjects(visible)) {
        const parent = g.group
          ? Object.assign(document.createElement("optgroup"), { label: g.group.name })
          : sel;
        for (const s of g.subjects) parent.append(new Option(s.name, s.id, false, s.id === current));
        if (parent !== sel) sel.append(parent);
      }
      if (mine() && !showAllSubjects) sel.append(new Option("Visa alla ämnen…", SHOW_ALL));
      sel.append(new Option("+ Eget ämne…", ADD_SUBJECT));
      sel.append(new Option("Välj mina ämnen…", PICK_MINE));
      sel.value = current ?? "";
    }
    function fillSubjectFilter() {
      const cur = filter.subject;
      subjectFilterEl.innerHTML = "";
      subjectFilterEl.append(new Option("Alla ämnen", ""));
      // Mina ämnen + ämnen som faktiskt används av en planering (en
      // kopierad planering med ett annat ämne ska gå att filtrera fram).
      const used = new Set(plans.map((p) => p.subjectId));
      const m = mine();
      for (const s of subjects) {
        if (used.has(s.id) || s.id === cur || (m?.includes(s.id) ?? false)) {
          subjectFilterEl.append(new Option(s.name, s.id));
        }
      }
      subjectFilterEl.value = cur;
    }

    /** "Lägg till i mina ämnen" — visas när planeringens ämne inte är
     *  bland mina (valt via "Visa alla ämnen…" eller kopierat), så att
     *  ett nytt ämne kan läggas till utan att öppna dialogen. */
    function renderSubjectHint() {
      const hintEl = el.querySelector('[data-el="subject-hint"]');
      if (!hintEl) return;
      const p = editingPlan();
      const m = mine();
      const id = p ? normalizePlan(p).subjectId : null;
      const show = !!id && !!m && !m.includes(id);
      hintEl.hidden = !show;
      hintEl.innerHTML = show
        ? `<button type="button" class="btn btn--ghost subject-mine-add" data-act="add-mine"
             title="Ämnet visas alltid för den här planeringen — lägg till det så syns det i alla väljare">
             ${icon("plus", { size: 14 })} Lägg till "${esc(styleFor(id, subjects).name)}" i mina ämnen</button>`
        : "";
    }

    /** Rita om ämnesväljare, ämnesfilter och hinten — utan att röra
     *  textfälten läraren kan stå i (renderEditor förstör fokus). */
    function refreshSubjectUI() {
      const sel = el.querySelector('[data-meta="subjectId"]');
      const p = editingPlan();
      if (sel && p) fillSubjectSelect(sel, normalizePlan(p).subjectId);
      fillSubjectFilter();
      renderSubjectHint();
    }

    async function addCustomSubject() {
      const name = prompt("Namn på ämnet (t.ex. \"Klassråd\"):")?.trim();
      if (!name) return null;
      let color = prompt("Färg som HEX (t.ex. #4e8f72):", "#4e8f72")?.trim();
      if (!color) return null;
      if (!HEX_RE.test(color)) { alert("Ogiltig färg — ange t.ex. #4e8f72."); return null; }
      const id = "eget-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 5);
      const list = [...(settingDoc("subjects")?.value?.list ?? []), { id, name, color }];
      await data.put(settingsPath, { id: "subjects", value: { list } });
      // subjects uppdateras via watch; returnera id direkt så vi kan sätta det
      subjects = mergedSubjects([...(this?._settings ?? []).filter((d) => d.id !== "subjects"), { id: "subjects", value: { list } }]);
      // Ett eget nytt ämne är förstås ett av MINA ämnen (issue #81) —
      // läggs till automatiskt så det inte "försvinner" ur väljaren.
      if (mine()) await saveMine(data, withMine(mine(), id));
      return id;
    }

    // -- Fältredigerare (kryssruta + innehåll) --
    function fieldsHTML(plan) {
      const rows = FIELD_KEYS.map((k) => {
        const part = PARTS.find((p) => p.key === k);
        const on = plan.show[k];
        const val = k === "attGora" ? (plan.fields.attGora ?? []).join("\n") : plan.fields[k];
        const multi = part.kind === "steps" || part.kind === "list";
        const input = multi
          ? `<textarea data-field="${k}" rows="${k === "attGora" ? 4 : 2}" placeholder="En rad per punkt">${esc(val)}</textarea>`
          : `<input type="text" data-field="${k}" value="${esc(val)}" autocomplete="off">`;
        return `<div class="field-edit${on ? "" : " field-edit--off"}" data-fieldwrap="${k}">
          <div class="field-edit__head">
            <label><input type="checkbox" data-show="${k}" ${on ? "checked" : ""}> ${esc(part.label.toUpperCase())}</label>
          </div>
          ${input}
        </div>`;
      });
      // Bra jobbat: kryssrutan + (bara när den är ikryssad) samma redigerare
      // som på morgonskärmen — samma LOKALA lista (issue #112).
      rows.push(`<div class="field-edit${plan.show.praise ? "" : " field-edit--off"}" data-fieldwrap="praise">
        <div class="field-edit__head">
          <label><input type="checkbox" data-show="praise" ${plan.show.praise ? "checked" : ""}> Visa Bra jobbat</label>
        </div>
        <p class="field-edit__hint">Visas i högerkolumnen (delar plats med "När du är klar"). Samma lista som på Morgonskärmen — ändringar syns på båda.</p>
        <div class="field-edit__praise" data-el="praise-editor"${plan.show.praise ? "" : " hidden"}>${praiseEditorHTML()}</div>
      </div>`);
      return rows.join("");
    }

    // -- Widgets (issue #115): kryssrutor + egna inställningar, sparas i planeringen --
    const widgetsUI = mountWidgetSettings(widgetsEl, {
      form: "lesson",
      ctx: { view, classId: activeClass.id, sync },
      get: () => (editingPlan() ? normalizePlan(editingPlan()).widgets : []),
      set: async (widgets) => {
        await patchEditing({ widgets });
        renderPreview();
      },
    });
    this._offs.push(() => widgetsUI.destroy());

    // -- Bra jobbat-redigeraren i fältet (monteras om med fälten) --
    let praiseEditor = null;
    this._offs.push(() => praiseEditor?.destroy());
    function mountFieldPraise() {
      praiseEditor?.destroy();
      praiseEditor = null;
      const root = fieldsEl.querySelector('[data-el="praise-editor"]');
      if (!root) return;
      praiseEditor = mountPraiseEditor(root, {
        // Bara listan skrivs (lokalt) — morgonskärmens övriga inställningar rörs inte.
        edit: (fn) => editPraise({
          data, classId: activeClass.id,
          get: () => ({ praise: praiseItems, weekOf: praiseWeekOf }),
          commit: (next) => data.put(praisePath(activeClass.id), { id: PRAISE_DOC, praise: next.praise, weekOf: next.weekOf }),
        }, fn),
      });
      syncFieldPraise({ students: true });
    }
    function syncFieldPraise({ students: withStudents = false } = {}) {
      if (!praiseEditor) return;
      if (withStudents) praiseEditor.setStudents(students);
      praiseEditor.setPraise(shownPraise());
    }

    // -- Sparade planeringar-lista --
    /** Matchar sök + ämnesfilter (oavsett flik). */
    function matchesFilter(p) {
      const q = filter.q.trim().toLocaleLowerCase("sv");
      return (!filter.subject || p.subjectId === filter.subject) &&
        (!q || searchText(p, subjects).includes(q));
    }
    /** Planeringarna i den valda fliken som matchar sök + filter. */
    function visiblePlans() {
      return plans.filter((p) => tabOf(p) === listTab && matchesFilter(p));
    }

    /** Diskret rad under flikraden vid sökning: "3 träffar i Arkiv" → byt flik. */
    function renderTabHits() {
      if (!filter.q.trim()) { tabHitsEl.hidden = true; tabHitsEl.innerHTML = ""; return; }
      const counts = { week: 0, upcoming: 0, archive: 0 };
      for (const p of plans) if (matchesFilter(p)) counts[tabOf(p)]++;
      const parts = TABS.filter((t) => t !== listTab && counts[t] > 0).map((t) =>
        `<button type="button" class="plan-tab-hits__link" data-goto-tab="${t}">${
          counts[t] === 1 ? "1 träff" : `${counts[t]} träffar`} i ${TAB_LABELS[t]}</button>`);
      tabHitsEl.hidden = parts.length === 0;
      tabHitsEl.innerHTML = parts.join(`<span aria-hidden="true"> · </span>`);
    }

    function rowHTML(p, curId, shownId) {
      const st = styleFor(p.subjectId, subjects);
      const d = parseISO(p.date);
      const t = p.start ? `${p.start}${p.end ? "–" + p.end : ""}` : "";
      const meta = [d ? fmtDay(d) : "", t].filter(Boolean).join(" · ");
      const check = selecting
        ? `<input type="checkbox" class="plan-list__check" tabindex="-1" aria-hidden="true" ${selected.has(p.id) ? "checked" : ""}>`
        : "";
      return `<div class="plan-list__row">
        <button class="plan-list__item" data-plan="${esc(p.id)}" aria-current="${p.id === curId}"${selecting ? ` aria-pressed="${selected.has(p.id)}"` : ""}>
          ${check}
          <span class="plan-list__dot" style="background:${st.color}"></span>
          <span class="plan-list__text">
            <span class="plan-list__name">${esc(p.name)}</span>
            <span class="plan-list__meta">${esc(meta)}</span>
          </span>
          ${p.id === shownId ? `<span class="plan-list__badge" title="Den här planeringen visas på elevskärmen">${icon("monitor", { size: 14 })}Visas nu</span>` : ""}
        </button>
        ${selecting ? "" : `<button class="btn btn--ghost btn--icon plan-list__act" data-copy="${esc(p.id)}" title="Kopiera till samma veckodag framåt" aria-label="Kopiera ${esc(p.name)}">${icon("copy", { size: 16 })}</button>`}
      </div>`;
    }

    function renderList() {
      fillSubjectFilter();
      // Väljs en planering i en annan flik (t.ex. "Gå dit" till Arkiv, eller
      // en kopia till kommande vecka) byter listan flik så att den syns.
      if (revealEditing && editingPlan() && tabOf(editingPlan()) !== listTab) {
        setListTab(tabOf(editingPlan()), { render: false });
      }
      renderTabHits();
      if (plans.length === 0) { listEl.innerHTML = `<p class="field-edit__hint">Inga planeringar ännu — tryck på "Ny planering".</p>`; renderBulk(); return; }
      const vis = visiblePlans();
      if (vis.length === 0) {
        // Tomt läge: kort och neutralt — vid sökning/filter en matchningstext.
        const empty = (filter.q.trim() || filter.subject)
          ? "Inga planeringar matchar sökningen."
          : { week: "Inga planeringar denna vecka.", upcoming: "Inga kommande planeringar.", archive: "Inga planeringar i arkivet." }[listTab];
        listEl.innerHTML = `<p class="field-edit__hint">${empty}</p>`;
        renderBulk();
        return;
      }
      const curId = editingId;
      const shownId = presentedPlan()?.id;
      // Nyaste vecka först (som i Arkiv); i Kommande ligger närmaste vecka först.
      const groups = groupByWeek(vis);
      if (listTab === "upcoming") groups.reverse();
      listEl.innerHTML = groups.map((g) => {
        const allSel = selecting && g.plans.every((p) => selected.has(p.id));
        const check = selecting
          ? `<input type="checkbox" class="plan-week__check" data-week="${esc(g.key)}" ${allSel ? "checked" : ""} aria-label="Markera alla i ${esc(g.label)}">`
          : "";
        return collapsibleHTML({
          key: weekFoldKey(g.key), level: 3, className: "plan-week-fold", lead: check,
          // Datumintervallet döljs när veckan är infälld (plats för antalet).
          title: `${esc(g.name)}${g.range ? `<span class="plan-week__range"> · ${esc(g.range)}</span>` : ""}`,
          body: `<div class="plan-week">${g.plans.map((p) => rowHTML(p, curId, shownId)).join("")}</div>`,
        });
      }).join("");
      folds.init();
      // Den valda planeringens vecka öppnas när planeringen väljs.
      if (revealEditing && editingPlan()) {
        const key = weekFoldKey(weekKeyOf(editingPlan()));
        if (!folds.isOpen(key)) autoOpenWeeks.add(key);
        revealEditing = false;
      }
      const searching = !!filter.q.trim();
      for (const g of groups) {
        const key = weekFoldKey(g.key);
        // Under sökning visas alla träffar (utan att det sparas).
        if (searching || autoOpenWeeks.has(key)) folds.setOpen(key, true);
        folds.setSummary(key, g.plans.length === 1 ? "1 planering" : `${g.plans.length} planeringar`);
      }
      renderBulk();
    }

    function renderSummaries() {
      folds.setSummary("about", aboutSummary(editingPlan(), subjects));
      folds.setSummary("fields", fieldsSummary(editingPlan()));
      folds.setSummary("widgets", lessonWidgetsSummary(editingPlan()));
    }

    function renderBulk() {
      selectBtn.setAttribute("aria-pressed", String(selecting));
      bulkEl.hidden = !selecting;
      if (!selecting) { bulkEl.innerHTML = ""; return; }
      const n = selected.size;
      bulkEl.innerHTML = `
        <span class="plan-bulk__count">${n} markerade</span>
        <button class="btn" data-act="select-all">Markera alla synliga</button>
        <button class="btn" data-act="send-selected" ${n ? "" : "disabled"}>${icon("copy")} Skicka markerade till klass…</button>
        <button class="btn plan-danger" data-act="del-selected" ${n ? "" : "disabled"}>${icon("trash")} Ta bort markerade</button>
        <button class="btn btn--ghost" data-act="select-done">Klar</button>`;
    }

    function renderConfirm() {
      confirmEl.hidden = !pendingDelete;
      if (!pendingDelete) { confirmEl.innerHTML = ""; return; }
      const docs = pendingDelete.map((id) => plans.find((p) => p.id === id)).filter(Boolean);
      const what = docs.length === 1 ? `planeringen "${esc(docs[0].name)}"` : `${docs.length} planeringar`;
      confirmEl.innerHTML = `
        <p>Ta bort ${what}? Det går inte att ångra.</p>
        <div class="btn-row">
          <button class="btn plan-danger" data-act="confirm-del">${icon("trash")} Ja, ta bort</button>
          <button class="btn" data-act="cancel-del">Avbryt</button>
        </div>`;
      confirmEl.querySelector('[data-act="cancel-del"]').focus();
    }

    let statusTimer = 0;
    // `action` = { act, label } — en knapp i statusraden (t.ex. "Öppna i 4B").
    // Raden står då kvar lite längre så att läraren hinner trycka.
    function flash(msg, action = null) {
      statusEl.textContent = msg;
      if (action) {
        statusEl.insertAdjacentHTML("beforeend", ` <button type="button" class="plan-status__act" data-act="${esc(action.act)}">${esc(action.label)}</button>`);
      }
      statusEl.hidden = false;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { statusEl.hidden = true; }, action ? 12000 : 5000);
    }
    this._offs.push(() => clearTimeout(statusTimer));

    // Förhandsvisningen visar planeringen som REDIGERAS — inte nödvändigtvis
    // den som eleverna ser (förhandsramens etikett säger vilken).
    function renderPreview() {
      if (!stageEl.isConnected) return;
      const p = editingPlan();
      if (p) renderBoard(stageEl, p, subjects, praise(), chipHost);
      else { chipHost.destroy(); stageEl.innerHTML = `<div class="lesson-empty"><h1>Ingen planering</h1><p>Skapa en ny planering för att börja.</p></div>`; }
      renderPresentState();
      renderSummaries();
    }

    // Förhandsmarkeringen (issue #82 + #88): när den öppna planeringen INTE
    // är den som visas för eleverna får tavlan den streckade ramen med
    // etiketten "Förhandsvisning · Eleverna ser: … · Gå dit". Visas exakt
    // samma sak finns ingenting ovanför eller på tavlan — panelens gröna
    // status och "Visas nu"-brickan i listan räcker (ingen statusrad, #88).
    function renderPresentState() {
      const p = editingPlan();
      const shown = presentedPlan();
      const sameId = (p?.id ?? null) === (shown?.id ?? null);
      stageEl.classList.toggle("lesson__stage--preview", !!p && !sameId);
      stageEl.querySelector(".lesson-preview-tag")?.remove();
      updateSpot();
      if (sameId) return;
      const seen = shown
        ? `Eleverna ser: <strong>${esc(shown.name || "Namnlös planering")}</strong><span aria-hidden="true"> · </span>
           <button type="button" class="lesson-preview-tag__jump" data-act="goto-presented"
             title="Öppna planeringen som eleverna ser (${esc(planLabel(shown))})">Gå dit</button>`
        : `Eleverna ser: <strong>ingen planering</strong>`;
      if (p) {
        stageEl.querySelector(".lb-fit")?.insertAdjacentHTML("beforeend",
          `<div class="lesson-preview-tag teacher-only" aria-live="polite">Förhandsvisning<span aria-hidden="true"> · </span>${seen}</div>`);
      } else {
        // Tomläge ("Ingen planering"): samma information som en vanlig rad.
        stageEl.querySelector(".lesson-empty")?.insertAdjacentHTML("beforeend",
          `<p class="lesson-empty__seen teacher-only">${seen}</p>`);
      }
    }
    observeStage(stageEl);

    // "Gå dit" i förhandsramens etikett — öppna planeringen som eleverna ser.
    stageEl.addEventListener("click", (e) => {
      if (!e.target.closest('[data-act="goto-presented"]')) return;
      const p = presentedPlan();
      if (p) { setEditing(p.id); renderAll(); }
    });

    // Bygger om redigerarens fält. ANROPA BARA när den aktiva
    // planeringen byter identitet — annars förstörs fältet läraren
    // just skriver i (fokus tappas). Innehållsredigering styr sina
    // egna inputs; watch:en rör dem inte.
    let editorFor = Symbol("none");
    function renderEditor() {
      const p = editingPlan();
      const disabled = !p;
      for (const inp of metaInputs()) inp.disabled = disabled;
      editorFor = p?.id ?? null;
      if (!p) { fieldsEl.innerHTML = ""; widgetsEl.innerHTML = ""; mountFieldPraise(); return; }
      const np = normalizePlan(p);
      el.querySelector('[data-meta="name"]').value = np.name;
      el.querySelector('[data-meta="date"]').value = np.date;
      el.querySelector('[data-meta="start"]').value = np.start;
      el.querySelector('[data-meta="end"]').value = np.end;
      fillSubjectSelect(el.querySelector('[data-meta="subjectId"]'), np.subjectId);
      renderSubjectHint();
      fieldsEl.innerHTML = fieldsHTML(np);
      mountFieldPraise();
      widgetsUI.render();
    }
    function syncEditor() {
      if ((editingPlan()?.id ?? null) !== editorFor) renderEditor();
    }

    function renderAll() {
      renderList();
      renderEditor();
      renderPreview();
    }

    // -- Skriv en deländring till planeringen som redigeras --
    async function patchEditing(partial) {
      const p = editingPlan();
      if (!p) return;
      await pinDefault();
      await data.patch(plansPath, p.id, partial);
    }

    // -- Skapa / kopiera / ta bort --
    async function createPlan() {
      await pinDefault();
      const id = await data.put(plansPath, normalizePlan({ name: "Ny planering", date: todayISO(), ownerUid: currentUid() }));
      setEditing(id);
      renderAll();
      // "Ny planering" öppnar "Om lektionen" (utan att spara läget) och fokuserar Namn.
      folds.setOpen("about", true);
      const name = el.querySelector('[data-meta="name"]');
      name.focus();
      name.select();
    }

    async function copyPlan(src) {
      if (!src) return;
      const copy = normalizePlan(src);
      delete copy.id;
      copy.widgets = copyLessonWidgets(copy.widgets);
      copy.ownerUid = currentUid();
      copy.date = nextSameWeekday(copy.date);
      if (copy.date === src.date) copy.name = `${copy.name} (kopia)`;
      await pinDefault();
      const id = await data.put(plansPath, copy);
      setEditing(id);
      renderAll();
      const d = parseISO(copy.date);
      flash(`Kopierad till ${d ? fmtDay(d) : copy.date} — byt datum under "Om lektionen" om det behövs`);
    }

    // -- Skicka kopia till klass (issue #103) --
    // Kopian hamnar i en ANNAN klass (js/lib/send-plan.js); läraren står
    // kvar i sin klass och sin planering. "Öppna i 4B" i statusraden byter
    // klass och öppnar kopian i redigeraren.
    let lastSent = null; // { cid, id } — målet för "Öppna i …"
    async function sendPlans(list) {
      if (!list.length) return;
      const result = await openSendPlanDialog({
        data, currentCid: activeClass.id, plans: list.map(normalizePlan), subjects, now: serverNow(),
      });
      if (!result) return;
      const { cid, className, ids, copies } = result;
      // Vid flera öppnar "Öppna i …" den tidigaste kopian.
      const first = copies.map((c, i) => ({ c, id: ids[i] })).sort((a, b) =>
        (a.c.date ?? "").localeCompare(b.c.date ?? "") || (a.c.start ?? "").localeCompare(b.c.start ?? ""))[0];
      lastSent = { cid, id: first.id };
      let msg;
      if (copies.length === 1) {
        const c = copies[0];
        const d = parseISO(c.date);
        const t = c.start ? `${c.start}${c.end ? "–" + c.end : ""}` : "";
        // "Kopia skickad till 4B · tis 29 sep. 10:10–11:00"
        const when = [d ? fmtDay(d) : c.date, t].filter(Boolean).join(" ");
        msg = `Kopia skickad till ${className}${when ? ` · ${when}` : ""}`;
      } else {
        msg = `${copies.length} kopior skickade till ${className}`;
      }
      flash(msg, { act: "open-sent", label: `Öppna i ${className}` });
    }
    function openSent() {
      if (!lastSent) return;
      setEditingPlanId(lastSent.cid, lastSent.id);
      setActiveClass(store, lastSent.cid); // klassbytet monterar om läget
    }

    async function removePlans(ids) {
      // Tas den visade planeringen bort blir elevskärmen tom ("Ingen
      // planering visas") — den byter aldrig i tysthet till en annan.
      if (ids.includes(presentedPlan()?.id)) await present(null);
      else await pinDefault();
      for (const id of ids) {
        await data.remove(plansPath, id);
        selected.delete(id);
      }
      if (ids.includes(editingId)) setEditing(null);
      pendingDelete = null;
      renderConfirm();
      flash(ids.length === 1 ? "Planeringen togs bort." : `${ids.length} planeringar togs bort.`);
      renderAll();
    }

    // ---- Händelser (event delegation på panelen) ----

    panel.addEventListener("click", async (e) => {
      const hit = e.target.closest("[data-goto-tab]");
      if (hit) { setListTab(hit.dataset.gotoTab); return; }

      const copyBtn = e.target.closest("[data-copy]");
      if (copyBtn) { await copyPlan(plans.find((p) => p.id === copyBtn.dataset.copy)); return; }

      const planBtn = e.target.closest("[data-plan]");
      if (planBtn) {
        const id = planBtn.dataset.plan;
        if (selecting) {
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          renderList();
          return;
        }
        setEditing(id);
        renderAll();
        return;
      }

      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "new") await createPlan();
      else if (act === "class-action") {
        // Den öppna planeringen förväljs som lektion (issue #34); utan
        // datum → den pågående lektionen enligt schemat.
        const p = editingPlan();
        void openClassActionDialog({
          data, cid: activeClass.id,
          lesson: p?.date ? { date: p.date, start: p.start ?? null, end: p.end ?? null, subjectId: p.subjectId ?? null, title: p.name ?? "" } : undefined,
        });
      }
      else if (act === "add-mine") {
        // "Lägg till i mina ämnen" — kvickvägen (issue #81), utan dialogen.
        const p = editingPlan();
        const id = p ? normalizePlan(p).subjectId : null;
        if (id && mine()) await saveMine(data, withMine(mine(), id));
      }
      else if (act === "dup") await copyPlan(editingPlan());
      else if (act === "send") { const p = editingPlan(); if (p) await sendPlans([p]); }
      else if (act === "open-sent") openSent();
      else if (act === "del") {
        const p = editingPlan();
        if (!p) return;
        pendingDelete = [p.id];
        renderConfirm();
      } else if (act === "select") {
        selecting = !selecting;
        selected.clear();
        pendingDelete = null;
        renderConfirm();
        renderList();
      } else if (act === "select-all") {
        for (const p of visiblePlans()) selected.add(p.id);
        renderList();
      } else if (act === "select-done") {
        selecting = false;
        selected.clear();
        renderList();
      } else if (act === "send-selected") {
        if (!selected.size) return;
        await sendPlans(sortedPlans().filter((p) => selected.has(p.id)));
      } else if (act === "del-selected") {
        if (!selected.size) return;
        pendingDelete = [...selected];
        renderConfirm();
      } else if (act === "confirm-del") {
        if (pendingDelete?.length) await removePlans(pendingDelete);
      } else if (act === "cancel-del") {
        pendingDelete = null;
        renderConfirm();
      }
    });

    // Metadata (namn/datum/tid/ämne), kryssrutor och filter
    panel.addEventListener("change", async (e) => {
      const weekKey = e.target.dataset.week;
      if (weekKey !== undefined && selecting) {
        const inWeek = visiblePlans().filter((p) => {
          const d = parseISO(p.date);
          return (d ? isoLocal(mondayOf(d)) : "") === weekKey;
        });
        for (const p of inWeek) { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); }
        renderList();
        return;
      }
      if (e.target.dataset.filter === "subject") { filter.subject = e.target.value; renderList(); return; }

      const metaKey = e.target.dataset.meta;
      if (metaKey === "subjectId" && e.target.value === ADD_SUBJECT) {
        const id = await addCustomSubject.call(this);
        const p = editingPlan();
        // återställ eller sätt nytt ämne
        e.target.value = id ?? (p ? normalizePlan(p).subjectId : "");
        if (id) await patchEditing({ subjectId: id });
        renderAll();
        return;
      }
      if (metaKey === "subjectId" && e.target.value === SHOW_ALL) {
        // Visa tillfälligt alla ämnen — planeringens ämne rörs inte.
        showAllSubjects = true;
        const p = editingPlan();
        fillSubjectSelect(e.target, p ? normalizePlan(p).subjectId : "");
        return;
      }
      if (metaKey === "subjectId" && e.target.value === PICK_MINE) {
        const p = editingPlan();
        e.target.value = p ? normalizePlan(p).subjectId : "";
        await openMySubjectsDialog({ data, subjects, mine: mine() });
        // myDoc uppdateras via watch → refreshSubjectUI ritar om väljarna.
        return;
      }
      if (metaKey === "subjectId") {
        await patchEditing({ subjectId: e.target.value });
        renderList(); renderPreview(); renderSubjectHint();
        return;
      }
      if (metaKey) { await patchEditing({ [metaKey]: e.target.value }); renderList(); renderPreview(); return; }

      const showKey = e.target.dataset.show;
      if (showKey) {
        const p = editingPlan();
        if (!p) return;
        const show = { ...normalizePlan(p).show, [showKey]: e.target.checked };
        await patchEditing({ show });
        e.target.closest("[data-fieldwrap]")?.classList.toggle("field-edit--off", !e.target.checked);
        if (showKey === "praise") {
          const editor = fieldsEl.querySelector('[data-el="praise-editor"]');
          if (editor) editor.hidden = !e.target.checked;
        }
        renderPreview();
      }
    });

    // Fältinnehåll + sök — live medan man skriver
    panel.addEventListener("input", async (e) => {
      if (e.target.dataset.filter === "q") { filter.q = e.target.value; renderList(); return; }

      const metaKey = e.target.dataset.meta;
      if (metaKey === "name") { await patchEditing({ name: e.target.value }); renderList(); renderSummaries(); return; }

      const fieldKey = e.target.dataset.field;
      if (!fieldKey) return;
      const p = editingPlan();
      if (!p) return;
      const fields = { ...normalizePlan(p).fields };
      fields[fieldKey] = fieldKey === "attGora"
        ? e.target.value.split("\n")
        : e.target.value;
      await patchEditing({ fields });
      renderPreview();
    });

    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pendingDelete) { pendingDelete = null; renderConfirm(); }
    });

    // ---- Watchers: håll listan/förhandsvisningen live ----
    // (även vid ändringar från elevfönster/annan flik via storage-event)
    const refreshPraise = () => {
      syncFieldPraise();
      renderPreview();
    };

    // OBS: den gamla DELADE settings/lektion → activePlanId läses inte
    // längre (issue #39) — vad eleverna ser är privat per lärare.
    this._offs.push(data.watch(settingsPath, (docs) => {
      applySharedSettings.call(this, docs);
      refreshPraise();
    }));
    watchStudents(() => { syncFieldPraise({ students: true }); refreshPraise(); });
    watchPraise(refreshPraise);
    // Mina ämnen (issue #81) — lärarens privata val, kan ändras från
    // dialogen här, från Översikt › Inställningar eller en annan enhet.
    this._offs.push(data.watch(mySubjectsPath(), (docs) => {
      myDoc = docs.find((d) => d.id === MY_SUBJECTS_DOC) ?? null;
      refreshSubjectUI();
    }));
    // Visas för eleverna — även ändringar från lärarens andra fönster
    // (och elevskärmspanelens "Visa på elevskärm" via onPresent).
    watchPresented(() => { renderList(); renderPresentState(); });
    tickUntilChosen(() => { renderList(); renderPresentState(); });

    this._offs.push(data.watch(plansPath, async (docs) => {
      plans = docs;
      // (Ingen auto-seed av testplaneringar längre: planeringarna är
      // PRIVATA per lärare — varje ny lärare/enhet fick annars fem
      // fejkplaneringar skapade i sitt namn. En ny lärare börjar tomt.)
      // Redigeraren behöver en planering: flikens senaste, annars den som
      // visas, annars den första. (Bara UI — ingenting skrivs.)
      if (!editingPlan()) {
        const saved = getEditingPlanId(activeClass.id);
        const pick = plans.find((p) => p.id === saved) ?? presentedPlan() ?? sortedPlans()[0];
        if (pick) setEditing(pick.id, { reveal: false });
      }
      // Planeringar som försvunnit (t.ex. borttagna i en annan flik) kan inte vara markerade.
      for (const id of [...selected]) if (!plans.some((p) => p.id === id)) selected.delete(id);
      // Rör INTE redigerarens inputs på varje tangenttryck — bara när
      // aktiv planering bytt identitet. Lista + tavla ritas alltid om.
      renderList();
      syncEditor();
      renderPreview();
    }));
  },

  async unmount() {
    for (const off of this._offs ?? []) { try { off(); } catch { /* noop */ } }
    this._offs = [];
  },
};
