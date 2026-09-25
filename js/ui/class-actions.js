/**
 * KLASSÅTGÄRDER — dialoger och lista (issue #34). ENDAST LÄRARVY.
 *
 * Används av Översikt, Statistik, Trafikljusur (direkt efter ett sparat
 * pass) och Lektionsplanering (den pågående/öppna lektionen förväljs).
 *
 *  - openClassActionDialog(): ny/ändra klassåtgärd
 *  - openReplyDialog():       "Testade också" med eget utfall
 *  - renderClassActionList(): kort med utfall, lärare, lektion och
 *                             lektionens klasstatistik bredvid
 *  - handleClassActionClick(): delegerad klickhantering för listan
 *
 * Dialogerna ligger i ett eget lager på <body> (inte i lägets markup), så
 * en datadriven omritning när en annan lärare sparar något kan aldrig
 * tömma en halvskriven text. Lagret är märkt .teacher-only och öppnas
 * aldrig i ett elevfönster.
 *
 * SÄKERHET: allt från andra lärare (text, egen kategori, lärarnamn) är
 * osäker indata och escapas vid varje rendering.
 *
 * NAMNSPÄRR: innan något sparas prövas texten (och en egen kategori)
 * mot den här datorns lokala elevlistor. Träff → inget sparas, namnet
 * markeras och läraren ombeds skriva om. Se js/lib/class-actions.js.
 */

import { icon } from "../lib/icons.js";
import { attribution, currentUid, plansPath } from "../data/plans.js";
import { serverNow } from "../lib/clock.js";
import { fmtWhen, lessonLabel, mergedSubjects, fmtMMSS } from "../lib/trafikljus-stats.js";
import { escapeHtml, currentLessonBlock, teacherLabel, noteTypeById, noteStatsPath } from "../modes/elever/shared.js";
import {
  classActionsPath, classActionRepliesPath, OUTCOMES, outcomeById, CATEGORIES, categoryLabel,
  TEXT_MAX, REPLY_MAX, CATEGORY_MAX, buildActionDoc, buildReplyDoc, findStudentNames,
  highlightSegments, lessonChoices, lessonKey, lessonTime, lessonStatsFor,
} from "../lib/class-actions.js";

export const NAME_BLOCK_MESSAGE =
  "Klassåtgärder delas med alla lärare — skriv om utan elevnamn (t.ex. 'några elever').";

const CUSTOM = "__egen";

const isStudentWindow = () =>
  document.documentElement.dataset.theme === "student" || location.hash.startsWith("#/elev");

// ---- Hjälpare ----

/** Förnamnen i ALLA lokala elevlistor på den här datorn (issue #32). */
export async function localStudentNames(data) {
  const paths = (await data.collections("classes/")).filter((p) => /^classes\/[^/]+\/students$/.test(p));
  const names = [];
  for (const p of paths) for (const s of await data.list(p)) if (s.firstName) names.push(s.firstName);
  return names;
}

/** "Matematik tis 10:15" (äldre veckor: "Matematik tis 15 sep 10:15"). */
export function lessonTitle(lesson, subjects) {
  if (!lesson) return "";
  const name = lessonLabel(lesson, subjects) || "Lektion";
  if (!lesson.start) {
    const d = new Date(`${lesson.date}T12:00:00`);
    return `${name} ${d.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "")}`;
  }
  return `${name} ${fmtWhen(lessonTime(lesson, 0))}`;
}

export const outcomeBadge = (id, { small = false } = {}) => {
  const o = outcomeById(id);
  return `<span class="ca-badge${small ? " ca-badge--s" : ""}" data-outcome="${o.id}">${icon(o.icon)}<span>${escapeHtml(o.label)}</span></span>`;
};

const outcomeRadios = (name, selected) => `
  <fieldset class="ca-outcomes">
    <legend>Hur gick det?</legend>
    ${OUTCOMES.map((o) => `
      <label class="ca-outcome" data-outcome="${o.id}">
        <input type="radio" name="${name}" value="${o.id}"${o.id === selected ? " checked" : ""}>
        ${icon(o.icon)}<span>${escapeHtml(o.label)}</span>
      </label>`).join("")}
  </fieldset>`;

const highlighted = (text, hits) =>
  highlightSegments(text, hits).map((s) => (s.hit ? `<mark>${escapeHtml(s.text)}</mark>` : escapeHtml(s.text))).join("");

// ---- Modal-lagret ----

let current = null;

export function closeClassActionDialog() {
  if (!current) return;
  window.removeEventListener("keydown", current.onKey, true);
  window.removeEventListener("hashchange", current.onHash);
  current.root.remove();
  current = null;
}

