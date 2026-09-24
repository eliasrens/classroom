/**
 * LÄGE 5 — ÖVERSIKT / START. ENDAST LÄRARVY.
 *
 * Den lugna startvyn efter inloggning: välj klass, välj läge, se dagens
 * sparade lektionsplaneringar — en rofylld ingång till hela appen, med
 * veckans siffror (rena varje måndag, tidigare veckor i Statistik). Här
 * bor även de tvärgående integritetsinställningarna (Läge 5): namn­visning
 * (förnamn/initialer), auto-radering av noteringar och "radera all data
 * för klassen".
 *
 * INTEGRITETSSPÄRR: översikten (klassdata, noteringsinställningar) får
 * ALDRIG nå elevskärmen. Läget står inte i STUDENT_MODE_IDS, så routern
 * monterar det aldrig i elevvyn — och skulle det ändå ske renderas en
 * neutral skärm utan att läsa ett enda elev- eller noteringsdokument.
 */

import { icon } from "../lib/icons.js";
import { MODES } from "./registry.js";
import { SUBJECTS } from "../lib/color.js";
import { ACTIVE_CLASS_KEY } from "../ui/class-picker.js";
import { loadNameDisplay, saveNameDisplay } from "./elever/shared.js";
import {
  loadPrivacy, savePrivacy, RETENTION_OPTIONS, deleteAllClassData,
} from "../lib/privacy.js";
import { plansPath as plansPathFor } from "../data/plans.js";
import { createClass } from "../data/classes.js";
import { startOfWeek, inWeek, weekLabel, weekRangeLabel } from "../lib/week.js";
import { KIND_KEYS, KINDS, computeStats } from "../lib/trafikljus-stats.js";
import { MORNING_KEY, normalize as normalizeMorning, currentPraise } from "../lib/morning.js";
import { serverNow } from "../lib/clock.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

