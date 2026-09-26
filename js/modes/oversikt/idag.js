/**
 * ÖVERSIKT › IDAG / DENNA VECKA (issue #45 — tidigare hela Översikten).
 *
 * Den lugna startvyn: hälsning, välj klass, välj läge, veckans siffror
 * (rena varje måndag — tidigare veckor under fliken Veckor), de senaste
 * klassåtgärderna och dagens egna lektionsplaneringar. Genväg till
 * mentorstiden (Veckans övergångar) när det är dags.
 */

import { icon } from "../../lib/icons.js";
import { navOrder } from "../registry.js";
import { SUBJECTS } from "../../lib/color.js";
import { setActiveClass } from "../../ui/class-picker.js";
import { plansPath as plansPathFor, setEditingPlanId } from "../../data/plans.js";
import { createClass } from "../../data/classes.js";
import { startOfWeek, inWeek, weekLabel, weekRangeLabel } from "../../lib/week.js";
import { KIND_KEYS, KINDS, computeStats, mergedSubjects } from "../../lib/trafikljus-stats.js";
import { PRAISE_DOC, praisePath, normalize as normalizeMorning, currentPraise } from "../../lib/morning.js";
import { noteStatsPath } from "../elever/shared.js";
import { serverNow } from "../../lib/clock.js";
import { isMentorTime } from "../../lib/week-recap.js";
import { classActionsPath, classActionRepliesPath, lessonIndex } from "../../lib/class-actions.js";
import { renderClassActionList, handleClassActionClick, addButton } from "../../ui/class-actions.js";
import { esc } from "./shared.js";

const OV_ACTIONS = 3; // senaste klassåtgärderna här (alla under fliken Klassåtgärder)

const todayISO = (d = new Date(serverNow())) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Lugn hälsning efter tid på dygnet (saklig, ingen emoji). */
function greeting(d = new Date(serverNow())) {
  const h = d.getHours();
  if (h < 10) return "God morgon";
  if (h < 13) return "God förmiddag";
  if (h < 17) return "God eftermiddag";
  return "God kväll";
}

const fmtLongDate = (d = new Date(serverNow())) =>
  d.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });

/** Ämnesfärg (inbyggda + lärarens egna) för en planeringsprick. */
function subjectColor(subjectId, settingsDocs) {
  const custom = settingsDocs.find((d) => d.id === "subjects")?.value?.list ?? [];
  const all = [...SUBJECTS, ...custom.filter((s) => s?.id && s?.color)];
  const s = all.find((x) => x.id === subjectId);
  return s?.color ?? "var(--color-ink-soft)";
}

