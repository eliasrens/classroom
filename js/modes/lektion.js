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
 * - Tavlans text skalas mot tavlans bredd och krymps stegvis BARA när
 *   innehållet inte ryms (fitBoard) — tavlan scrollar aldrig.
 * - Valfri "Bra jobbat"-ruta i högerkolumnen (show.praise), samma
 *   komponent och data som morgonskärmen (js/ui/praise-board.js,
 *   classes/{id}/settings/morningScreen → praise).
 * - Ämnesfärg + automatisk läsbar text (luminans, js/lib/color.js);
 *   läraren kan lägga till egna ämnen/färger utan oläslig text.
 * - Elevvyn visar planeringen ren (inga kontroller), synkad via
 *   datalagret (settings.activePlanId + planeringens innehåll).
 *
 * Kontrakt: docs/MODULKONTRAKT.md. Data: DATAMODELL.md.
 * Planeringar är PRIVATA per lärare (teachers/{uid}/classes/{id}/lessonPlans,
 * se js/data/plans.js); inställningar delas (classes/{id}/settings).
 */

import { icon } from "../lib/icons.js";
import { readableTextColor, SUBJECTS } from "../lib/color.js";
import { plansPath as plansPathFor, currentUid } from "../data/plans.js";
import { createPraiseBoard } from "../ui/praise-board.js";
import { normalize as normalizeMorning, MORNING_KEY } from "../lib/morning.js";
import { studentLabel } from "../lib/names.js";
import { serverNow } from "../lib/clock.js";

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
    top = `<div class="lb-top">${subjEl}${timeEl || `<span></span>`}</div>`;
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

  return `<div class="lesson-board" style="--subj:${st.color};--subj-ink:${st.textColor}">
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
 */
function renderBoard(container, rawPlan, subjects, praise) {
  const plan = normalizePlan(rawPlan);
  const withPraise = plan.show.praise && (praise.names.length > 0 || !!praise.emptyText);
  container.innerHTML = `<div class="lb-fit">${boardHTML(plan, subjects, { praise: withPraise })}</div>`;
  const fitEl = container.firstElementChild;
  const slot = fitEl.querySelector(".lb-praise-slot");
  if (slot) {
    slot.append(praise.board.el);
    praise.board.setNames(praise.names, { emptyText: praise.emptyText });
  }
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

/** [{ key, label, plans }] — veckor nyast först, inom veckan dag + tid stigande. */
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
    let label = "Utan datum";
    if (key) {
      const mon = parseISO(key);
      const diff = Math.round((mon - thisMonday) / (7 * 86400000));
      const rel = { 0: "denna vecka", 1: "nästa vecka", [-1]: "förra veckan" }[diff];
      label = `Vecka ${isoWeek(mon)}${rel ? ` · ${rel}` : ""} · ${fmtShort(mon)}–${fmtShort(addDays(mon, 6))}`;
    }
    const plans = groups.get(key).sort((a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") ||
      (a.start ?? "").localeCompare(b.start ?? "") ||
      (a.name ?? "").localeCompare(b.name ?? "", "sv"));
    return { key, label, plans };
  });
}

/* ============================================================
   MODEN
   ============================================================ */

export default {
  id: "lektion",
  title: "Lektionsplanering",
  icon: "book",

  async mount(el, ctx) {
    this._offs = [];
    const { data, activeClass, view } = ctx;

    if (!activeClass) {
      el.innerHTML = `<div class="lesson-empty">
        ${icon("book", { size: 40, strokeWidth: 1.4 })}
        <h1>Lektionsplanering</h1>
        <p>Välj en klass i topbaren för att planera lektioner.</p>
      </div>`;
      return;
    }

    const base = `classes/${activeClass.id}`;
    // Planeringar är PRIVATA per lärare (teachers/{uid}/…), se data/plans.js.
    // Inställningar (aktiv planering, ämnen, Bra jobbat) ligger kvar i den DELADE klassnoden.
    const plansPath = plansPathFor(activeClass.id);
    const settingsPath = `${base}/settings`;
    const isTeacher = view !== "student";

    let plans = [];
    let subjects = SUBJECTS;
    let activeId = null;

    // "Bra jobbat"-namnen: samma delade data som morgonskärmen.
    let praiseItems = [];
    let students = [];
    let initials = false;

    const settingDoc = (id) => this._settings?.find((d) => d.id === id) ?? null;

    const activePlan = () => plans.find((p) => p.id === activeId) ?? plans[0] ?? null;

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

    function praiseNames() {
      return praiseItems.map((p) => {
        if (p.kind === "free") return p.text;
        const s = students.find((x) => x.id === p.studentId);
        return s ? studentLabel(s, { initials }) : null;
      }).filter(Boolean);
    }
    const praise = () => ({
      board: praiseBoard,
      names: praiseNames(),
      // Elevvyn visar aldrig en tom ruta; läraren får en ledtråd i förhandsvisningen.
      emptyText: isTeacher ? "Inga namn ännu — kryssa i elever på Morgonskärmen" : "",
    });

    function applySharedSettings(docs) {
      this._settings = docs;
      subjects = mergedSubjects(docs);
      praiseItems = normalizeMorning(docs.find((d) => d.id === MORNING_KEY)?.value).praise;
      initials = docs.find((d) => d.id === "display")?.value?.nameDisplay === "initials";
    }

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
        const p = activePlan();
        if (p) renderBoard(stage, p, subjects, praise());
        else stage.innerHTML = `<div class="lesson-empty"><h1>Ingen planering vald</h1><p>Läraren väljer en lektion att visa.</p></div>`;
      };
      observeStage(stage);
      this._offs.push(data.watch(plansPath, (docs) => { plans = docs; renderStudent(); }));
      this._offs.push(data.watch(settingsPath, (docs) => {
        applySharedSettings.call(this, docs);
        activeId = settingDoc("lektion")?.value?.activePlanId ?? activeId;
        renderStudent();
      }));
      watchStudents(renderStudent);
      return;
    }

    // ---------- LÄRARVY: panel + levande förhandsvisning ----------
    el.innerHTML = `
      <div class="lesson">
        <aside class="lesson-panel teacher-only">
          <section class="lesson-panel__group">
            <h2>Planeringar</h2>
            <div class="btn-row">
              <button class="btn btn--primary" data-act="new">${icon("plus")} Ny planering</button>
              <button class="btn" data-act="dup" title="Kopiera den valda planeringen till samma veckodag, idag eller framåt">${icon("copy")} Kopiera</button>
              <button class="btn" data-act="del" title="Ta bort den valda planeringen">${icon("trash")} Ta bort</button>
              <button class="btn" data-act="select" aria-pressed="false" title="Markera flera planeringar och ta bort dem på en gång">${icon("check")} Välj flera</button>
            </div>
            <div class="plan-filter">
              <label class="plan-filter__search">${icon("search", { size: 16 })}
                <input type="search" data-filter="q" placeholder="Sök namn eller innehåll" aria-label="Sök planering" autocomplete="off">
              </label>
              <select data-filter="subject" aria-label="Filtrera på ämne"></select>
            </div>
            <div class="plan-bulk" data-el="bulk" hidden></div>
            <div class="plan-confirm" data-el="confirm" role="alertdialog" aria-live="assertive" hidden></div>
            <p class="plan-status" data-el="status" aria-live="polite" hidden></p>
            <div class="plan-list" data-el="list"></div>
          </section>

          <section class="lesson-panel__group">
            <h2>Om lektionen</h2>
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
            <div class="row-2">
              <label class="field-label">Start
                <input type="time" data-meta="start">
              </label>
              <label class="field-label">Slut
                <input type="time" data-meta="end">
              </label>
            </div>
          </section>

          <section class="lesson-panel__group">
            <h2>Fält</h2>
            <p class="field-edit__hint">Kryssrutan slår av/på fältet på tavlan — layouten omfördelar sig automatiskt. Valen sparas med planeringen.</p>
            <div data-el="fields"></div>
          </section>
        </aside>

        <div class="lesson__stage" data-el="stage"></div>
      </div>`;

    const listEl = el.querySelector('[data-el="list"]');
    const fieldsEl = el.querySelector('[data-el="fields"]');
    const stageEl = el.querySelector('[data-el="stage"]');
    const bulkEl = el.querySelector('[data-el="bulk"]');
    const confirmEl = el.querySelector('[data-el="confirm"]');
    const statusEl = el.querySelector('[data-el="status"]');
    const subjectFilterEl = el.querySelector('[data-filter="subject"]');
    const selectBtn = el.querySelector('[data-act="select"]');
    const metaInputs = () => [...el.querySelectorAll("[data-meta]")];

    // Listans vy-tillstånd (inte data — sparas inte)
    const filter = { q: "", subject: "" };
    let selecting = false;
    const selected = new Set();
    let pendingDelete = null; // [ids] som väntar på bekräftelse

    // -- Persistens av valet av aktiv planering (delas med elevvyn) --
    async function setActive(id) {
      activeId = id;
      await data.put(settingsPath, { id: "lektion", value: { activePlanId: id } });
    }

    // -- Ämnesväljare (inbyggda + egna, + skapa nytt) --
    const ADD_SUBJECT = "__add_subject__";
    function fillSubjectSelect(sel, current) {
      sel.innerHTML = "";
      for (const s of subjects) sel.append(new Option(s.name, s.id, false, s.id === current));
      sel.append(new Option("+ Eget ämne…", ADD_SUBJECT));
      sel.value = current ?? "";
    }
    function fillSubjectFilter() {
      const cur = filter.subject;
      subjectFilterEl.innerHTML = "";
      subjectFilterEl.append(new Option("Alla ämnen", ""));
      const used = new Set(plans.map((p) => p.subjectId));
      for (const s of subjects) if (used.has(s.id) || s.id === cur) subjectFilterEl.append(new Option(s.name, s.id));
      subjectFilterEl.value = cur;
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
      // Bra jobbat: bara en kryssruta — namnen väljs på morgonskärmen (delad data).
      const n = praiseNames().length;
      rows.push(`<div class="field-edit${plan.show.praise ? "" : " field-edit--off"}" data-fieldwrap="praise">
        <div class="field-edit__head">
          <label><input type="checkbox" data-show="praise" ${plan.show.praise ? "checked" : ""}> Visa Bra jobbat</label>
        </div>
        <p class="field-edit__hint" data-el="praise-hint">${praiseHint(n)}</p>
      </div>`);
      return rows.join("");
    }
    function praiseHint(n) {
      const count = n === 0 ? "Inga namn just nu" : n === 1 ? "1 namn just nu" : `${n} namn just nu`;
      return `Visas i högerkolumnen (delar plats med "När du är klar"). Samma namn som på Morgonskärmen — ${count}.`;
    }

    // -- Sparade planeringar-lista --
    function visiblePlans() {
      const q = filter.q.trim().toLocaleLowerCase("sv");
      return plans.filter((p) =>
        (!filter.subject || p.subjectId === filter.subject) &&
        (!q || searchText(p, subjects).includes(q)));
    }

    function rowHTML(p, curId) {
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
        </button>
        ${selecting ? "" : `<button class="btn btn--ghost btn--icon plan-list__act" data-copy="${esc(p.id)}" title="Kopiera till samma veckodag framåt" aria-label="Kopiera ${esc(p.name)}">${icon("copy", { size: 16 })}</button>`}
      </div>`;
    }

    function renderList() {
      fillSubjectFilter();
      if (plans.length === 0) { listEl.innerHTML = `<p class="field-edit__hint">Inga planeringar ännu — tryck på "Ny planering".</p>`; renderBulk(); return; }
      const vis = visiblePlans();
      if (vis.length === 0) { listEl.innerHTML = `<p class="field-edit__hint">Inga planeringar matchar sökningen.</p>`; renderBulk(); return; }
      const curId = activePlan()?.id;
      listEl.innerHTML = groupByWeek(vis).map((g) => {
        const allSel = selecting && g.plans.every((p) => selected.has(p.id));
        const head = selecting
          ? `<label class="plan-week__head"><input type="checkbox" data-week="${esc(g.key)}" ${allSel ? "checked" : ""}> ${esc(g.label)}</label>`
          : `<div class="plan-week__head">${esc(g.label)}</div>`;
        return `<div class="plan-week" data-weekgroup="${esc(g.key)}">${head}${g.plans.map((p) => rowHTML(p, curId)).join("")}</div>`;
      }).join("");
      renderBulk();
    }

    function renderBulk() {
      selectBtn.setAttribute("aria-pressed", String(selecting));
      bulkEl.hidden = !selecting;
      if (!selecting) { bulkEl.innerHTML = ""; return; }
      const n = selected.size;
      bulkEl.innerHTML = `
        <span class="plan-bulk__count">${n} markerade</span>
        <button class="btn" data-act="select-all">Markera alla synliga</button>
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
    function flash(msg) {
      statusEl.textContent = msg;
      statusEl.hidden = false;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { statusEl.hidden = true; }, 5000);
    }
    this._offs.push(() => clearTimeout(statusTimer));

    function renderPreview() {
      if (!stageEl.isConnected) return;
      const p = activePlan();
      if (p) renderBoard(stageEl, p, subjects, praise());
      else stageEl.innerHTML = `<div class="lesson-empty"><h1>Ingen planering</h1><p>Skapa en ny planering för att börja.</p></div>`;
    }
    observeStage(stageEl);

    // Bygger om redigerarens fält. ANROPA BARA när den aktiva
    // planeringen byter identitet — annars förstörs fältet läraren
    // just skriver i (fokus tappas). Innehållsredigering styr sina
    // egna inputs; watch:en rör dem inte.
    let editorFor = Symbol("none");
    function renderEditor() {
      const p = activePlan();
      const disabled = !p;
      for (const inp of metaInputs()) inp.disabled = disabled;
      editorFor = p?.id ?? null;
      if (!p) { fieldsEl.innerHTML = ""; return; }
      const np = normalizePlan(p);
      el.querySelector('[data-meta="name"]').value = np.name;
      el.querySelector('[data-meta="date"]').value = np.date;
      el.querySelector('[data-meta="start"]').value = np.start;
      el.querySelector('[data-meta="end"]').value = np.end;
      fillSubjectSelect(el.querySelector('[data-meta="subjectId"]'), np.subjectId);
      fieldsEl.innerHTML = fieldsHTML(np);
    }
    function syncEditor() {
      if ((activePlan()?.id ?? null) !== editorFor) renderEditor();
    }

    function renderAll() {
      renderList();
      renderEditor();
      renderPreview();
    }

    // -- Skriv en deländring till den aktiva planeringen --
    async function patchActive(partial) {
      const p = activePlan();
      if (!p) return;
      await data.patch(plansPath, p.id, partial);
    }

    // -- Skapa / kopiera / ta bort --
    async function createPlan() {
      const id = await data.put(plansPath, normalizePlan({ name: "Ny planering", date: todayISO(), ownerUid: currentUid() }));
      await setActive(id);
      renderAll();
      const name = el.querySelector('[data-meta="name"]');
      name.focus();
      name.select();
    }

    async function copyPlan(src) {
      if (!src) return;
      const copy = normalizePlan(src);
      delete copy.id;
      copy.ownerUid = currentUid();
      copy.date = nextSameWeekday(copy.date);
      if (copy.date === src.date) copy.name = `${copy.name} (kopia)`;
      const id = await data.put(plansPath, copy);
      await setActive(id);
      renderAll();
      const d = parseISO(copy.date);
      flash(`Kopierad till ${d ? fmtDay(d) : copy.date} — byt datum under "Om lektionen" om det behövs`);
    }

    async function removePlans(ids) {
      for (const id of ids) {
        await data.remove(plansPath, id);
        selected.delete(id);
      }
      if (ids.includes(activeId)) activeId = null;
      pendingDelete = null;
      renderConfirm();
      flash(ids.length === 1 ? "Planeringen togs bort." : `${ids.length} planeringar togs bort.`);
      renderAll();
    }

    // ---- Händelser (event delegation på panelen) ----
    const panel = el.querySelector(".lesson-panel");

    panel.addEventListener("click", async (e) => {
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
        await setActive(id);
        renderAll();
        return;
      }

      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "new") await createPlan();
      else if (act === "dup") await copyPlan(activePlan());
      else if (act === "del") {
        const p = activePlan();
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
        const p = activePlan();
        // återställ eller sätt nytt ämne
        e.target.value = id ?? (p ? normalizePlan(p).subjectId : "");
        if (id) await patchActive({ subjectId: id });
        renderAll();
        return;
      }
      if (metaKey) { await patchActive({ [metaKey]: e.target.value }); renderList(); renderPreview(); return; }

      const showKey = e.target.dataset.show;
      if (showKey) {
        const p = activePlan();
        if (!p) return;
        const show = { ...normalizePlan(p).show, [showKey]: e.target.checked };
        await patchActive({ show });
        e.target.closest("[data-fieldwrap]")?.classList.toggle("field-edit--off", !e.target.checked);
        renderPreview();
      }
    });

    // Fältinnehåll + sök — live medan man skriver
    panel.addEventListener("input", async (e) => {
      if (e.target.dataset.filter === "q") { filter.q = e.target.value; renderList(); return; }

      const metaKey = e.target.dataset.meta;
      if (metaKey === "name") { await patchActive({ name: e.target.value }); renderList(); return; }

      const fieldKey = e.target.dataset.field;
      if (!fieldKey) return;
      const p = activePlan();
      if (!p) return;
      const fields = { ...normalizePlan(p).fields };
      fields[fieldKey] = fieldKey === "attGora"
        ? e.target.value.split("\n")
        : e.target.value;
      await patchActive({ fields });
      renderPreview();
    });

    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pendingDelete) { pendingDelete = null; renderConfirm(); }
    });

    // ---- Watchers: håll listan/förhandsvisningen live ----
    // (även vid ändringar från elevfönster/annan flik via storage-event)
    const refreshPraise = () => {
      const hint = fieldsEl.querySelector('[data-el="praise-hint"]');
      if (hint) hint.textContent = praiseHint(praiseNames().length);
      renderPreview();
    };

    this._offs.push(data.watch(settingsPath, (docs) => {
      applySharedSettings.call(this, docs);
      const savedActive = settingDoc("lektion")?.value?.activePlanId;
      if (savedActive) activeId = savedActive;
      refreshPraise();
    }));
    watchStudents(refreshPraise);

    this._offs.push(data.watch(plansPath, async (docs) => {
      plans = docs;
      // (Ingen auto-seed av testplaneringar längre: planeringarna är
      // PRIVATA per lärare — varje ny lärare/enhet fick annars fem
      // fejkplaneringar skapade i sitt namn. En ny lärare börjar tomt.)
      if (!activeId || !plans.some((p) => p.id === activeId)) {
        const first = sortedPlans()[0];
        if (first) { activeId = first.id; void setActive(first.id); }
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