function openModal(html) {
  closeClassActionDialog();
  const root = document.createElement("div");
  root.className = "ca-modal teacher-only";
  root.innerHTML = html;
  document.body.append(root);
  // Dialogen äger tangenterna: lägenas genvägar (mellanslag = start/stopp i
  // Trafikljusur, 1–7, F9 …) får aldrig slå igenom medan läraren skriver.
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeClassActionDialog(); return; }
    if (root.contains(e.target)) e.stopPropagation();
  };
  // Byter fönstret till elevvy stängs dialogen direkt (spärren).
  const onHash = () => { if (isStudentWindow()) closeClassActionDialog(); };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("hashchange", onHash);
  root.addEventListener("mousedown", (e) => { if (e.target === root) closeClassActionDialog(); });
  current = { root, onKey, onHash };
  return root;
}

/**
 * Kör namnspärren över fälten. Träff → visa blocket, returnera false.
 * fields: [{ label, value }]
 */
function nameBlock(blockEl, names, fields) {
  const found = fields
    .map((f) => ({ ...f, hits: findStudentNames(f.value, names) }))
    .filter((f) => f.hits.length);
  if (!found.length) { blockEl.hidden = true; blockEl.innerHTML = ""; return true; }
  const uniq = [...new Set(found.flatMap((f) => f.hits.map((h) => h.name)))];
  blockEl.innerHTML = `
    <p class="ca-block__msg">${icon("shield")}<span>${escapeHtml(NAME_BLOCK_MESSAGE)}</span></p>
    <p class="ca-block__found">Hittade ${uniq.length === 1 ? "ett elevnamn" : "elevnamn"}:
      ${uniq.map((n) => `<mark>${escapeHtml(n)}</mark>`).join(" ")}</p>
    ${found.map((f) => `<p class="ca-block__text"><span class="ca-block__label">${escapeHtml(f.label)}:</span> ${highlighted(f.value, f.hits)}</p>`).join("")}`;
  blockEl.hidden = false;
  return false;
}

// ---- Ny / ändra klassåtgärd ----

/**
 * openClassActionDialog({ data, cid, action?, lesson? })
 *  action: befintlig post att ändra (bara den egna — kontrolleras här).
 *  lesson: förvald lektions-snapshot. undefined → pågående lektion
 *          (currentLessonBlock); null → ingen förvald.
 * Returnerar ett Promise som löses när dialogen stängts.
 */