export function mountIdag(el, { data, store, tabHref }) {
  const offs = [];
  let classes = [];
  let plans = [];
  let settingsDocs = [];
  let noteStats = [];      // klassens anonyma streck (moln, issue #32)
  let praiseBoard = null;  // lokala Bra jobbat-listan
  let sessions = [];
  let actions = [];        // klassåtgärder (moln, delade — issue #34)
  let replies = [];
  const activeId = () => store.get().classId ?? null;

  // ---- Klassbyte från startvyn (persistas + speglas till elevskärm) ----
  function chooseClass(id) {
    setActiveClass(store, id);
    // classId-ändring remountar läget (router) → hela vyn ritas om.
  }

  async function addClass() {
    const name = prompt("Klassens namn (t.ex. 4A):")?.trim();
    if (!name) return;
    // Dubblettsäkert: samma namn återanvänder befintlig klass (data/classes.js).
    const id = await createClass(data, name);
    chooseClass(id);
  }

  function goMode(id) { location.hash = `#/${id}`; }

  // Öppnar planeringen i redigeraren — ändrar INTE vad elevskärmen
  // visar (det gör bara "Visa för eleverna", issue #39).
  function openPlan(planId) {
    const cid = activeId();
    if (!cid) return;
    setEditingPlanId(cid, planId);
    goMode("lektion");
  }

  // ---- Veckans siffror (veckorytm: bara innevarande vecka) ----
  // Klassnivå ur molnets anonyma streck (noteStats) — Bra jobbat ur
  // den lokala listan (issue #32).
  function weekSection(cls) {
    if (!cls) return "";
    const ws = startOfWeek();
    const weekStats = noteStats.filter((n) => inWeek(n.createdAt ?? 0, ws));
    const typ = weekStats.filter((n) => (n.kind ?? "typ") === "typ");
    const neg = typ.filter((n) => !n.positive).length;
    const praise = currentPraise(normalizeMorning({ praise: praiseBoard?.praise, weekOf: praiseBoard?.weekOf }));
    const tile = (n, label) =>
      `<li class="stat-tile"><span class="stat-tile__n">${n}</span><span class="stat-tile__l">${esc(label)}</span></li>`;
    return `
      <section class="ov-section ov-week" aria-label="Den här veckan">
        <h2 class="ov-section__title">${icon("chart")} Den här veckan · ${esc(weekLabel(ws))} · ${esc(weekRangeLabel(ws))}</h2>
        <ul class="stat-tiles">
          ${tile(neg, "noteringar")}
          ${tile(typ.length - neg, "positiva")}
          ${KIND_KEYS.map((k) => {
            const { weekTotal, counts } = computeStats(sessions, k, { weekStart: ws });
            return tile(weekTotal, `pass ${KINDS[k].label.toLowerCase()} (${counts.green} gröna)`);
          }).join("")}
          ${tile(praise.length, "Bra jobbat")}
        </ul>
        <p class="ov-week__foot">Siffrorna börjar om varje måndag.
          <a class="ov-link" href="${tabHref("veckor")}">Tidigare veckor, veckomål och trender finns under Veckor.</a></p>
      </section>`;
  }

  // ---- Klassåtgärder (issue #34): de senaste, delade mellan lärarna ----
  function actionSection(cls) {
    if (!cls) return "";
    return `
      <section class="ov-section ca-section teacher-only" aria-label="Senaste klassåtgärderna">
        <div class="ca-section__head">
          <h2 class="ov-section__title">${icon("bulb")} Senaste klassåtgärderna</h2>
          ${addButton()}
        </div>
        ${renderClassActionList(actions, {
          replies, index: lessonIndex(noteStats, sessions), subjects: mergedSubjects(settingsDocs), limit: OV_ACTIONS,
          empty: "Inga klassåtgärder ännu. Testade ni ett nytt arbetssätt? Dela hur det gick med de andra lärarna.",
        })}
        <p class="ov-week__foot">Delas med alla lärare — om klassen, aldrig om enskilda elever.
          <a class="ov-link" href="${tabHref("atgarder")}">Alla klassåtgärder, med filter per lärare och vecka.</a></p>
      </section>`;
  }

  // ---- Rendering ----
  function render() {
    const cid = activeId();
    const cls = classes.find((c) => c.id === cid) ?? null;
    const todaysPlans = plans
      .filter((p) => (p.date ?? "") === todayISO())
      .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") ||
        (a.name ?? "").localeCompare(b.name ?? "", "sv"));

    el.innerHTML = `
      <header class="ov-hero">
        <p class="ov-hero__kicker">${esc(fmtLongDate())}</p>
        <h1 class="ov-hero__title">${greeting()}.</h1>
        <p class="ov-hero__sub">${cls
          ? `Vald klass: <strong>${esc(cls.name)}</strong>. Välj ett läge nedan.`
          : `Välj en klass för att komma igång.`}</p>
        ${cls && isMentorTime() ? `
        <button class="btn btn--ghost ov-mentor" data-mode="vecka">${icon("star")}
          <span>Mentorstid? Visa veckans övergångar</span></button>` : ""}
      </header>

      <section class="ov-section" aria-label="Klass">
        <h2 class="ov-section__title">Klass</h2>
        <div class="ov-classes">
          ${[...classes].sort((a, b) => a.name.localeCompare(b.name, "sv")).map((c) => `
            <button class="ov-chip${c.id === cid ? " is-active" : ""}" data-class="${esc(c.id)}"
              aria-pressed="${c.id === cid}">${esc(c.name)}</button>`).join("")}
          <button class="ov-chip ov-chip--add" data-add>${icon("plus")} Ny klass</button>
        </div>
      </section>

      <section class="ov-section" aria-label="Lägen">
        <h2 class="ov-section__title">Lägen</h2>
        <div class="ov-modes">
          ${navOrder().filter((m) => m.id !== "oversikt").map((m) => `
            <button class="ov-mode" data-mode="${m.id}">
              <span class="ov-mode__icon">${icon(m.icon, { size: 26, strokeWidth: 1.5 })}</span>
              <span class="ov-mode__title">${esc(m.title)}</span>
            </button>`).join("")}
        </div>
      </section>

      ${weekSection(cls)}

      ${actionSection(cls)}

      <section class="ov-section" aria-label="Dagens planeringar">
        <h2 class="ov-section__title">${icon("calendar")} Dagens lektionsplaneringar</h2>
        ${!cls ? `<p class="ov-empty">Välj en klass för att se dagens planeringar.</p>`
          : todaysPlans.length === 0
            ? `<p class="ov-empty">Inga planeringar för idag.
               <button class="ov-link" data-mode="lektion">Skapa en i Lektionsplanering.</button></p>`
            : `<ul class="ov-plans">
                ${todaysPlans.map((p) => {
                  const t = p.start ? `${esc(p.start)}${p.end ? "–" + esc(p.end) : ""}` : "";
                  return `<li>
                    <button class="ov-plan" data-plan="${esc(p.id)}">
                      <span class="ov-plan__dot" style="background:${subjectColor(p.subjectId, settingsDocs)}"></span>
                      <span class="ov-plan__name">${esc(p.name ?? "Namnlös planering")}</span>
                      ${t ? `<span class="ov-plan__time">${t}</span>` : ""}
                    </button>
                  </li>`;
                }).join("")}
              </ul>`}
      </section>`;
  }

  // ---- Händelser (delegering — markupen ritas om) ----
  el.addEventListener("click", (e) => {
    const cid = activeId();
    if (cid && handleClassActionClick(e, { data, cid, actions, replies })) return;
    const t = e.target.closest("[data-class],[data-add],[data-mode],[data-plan]");
    if (!t) return;
    if (t.dataset.class) chooseClass(t.dataset.class);
    else if (t.hasAttribute("data-add")) void addClass();
    else if (t.dataset.mode) goMode(t.dataset.mode);
    else if (t.dataset.plan) openPlan(t.dataset.plan);
  });

  // ---- Datakällor (live) ----
  offs.push(data.watch("classes", (docs) => { classes = docs; render(); }));

  const cid = activeId();
  if (cid) {
    // Planeringar är privata per lärare — visa bara den inloggades egna.
    offs.push(data.watch(plansPathFor(cid), (docs) => { plans = docs; render(); }));
    offs.push(data.watch(noteStatsPath(cid), (docs) => { noteStats = docs; render(); }));
    offs.push(data.watch(praisePath(cid), (docs) => {
      praiseBoard = docs.find((d) => d.id === PRAISE_DOC) ?? null;
      render();
    }));
    offs.push(data.watch(`classes/${cid}/sessions`, (docs) => { sessions = docs; render(); }));
    offs.push(data.watch(classActionsPath(cid), (docs) => { actions = docs; render(); }));
    offs.push(data.watch(classActionRepliesPath(cid), (docs) => { replies = docs; render(); }));
    offs.push(data.watch(`classes/${cid}/settings`, (docs) => { settingsDocs = docs; render(); }));
  }

  render();
  return offs;
}
