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
 * - Spara/hämta: namngivna planeringar per klass + datum, duplicera,
 *   lista. En sparad lektion öppnas med exakt samma kryssval.
 * - Ämnesfärg + automatisk läsbar text (luminans, js/lib/color.js);
 *   läraren kan lägga till egna ämnen/färger utan oläslig text.
 * - Elevvyn visar planeringen ren (inga kontroller), synkad via
 *   datalagret (settings.activePlanId + planeringens innehåll).
 *
 * Kontrakt: docs/MODULKONTRAKT.md. Data: DATAMODELL.md
 * (classes/{id}/lessonPlans, classes/{id}/settings).
 */

import { icon } from "../lib/icons.js";
import { readableTextColor, SUBJECTS } from "../lib/color.js";

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
const todayISO = () => new Date().toISOString().slice(0, 10);

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

function boardHTML(rawPlan, subjects) {
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
  const rightCol = show.narKlar
    ? `<div class="lb-col lb-col--right">${fieldHTML(part("narKlar"), plan)}</div>`
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
   TESTDATA — byggs in så det syns direkt att allt fungerar.
   Fält som saknas i en lektion lämnas okryssade → visar reflow.
   ============================================================ */

function seedPlans() {
  const on = (...keys) => {
    const s = { subject: true, time: true, vad: false, hur: false, varfor: false, attGora: false, narKlar: false, duBehover: false, mal: false };
    for (const k of keys) s[k] = true;
    return s;
  };
  return [
    {
      name: "SO – Demokrati", subjectId: "so", start: "13:30", end: "14:30",
      fields: {
        vad: "Demokrati", hur: "Filmserie", varfor: "Träna på demokrati",
        attGora: ["Toa / drick vatten / tyst läsning / ritbok", "Samling", "\"Om Sverige var en diktatur?\"-serie", "Elevråd (Kayden får ordet)", "Avslut"],
        narKlar: "", duBehover: "", mal: "Lära mer om demokrati.",
      },
      show: on("vad", "hur", "varfor", "attGora", "mal"),
    },
    {
      name: "Matte – Talsorter", subjectId: "ma", start: "08:30", end: "09:20",
      fields: {
        vad: "Talsorter", hur: "Mattebok + häfte", varfor: "Träna på de olika talsorterna",
        attGora: ["Genomgång", "Sidorna 14–15 i matteboken (skriv i räknehäftet)", "Avslut"],
        narKlar: "Matteboken sid 32–33", duBehover: "Mattebok + häfte", mal: "",
      },
      show: on("vad", "hur", "varfor", "attGora", "narKlar", "duBehover"),
    },
    {
      name: "SO – Grej of the week", subjectId: "so", start: "09:50", end: "10:40",
      fields: {
        vad: "Grej", hur: "Genomgång / diskussion / skriva", varfor: "",
        attGora: ["Tyst läsning", "Grej of the week-gissningar", "Genomgång", "Bild + tavla", "Skriva i egen bok", "Klistermärken"],
        narKlar: "Tyst läsning / ritbok", duBehover: "", mal: "",
      },
      show: on("vad", "hur", "attGora", "narKlar"),
    },
    {
      name: "Matte – Talsorter (dator)", subjectId: "ma", start: "11:40", end: "12:40",
      fields: {
        vad: "Talsorter", hur: "Dator", varfor: "",
        attGora: ["Samling", "Röstning", "Magma övning 2", "Plocka ihop + klistermärken"],
        narKlar: "Magma extra 1", duBehover: "Dator", mal: "",
      },
      show: on("vad", "hur", "attGora", "narKlar", "duBehover"),
    },
    {
      name: "SO – Lilla Aktuellt", subjectId: "so", start: "08:00", end: "08:40",
      fields: {
        vad: "Lilla Aktuellt", hur: "Lilla Aktuellt på projektor", varfor: "Se vad som händer i världen",
        attGora: ["Lilla Aktuellt", "Svara på frågor", "Rörelse"],
        narKlar: "", duBehover: "", mal: "",
      },
      show: on("vad", "hur", "varfor", "attGora"),
    },
  ].map((p) => ({ ...p, date: todayISO() }));
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
    const plansPath = `${base}/lessonPlans`;
    const settingsPath = `${base}/settings`;

    let plans = [];
    let subjects = SUBJECTS;
    let activeId = null;
    let seeded = false;

    const settingDoc = (id) => this._settings?.find((d) => d.id === id) ?? null;

    const activePlan = () => plans.find((p) => p.id === activeId) ?? plans[0] ?? null;

    const sortedPlans = () =>
      [...plans].sort((a, b) =>
        (a.date ?? "").localeCompare(b.date ?? "") ||
        (a.start ?? "").localeCompare(b.start ?? "") ||
        (a.name ?? "").localeCompare(b.name ?? "", "sv"));

    // ---------- ELEVVY: bara tavlan, synkad ----------
    if (view === "student") {
      el.innerHTML = `<div class="lesson-stage-student"></div>`;
      const stage = el.querySelector(".lesson-stage-student");
      const renderStudent = () => {
        const p = activePlan();
        stage.innerHTML = p
          ? `<div class="lb-fit">${boardHTML(p, subjects)}</div>`
          : `<div class="lesson-empty"><h1>Ingen planering vald</h1><p>Läraren väljer en lektion att visa.</p></div>`;
      };
      this._offs.push(data.watch(plansPath, (docs) => { plans = docs; renderStudent(); }));
      this._offs.push(data.watch(settingsPath, (docs) => {
        this._settings = docs;
        subjects = mergedSubjects(docs);
        activeId = settingDoc("lektion")?.value?.activePlanId ?? activeId;
        renderStudent();
      }));
      return;
    }

    // ---------- LÄRARVY: panel + levande förhandsvisning ----------
    el.innerHTML = `
      <div class="lesson">
        <aside class="lesson-panel teacher-only">
          <section class="lesson-panel__group">
            <h2>Planeringar</h2>
            <div class="btn-row">
              <button class="btn btn--primary" data-act="new">${icon("plus")} Ny</button>
              <button class="btn" data-act="dup">${icon("copy")} Duplicera</button>
              <button class="btn" data-act="del">${icon("trash")} Ta bort</button>
            </div>
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
    const metaInputs = () => [...el.querySelectorAll("[data-meta]")];

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
      return FIELD_KEYS.map((k) => {
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
      }).join("");
    }

    // -- Sparade planeringar-lista --
    function renderList() {
      const list = sortedPlans();
      if (list.length === 0) { listEl.innerHTML = `<p class="field-edit__hint">Inga planeringar ännu.</p>`; return; }
      listEl.innerHTML = list.map((p) => {
        const st = styleFor(p.subjectId, subjects);
        const cur = p.id === (activePlan()?.id);
        const t = p.start ? `${p.start}${p.end ? "–" + p.end : ""}` : "";
        return `<button class="plan-list__item" data-plan="${esc(p.id)}" aria-current="${cur}">
          <span class="plan-list__dot" style="background:${st.color}"></span>
          <span class="plan-list__name">${esc(p.name)}</span>
          <span class="plan-list__meta">${esc(p.date ?? "")}${t ? " · " + esc(t) : ""}</span>
        </button>`;
      }).join("");
    }

    function renderPreview() {
      const p = activePlan();
      stageEl.innerHTML = p
        ? `<div class="lb-fit">${boardHTML(p, subjects)}</div>`
        : `<div class="lesson-empty"><h1>Ingen planering</h1><p>Skapa en ny planering för att börja.</p></div>`;
    }

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

    // ---- Händelser (event delegation på panelen) ----
    const panel = el.querySelector(".lesson-panel");

    panel.addEventListener("click", async (e) => {
      const planBtn = e.target.closest("[data-plan]");
      if (planBtn) { await setActive(planBtn.dataset.plan); renderAll(); return; }

      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "new") {
        const id = await data.put(plansPath, normalizePlan({ name: "Ny planering", date: todayISO() }));
        await setActive(id);
        renderAll();
      } else if (act === "dup") {
        const p = activePlan();
        if (!p) return;
        const copy = normalizePlan(p);
        delete copy.id;
        copy.name = `${copy.name} (kopia)`;
        const id = await data.put(plansPath, copy);
        await setActive(id);
        renderAll();
      } else if (act === "del") {
        const p = activePlan();
        if (!p) return;
        if (!confirm(`Ta bort planeringen "${p.name}"?`)) return;
        await data.remove(plansPath, p.id);
        activeId = null;
        renderAll();
      }
    });

    // Metadata (namn/datum/tid/ämne)
    panel.addEventListener("change", async (e) => {
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

    // Fältinnehåll — live medan man skriver
    panel.addEventListener("input", async (e) => {
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

    // ---- Watchers: håll listan/förhandsvisningen live ----
    // (även vid ändringar från elevfönster/annan flik via storage-event)
    this._offs.push(data.watch(settingsPath, (docs) => {
      this._settings = docs;
      subjects = mergedSubjects(docs);
      const savedActive = settingDoc("lektion")?.value?.activePlanId;
      if (savedActive) activeId = savedActive;
    }));

    this._offs.push(data.watch(plansPath, async (docs) => {
      plans = docs;
      // Första gången: seeda testdata om klassen saknar planeringar
      if (docs.length === 0 && !seeded) {
        seeded = true;
        for (const p of seedPlans()) await data.put(plansPath, normalizePlan(p));
        return; // watch kör igen med de nya
      }
      if (!activeId || !plans.some((p) => p.id === activeId)) {
        const first = sortedPlans()[0];
        if (first) { activeId = first.id; void setActive(first.id); }
      }
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