export async function openClassActionDialog({ data, cid, action = null, lesson } = {}) {
  if (!cid || isStudentWindow()) return;
  if (action && action.createdBy !== currentUid()) return; // bara upphovspersonen ändrar

  const [names, plans, noteStats, sessions, settingsDocs, running] = await Promise.all([
    localStudentNames(data),
    data.list(plansPath(cid)),
    data.list(noteStatsPath(cid)),
    data.list(`classes/${cid}/sessions`),
    data.list(`classes/${cid}/settings`),
    lesson === undefined && !action ? currentLessonBlock(data, cid) : Promise.resolve(null),
  ]);
  const subjects = mergedSubjects(settingsDocs);
  const preset = action ? action.lesson ?? null : lesson === undefined ? running : lesson;
  const choices = lessonChoices({ current: preset, plans, noteStats, sessions, now: serverNow() });
  const presetKey = lessonKey(preset);

  const cat = action?.category ?? "";
  const isPreset = !cat || CATEGORIES.some((c) => c.id === cat);

  const root = openModal(`
    <form class="ca-dialog" role="dialog" aria-modal="true" aria-labelledby="ca-dialog-title" novalidate>
      <h2 id="ca-dialog-title">${icon("bulb")} ${action ? "Ändra klassåtgärd" : "Ny klassåtgärd"}</h2>
      <p class="ca-dialog__lead">Delas med alla lärare i klassen. Skriv om <strong>klassen</strong> — aldrig om en enskild elev.</p>
      <label class="ca-field">
        <span>Vad testade ni, och hur gick det?</span>
        <textarea name="text" rows="4" maxlength="${TEXT_MAX}" required
          placeholder="T.ex. Testade att låta dem arbeta i par i stället för enskilt — det blev betydligt lugnare.">${escapeHtml(action?.text ?? "")}</textarea>
        <span class="ca-count" aria-live="polite"></span>
      </label>
      ${outcomeRadios("outcome", action?.outcome ?? null)}
      <div class="ca-row">
        <label class="ca-field">
          <span>Kategori (valfri)</span>
          <select name="category">
            <option value="">Ingen kategori</option>
            ${CATEGORIES.map((c) => `<option value="${c.id}"${c.id === cat ? " selected" : ""}>${escapeHtml(c.label)}${c.hint ? ` (${escapeHtml(c.hint)})` : ""}</option>`).join("")}
            <option value="${CUSTOM}"${!isPreset ? " selected" : ""}>Egen kategori…</option>
          </select>
          <input type="text" name="customCategory" maxlength="${CATEGORY_MAX}" placeholder="Egen kategori"
            value="${isPreset ? "" : escapeHtml(cat)}"${isPreset ? " hidden" : ""} aria-label="Egen kategori">
        </label>
        <label class="ca-field">
          <span>Lektion</span>
          <select name="lesson">
            <option value="">Ingen lektion</option>
            ${choices.map((l, i) => `<option value="${i}"${lessonKey(l) === presetKey ? " selected" : ""}>${escapeHtml(lessonTitle(l, subjects))}${running && lessonKey(l) === lessonKey(running) ? " (pågår)" : ""}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="ca-block" role="alert" hidden></div>
      <p class="ca-error" role="alert" hidden></p>
      <div class="ca-actions">
        <button class="btn" type="button" data-cancel>Avbryt</button>
        <button class="btn btn--primary" type="submit">${icon(action ? "save" : "check")}<span>${action ? "Spara ändringen" : "Dela med lärarna"}</span></button>
      </div>
    </form>`);

  const form = root.querySelector("form");
  const textEl = form.elements.text;
  const catEl = form.elements.category;
  const customEl = form.elements.customCategory;
  const countEl = form.querySelector(".ca-count");
  const blockEl = form.querySelector(".ca-block");
  const errorEl = form.querySelector(".ca-error");
  let blocked = false; // efter en spärr prövas texten live tills den är ren

  const fields = () => [
    { label: "Texten", value: textEl.value },
    ...(catEl.value === CUSTOM ? [{ label: "Kategorin", value: customEl.value }] : []),
  ];
  const updateCount = () => { countEl.textContent = `${textEl.value.length}/${TEXT_MAX}`; };
  updateCount();
  form.addEventListener("input", () => {
    updateCount();
    if (blocked) blocked = !nameBlock(blockEl, names, fields());
  });
  catEl.addEventListener("change", () => {
    customEl.hidden = catEl.value !== CUSTOM;
    if (!customEl.hidden) customEl.focus();
    if (blocked) blocked = !nameBlock(blockEl, names, fields());
  });
  form.querySelector("[data-cancel]").addEventListener("click", closeClassActionDialog);

  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    errorEl.hidden = true;
    // NAMNSPÄRREN — texten delas, så ett elevnamn stoppar sparandet helt.
    if (!nameBlock(blockEl, names, fields())) { blocked = true; textEl.focus(); return; }
    let doc;
    try {
      doc = buildActionDoc({
        text: textEl.value,
        outcome: form.elements.outcome.value,
        category: catEl.value === CUSTOM ? customEl.value : catEl.value,
        lesson: form.elements.lesson.value === "" ? null : choices[Number(form.elements.lesson.value)],
      });
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      return;
    }
    busy = true;
    try {
      await data.put(classActionsPath(cid), {
        ...(action ? { id: action.id, createdAt: action.createdAt } : {}),
        ...doc,
        ...attribution(),
      });
      closeClassActionDialog();
    } catch (err) {
      busy = false;
      errorEl.textContent = `Kunde inte spara: ${err?.message ?? err}`;
      errorEl.hidden = false;
    }
  });
  textEl.focus();
}

// ---- "Testade också" ----

export async function openReplyDialog({ data, cid, action }) {
  if (!cid || !action || isStudentWindow()) return;
  const names = await localStudentNames(data);
  const root = openModal(`
    <form class="ca-dialog" role="dialog" aria-modal="true" aria-labelledby="ca-dialog-title" novalidate>
      <h2 id="ca-dialog-title">${icon("reply")} Testade också</h2>
      <blockquote class="ca-quote">
        <p>${outcomeBadge(action.outcome, { small: true })} <strong>${escapeHtml(teacherLabel(action))}</strong></p>
        <p>${escapeHtml(action.text)}</p>
      </blockquote>
      ${outcomeRadios("outcome", null)}
      <label class="ca-field">
        <span>Kort kommentar (valfri)</span>
        <textarea name="text" rows="2" maxlength="${REPLY_MAX}" placeholder="T.ex. Funkade på NO också, men bara första halvtimmen."></textarea>
        <span class="ca-count" aria-live="polite"></span>
      </label>
      <div class="ca-block" role="alert" hidden></div>
      <p class="ca-error" role="alert" hidden></p>
      <div class="ca-actions">
        <button class="btn" type="button" data-cancel>Avbryt</button>
        <button class="btn btn--primary" type="submit">${icon("check")}<span>Dela svaret</span></button>
      </div>
    </form>`);
  const form = root.querySelector("form");
  const textEl = form.elements.text;
  const countEl = form.querySelector(".ca-count");
  const blockEl = form.querySelector(".ca-block");
  const errorEl = form.querySelector(".ca-error");
  let blocked = false;
  const updateCount = () => { countEl.textContent = `${textEl.value.length}/${REPLY_MAX}`; };
  updateCount();
  form.addEventListener("input", () => {
    updateCount();
    if (blocked) blocked = !nameBlock(blockEl, names, [{ label: "Svaret", value: textEl.value }]);
  });
  form.querySelector("[data-cancel]").addEventListener("click", closeClassActionDialog);
  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    errorEl.hidden = true;
    if (!nameBlock(blockEl, names, [{ label: "Svaret", value: textEl.value }])) { blocked = true; textEl.focus(); return; }
    let doc;
    try {
      doc = buildReplyDoc({ actionId: action.id, text: textEl.value, outcome: form.elements.outcome.value });
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      return;
    }
    busy = true;
    await data.put(classActionRepliesPath(cid), { ...doc, ...attribution() });
    closeClassActionDialog();
  });
  form.querySelector("input[name=outcome]").focus();
}

// ---- Borttagning ----

/** Ta bort en EGEN klassåtgärd och dess svar. Åtgärden först: reglerna
 *  tillåter att andras svar städas bort först när åtgärden är borta. */
export async function deleteClassAction(data, cid, action, replies) {
  if (!action || action.createdBy !== currentUid()) return false;
  await data.remove(classActionsPath(cid), action.id);
  for (const r of replies.filter((x) => x.actionId === action.id)) {
    await data.remove(classActionRepliesPath(cid), r.id);
  }
  return true;
}

// ---- Listan ----

/** "Vid lektionen: 6 prat · 2 ur stol (snitt för Matematik: 11) · trafikljus ● 2:10" */
function statsLine(action, index, subjects) {
  const st = lessonStatsFor(action, index);
  if (!st) return "";
  const subject = subjects.find((s) => s.id === action.lesson.subjectId)?.name ?? "ämnet";
  const round = (n) => (Math.round(n * 10) / 10).toLocaleString("sv-SE");
  const parts = [];
  const types = st.byType.map((t) => `${t.n} ${(noteTypeById(t.typeId)?.name ?? "annat").toLocaleLowerCase("sv")}`).join(" · ");
  parts.push(escapeHtml(st.neg ? types : "inga noteringar"));
  if (st.subjectAvg != null && st.subjectLessons > 1) {
    parts[0] += ` <span class="ca-soft">(snitt för ${escapeHtml(subject)}: ${round(st.subjectAvg)} noteringar)</span>`;
  }
  if (st.positive) parts.push(`${st.positive} positiva`);
  if (st.passes.length) {
    parts.push(`trafikljus ${st.passes.map((p) =>
      `<span class="tl-dot" data-phase="${escapeHtml(p.result.color)}"></span> ${fmtMMSS((p.result.durationSec ?? 0) * 1000)}`).join(", ")}`);
  }
  let trend = "";
  if (action.lesson.subjectId && (st.before.lessons || st.after.lessons)) {
    const side = (x, label) => (x.lessons
      ? `${label} ${round(x.avg)} noteringar per lektion <span class="ca-soft">(${x.lessons} ${x.lessons === 1 ? "lektion" : "lektioner"})</span>`
      : `${label} <span class="ca-soft">inga lektioner${x === st.after ? " ännu" : ""}</span>`);
    trend = `<p class="ca-item__trend">${icon("chart")}<span>${escapeHtml(subject)}:
      ${side(st.before, "veckan före")} → ${side(st.after, "veckan efter")}</span></p>`;
  }
  return `<p class="ca-item__stats">${icon("calendar")}<span>Vid lektionen: ${parts.join(" · ")}</span></p>${trend}`;
}

/**
 * Listans HTML. actions: redan filtrerade, sorteras här (nyast först).
 * opts: { replies, index (lessonIndex), subjects, limit, empty }
 */
export function renderClassActionList(actions, { replies = [], index = new Map(), subjects = [], limit = Infinity, empty = "Inga klassåtgärder ännu." } = {}) {
  const uid = currentUid();
  const sorted = [...actions].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  if (!sorted.length) return `<p class="ca-empty">${escapeHtml(empty)}</p>`;
  const shown = sorted.slice(0, limit);
  const byAction = new Map();
  for (const r of [...replies].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
    if (!byAction.has(r.actionId)) byAction.set(r.actionId, []);
    byAction.get(r.actionId).push(r);
  }
  return `<ul class="ca-list teacher-only">
    ${shown.map((a) => {
      const mine = a.createdBy === uid;
      const rs = byAction.get(a.id) ?? [];
      const when = a.lesson ? lessonTitle(a.lesson, subjects) : fmtWhen(a.createdAt ?? 0);
      return `<li class="ca-item" data-outcome="${escapeHtml(outcomeById(a.outcome).id)}">
        <div class="ca-item__head">
          ${outcomeBadge(a.outcome)}
          <strong class="ca-item__who">${escapeHtml(teacherLabel(a))}</strong>
          <span class="ca-item__when">${escapeHtml(when)}</span>
          ${a.category ? `<span class="chip ca-chip">${escapeHtml(categoryLabel(a.category))}</span>` : ""}
          ${mine ? `<span class="ca-item__own">
            <button type="button" class="btn btn--ghost btn--icon" data-ca-edit="${escapeHtml(a.id)}" title="Ändra" aria-label="Ändra klassåtgärden">${icon("pencil")}</button>
            <button type="button" class="btn btn--ghost btn--icon" data-ca-del="${escapeHtml(a.id)}" title="Ta bort" aria-label="Ta bort klassåtgärden">${icon("trash")}</button>
          </span>` : ""}
        </div>
        <p class="ca-item__text">${escapeHtml(a.text)}</p>
        ${statsLine(a, index, subjects)}
        ${rs.length ? `<ul class="ca-replies" aria-label="Svar">
          ${rs.map((r) => `<li class="ca-reply">
            ${outcomeBadge(r.outcome, { small: true })}
            <strong>${escapeHtml(teacherLabel(r))}</strong>
            <span class="ca-reply__text">${r.text ? escapeHtml(r.text) : `<span class="ca-soft">testade också</span>`}</span>
            ${r.createdBy === uid ? `<button type="button" class="btn btn--ghost btn--icon ca-reply__del" data-ca-reply-del="${escapeHtml(r.id)}" title="Ta bort mitt svar" aria-label="Ta bort mitt svar">${icon("x")}</button>` : ""}
          </li>`).join("")}
        </ul>` : ""}
        ${mine ? "" : `<button type="button" class="btn btn--ghost ca-item__reply" data-ca-reply="${escapeHtml(a.id)}">${icon("reply")}<span>Testade också</span></button>`}
      </li>`;
    }).join("")}
  </ul>
  ${sorted.length > shown.length ? `<p class="ca-more">${sorted.length - shown.length} äldre i listan.</p>` : ""}`;
}

/** "＋ Klassåtgärd"-knappen (ikon, ingen emoji). */
export const addButton = (extra = "") =>
  `<button type="button" class="btn ca-add teacher-only${extra ? ` ${extra}` : ""}" data-ca-new>${icon("plus")}<span>Klassåtgärd</span></button>`;

/**
 * Delegerad klickhantering. ctx: { data, cid, actions, replies, lesson? }
 * Returnerar true om klicket gällde klassåtgärderna.
 */
export function handleClassActionClick(e, { data, cid, actions, replies, lesson }) {
  const t = e.target.closest("[data-ca-new],[data-ca-edit],[data-ca-del],[data-ca-reply],[data-ca-reply-del]");
  if (!t) return false;
  const find = (id) => actions.find((a) => a.id === id);
  if (t.hasAttribute("data-ca-new")) {
    void openClassActionDialog({ data, cid, lesson });
  } else if (t.dataset.caEdit) {
    void openClassActionDialog({ data, cid, action: find(t.dataset.caEdit) });
  } else if (t.dataset.caDel) {
    const a = find(t.dataset.caDel);
    if (a && confirm("Ta bort klassåtgärden? Svaren från andra lärare tas också bort.")) {
      void deleteClassAction(data, cid, a, replies);
    }
  } else if (t.dataset.caReply) {
    void openReplyDialog({ data, cid, action: find(t.dataset.caReply) });
  } else if (t.dataset.caReplyDel) {
    const r = replies.find((x) => x.id === t.dataset.caReplyDel);
    if (r && r.createdBy === currentUid() && confirm("Ta bort ditt svar?")) {
      void data.remove(classActionRepliesPath(cid), r.id);
    }
  }
  return true;
}