export default {
  id: "oversikt",
  title: "Översikt",
  icon: "layout",

  async mount(el, ctx) {
    this._offs = [];

    // ---- SPÄRR: aldrig klassdata på elevskärmen ----
    if (ctx.view !== "teacher") {
      el.innerHTML = `
        <div class="mode-placeholder">
          <h1>Klassrumsverktyget</h1>
          <p>Översikten finns bara på lärarens skärm.</p>
        </div>`;
      return;
    }

    const { data, store } = ctx;
    let classes = [];
    let plans = [];
    let settingsDocs = [];
    let initials = false;
    let retentionWeeks = null;
    let notes = [];
    let sessions = [];
    const activeId = () => store.get().classId ?? null;

    el.innerHTML = `<div class="oversikt"></div>`;
    const rootEl = el.querySelector(".oversikt");

    // ---- Klassbyte från startvyn (persistas + speglas till elevskärm) ----
    function chooseClass(id) {
      try { localStorage.setItem(ACTIVE_CLASS_KEY, id ?? ""); } catch { /* privat läge */ }
      store.set({ classId: id || null });
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

    async function openPlan(planId) {
      const cid = activeId();
      if (!cid) return;
      await data.put(`classes/${cid}/settings`, { id: "lektion", value: { activePlanId: planId } });
      goMode("lektion");
    }

    // ---- Integritet: namnvisning ----
    function toggleInitials(on) {
      const cid = activeId();
      if (!cid) return;
      void saveNameDisplay(data, cid, on);
    }

    // ---- Integritet: auto-radering av noteringar ----
    function setRetention(value) {
      const cid = activeId();
      if (!cid) return;
      const weeks = value === "" ? null : Number(value);
      void savePrivacy(data, cid, { noteRetentionWeeks: weeks });
    }

    // ---- Integritet: radera all data för klassen ----
    async function deleteClass() {
      const cid = activeId();
      const cls = classes.find((c) => c.id === cid);
      if (!cid || !cls) return;
      const typed = prompt(
        `Detta raderar ALLT för klassen "${cls.name}" — elever, planeringar, ` +
        `noteringar, pass och inställningar. Det går inte att ångra.\n\n` +
        `Skriv klassens namn (${cls.name}) för att bekräfta:`
      );
      if (typed == null) return;
      if (typed.trim() !== cls.name) { alert("Namnet stämde inte — inget raderades."); return; }
      const n = await deleteAllClassData(data, cid);
      // classId pekar nu på en borttagen klass — klassväljaren städar upp
      // och väljer en annan (eller ingen); routern remountar då översikten.
      chooseClass(classes.find((c) => c.id !== cid)?.id ?? null);
      alert(`Klart — ${n} poster raderade för "${cls.name}".`);
    }

    // ---- Veckans siffror (veckorytm: bara innevarande vecka) ----
    function weekSection(cls) {
      if (!cls) return "";
      const ws = startOfWeek();
      const weekNotes = notes.filter((n) => inWeek(n.createdAt ?? 0, ws));
      const typ = weekNotes.filter((n) => n.kind === "typ");
      const neg = typ.filter((n) => !n.positive).length;
      const praise = currentPraise(normalizeMorning(settingsDocs.find((d) => d.id === MORNING_KEY)?.value));
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
            <button class="ov-link" data-mode="statistik">Tidigare veckor finns i Statistik.</button></p>
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

      rootEl.innerHTML = `
        <header class="ov-hero">
          <p class="ov-hero__kicker">${esc(fmtLongDate())}</p>
          <h1 class="ov-hero__title">${greeting()}.</h1>
          <p class="ov-hero__sub">${cls
            ? `Vald klass: <strong>${esc(cls.name)}</strong>. Välj ett läge nedan.`
            : `Välj en klass för att komma igång.`}</p>
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
            ${MODES.filter((m) => m.id !== "oversikt").map((m) => `
              <button class="ov-mode" data-mode="${m.id}">
                <span class="ov-mode__icon">${icon(m.icon, { size: 26, strokeWidth: 1.5 })}</span>
                <span class="ov-mode__title">${esc(m.title)}</span>
              </button>`).join("")}
          </div>
        </section>

        ${weekSection(cls)}

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
        </section>

        <section class="ov-section ov-privacy card" aria-label="Integritet och data">
          <h2 class="ov-section__title">${icon("shield")} Integritet &amp; data</h2>
          <p class="ov-privacy__note">Endast elevernas förnamn lagras. Noteringar och
            anteckningar visas aldrig på elevskärmen.</p>
          ${!cls ? `<p class="ov-empty">Välj en klass för att ändra inställningarna.</p>` : `
          <label class="ov-toggle">
            <input type="checkbox" data-initials ${initials ? "checked" : ""}>
            <span>Visa initialer i stället för förnamn (gäller hela lärarvyn)</span>
          </label>

          <label class="ov-field">
            <span class="ov-field__label">Radera noteringar automatiskt efter</span>
            <select data-retention>
              ${RETENTION_OPTIONS.map((o) => `
                <option value="${o.weeks ?? ""}" ${(o.weeks ?? null) === retentionWeeks ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
            </select>
          </label>
          <p class="ov-field__hint">Gäller klassens noteringar från Läge 4. Rensningen körs
            automatiskt när klassen öppnas.</p>

          <div class="ov-danger">
            <button class="btn ov-danger__btn" data-del>${icon("trash")} Radera all data för ${esc(cls.name)}</button>
            <span class="ov-danger__hint">Elever, planeringar, noteringar, pass — allt. Kan inte ångras.</span>
          </div>`}
        </section>`;

      // ---- Händelser (delegation) ----
      rootEl.querySelectorAll("[data-class]").forEach((b) =>
        b.addEventListener("click", () => chooseClass(b.dataset.class)));
      rootEl.querySelector("[data-add]")?.addEventListener("click", () => void addClass());
      rootEl.querySelectorAll("[data-mode]").forEach((b) =>
        b.addEventListener("click", () => goMode(b.dataset.mode)));
      rootEl.querySelectorAll("[data-plan]").forEach((b) =>
        b.addEventListener("click", () => void openPlan(b.dataset.plan)));
      rootEl.querySelector("[data-initials]")?.addEventListener("change", (e) =>
        toggleInitials(e.target.checked));
      rootEl.querySelector("[data-retention]")?.addEventListener("change", (e) =>
        setRetention(e.target.value));
      rootEl.querySelector("[data-del]")?.addEventListener("click", () => void deleteClass());
    }

    // ---- Datakällor (live) ----
    this._offs.push(data.watch("classes", (docs) => { classes = docs; render(); }));

    const cid = activeId();
    if (cid) {
      // Planeringar är privata per lärare — visa bara den inloggades egna.
      this._offs.push(data.watch(plansPathFor(cid), (docs) => { plans = docs; render(); }));
      this._offs.push(data.watch(`classes/${cid}/notes`, (docs) => { notes = docs; render(); }));
      this._offs.push(data.watch(`classes/${cid}/sessions`, (docs) => { sessions = docs; render(); }));
      this._offs.push(data.watch(`classes/${cid}/settings`, (docs) => {
        settingsDocs = docs;
        initials = docs.find((d) => d.id === "display")?.value?.nameDisplay === "initials";
        const weeks = docs.find((d) => d.id === "privacy")?.value?.noteRetentionWeeks;
        retentionWeeks = Number.isFinite(weeks) && weeks > 0 ? weeks : null;
        render();
      }));
    }

    render();
  },

  async unmount() {
    for (const off of this._offs ?? []) { try { off(); } catch { /* noop */ } }
    this._offs = [];
  },
};
