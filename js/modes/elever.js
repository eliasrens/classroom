/**
 * LÄGE 4 — Elevlista & noteringar. ENDAST LÄRARVY.
 *
 * Lärarens minnesstöd: elevlista, snabb registrering under lektion,
 * fritextanteckningar, elevkort med tidslinje, sök/uttag och mönster
 * över tid. INGEN automatik som kopplar noteringar till åtgärder,
 * inga poäng, inga rangordningar — vad som händer sedan är alltid
 * lärarens beslut.
 *
 * INTEGRITETSSPÄRR: detta läge får ALDRIG nå elevskärmen. Elevvyn
 * (ctx.view === "student") renderar en neutral skärm utan att läsa
 * ett enda elevdokument — spärren ligger alltså här i modulen och
 * förlitar sig inte enbart på att presentationsläget filtrerar.
 */

import { icon } from "../lib/icons.js";
import { studentLabel } from "../lib/names.js";
import {
  studentsPath, notesPath, settingsPath,
  loadModeSettings, DEFAULT_SETTINGS,
  createNote, noteTypeById, escapeHtml, activeStudents,
} from "./elever/shared.js";
import { renderRegister } from "./elever/register.js";
import { renderRoster } from "./elever/roster.js";
import { renderCard } from "./elever/card.js";
import { renderPatterns } from "./elever/patterns.js";

const TABS = [
  { id: "registrera", title: "Registrera", icon: "check", render: renderRegister },
  { id: "elever", title: "Elever", icon: "users", render: renderRoster },
  { id: "elevkort", title: "Elevkort & sök", icon: "search", render: renderCard },
  { id: "monster", title: "Mönster", icon: "chart", render: renderPatterns },
];

let cleanup = []; // unsubscribe-funktioner + lyssnare för aktuell mount

export default {
  id: "elever",
  title: "Elevlista",
  icon: "users",

  async mount(el, ctx) {
    // ---- SPÄRR: aldrig något elevinnehåll på elevskärmen ----
    if (ctx.view !== "teacher") {
      el.innerHTML = `
        <div class="mode-placeholder">
          <h1>Klassrumsverktyget</h1>
          <p>Det här läget finns bara på lärarens skärm.</p>
        </div>`;
      return;
    }

    if (!ctx.activeClass) {
      el.innerHTML = `
        <div class="mode-placeholder">
          <div class="mode-placeholder__icon">${icon("users", { size: 44, strokeWidth: 1.4 })}</div>
          <h1>Elevlista</h1>
          <p>Välj eller skapa en klass i topbaren för att komma igång.</p>
        </div>`;
      return;
    }

    const { data } = ctx;
    const cid = ctx.activeClass.id;

    // ---- Delat tillstånd för alla flikar ----
    const api = {
      ctx, data, cid,
      students: [],
      notes: [],
      settings: { ...DEFAULT_SETTINGS },
      initials: false,
      tab: sessionStorage.getItem("classroom:elever:tab") ?? "registrera",
      undoStack: [],
      cardStudentId: null, // vald elev i Elevkort-fliken (behålls vid flikbyte)

      /** Visningsnamn — ALLTID via studentLabel så initial-läget följs. */
      label(student) {
        return escapeHtml(studentLabel(student, { initials: api.initials }));
      },
      studentById(id) {
        return api.students.find((s) => s.id === id) ?? null;
      },

      async saveSettings(patch) {
        api.settings = { ...api.settings, ...patch };
        await data.put(settingsPath(cid), { id: "elevlista", value: api.settings });
      },

      /** Snabbnotering (typ) — ett tryck. Returnerar elevens etikett för kvittens. */
      async quickNote(studentId, { positive = false } = {}) {
        const typeId = positive ? "positiv" : api.settings.defaultTypeId;
        const id = await createNote(data, cid, {
          studentId,
          kind: "typ",
          typeId,
          positive: Boolean(noteTypeById(typeId)?.positive) || positive,
        });
        api.undoStack.push(id);
        const s = api.studentById(studentId);
        api.toast(`Noterat: ${s ? studentLabel(s, { initials: api.initials }) : "?"} — ${noteTypeById(typeId)?.name ?? typeId}`);
      },

      async undoLast() {
        while (api.undoStack.length > 0) {
          const id = api.undoStack.pop();
          if (api.notes.some((n) => n.id === id)) {
            await data.remove(notesPath(cid), id);
            api.toast("Senaste noteringen ångrad.");
            return;
          }
        }
        api.toast("Inget att ångra.");
      },

      toast(msg) {
        const t = el.querySelector(".elever__toast");
        if (!t) return;
        t.textContent = msg;
        t.classList.add("is-visible");
        clearTimeout(api._toastTimer);
        api._toastTimer = setTimeout(() => t.classList.remove("is-visible"), 2200);
      },

      setTab(id) {
        api.tab = id;
        try { sessionStorage.setItem("classroom:elever:tab", id); } catch { /* ok */ }
        renderTabs();
        renderBody();
      },

      refresh() { renderBody(); },
    };

    api.settings = await loadModeSettings(data, cid);

    // ---- Skal ----
    el.innerHTML = `
      <div class="elever">
        <nav class="elever__tabs" aria-label="Elevlista — flikar"></nav>
        <div class="elever__body"></div>
        <div class="elever__toast" role="status" aria-live="polite"></div>
      </div>`;
    const tabsEl = el.querySelector(".elever__tabs");
    const bodyEl = el.querySelector(".elever__body");

    function renderTabs() {
      tabsEl.innerHTML = TABS.map((t) => `
        <button class="elever__tab" data-tab="${t.id}"
          ${t.id === api.tab ? 'aria-current="page"' : ""}>${icon(t.icon)}<span>${t.title}</span></button>`).join("");
    }
    tabsEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (btn) api.setTab(btn.dataset.tab);
    });

    let renderQueued = false;
    function renderBody() {
      if (renderQueued) return;
      renderQueued = true;
      queueMicrotask(() => {
        renderQueued = false;
        // Rör inte flikar där läraren just skriver: rendera bara om
        // fokus inte står i ett fält i flikkroppen.
        const tab = TABS.find((t) => t.id === api.tab) ?? TABS[0];
        tab.render(bodyEl, api);
      });
    }

    /** Datadrivna omritningar får inte slå undan pågående skrivande. */
    function safeRefresh() {
      const active = document.activeElement;
      if (active && bodyEl.contains(active) &&
          (active.matches("input, textarea, select") || active.isContentEditable)) {
        api._dirty = true; // ritas om vid nästa flikbyte/interaktion
        return;
      }
      renderBody();
    }

    // ---- Data-prenumerationer ----
    cleanup.push(data.watch(studentsPath(cid), (docs) => {
      api.students = docs;
      safeRefresh();
    }));
    cleanup.push(data.watch(notesPath(cid), (docs) => {
      api.notes = docs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      safeRefresh();
    }));
    cleanup.push(data.watch(settingsPath(cid), (docs) => {
      const s = docs.find((d) => d.id === "elevlista");
      if (s?.value) api.settings = { ...DEFAULT_SETTINGS, ...s.value };
      const disp = docs.find((d) => d.id === "display");
      api.initials = disp?.value?.nameDisplay === "initials";
      safeRefresh();
    }));

    // ---- Elevkortkommandon: BARA i detta läge, BARA i Registrera-fliken ----
    function onKeydown(e) {
      if (api.tab !== "registrera") return;
      const t = e.target;
      const typing = t && (t.matches?.("input, textarea, select") || t.isContentEditable);
      // Ångra senaste: Ctrl+Z (utanför fält)
      if (!typing && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void api.undoLast();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector(".quick-note[data-open]")) return; // snabbanteckningsrutan äger tangenterna
      const key = e.key.toLowerCase();
      const hit = activeStudents(api.students).find((s) => s.hotkey && s.hotkey === key);
      if (hit) {
        e.preventDefault();
        void api.quickNote(hit.id, { positive: e.shiftKey });
      }
    }
    window.addEventListener("keydown", onKeydown);
    cleanup.push(() => window.removeEventListener("keydown", onKeydown));
    cleanup.push(() => { api._rosterCaptureOff?.(); clearTimeout(api._toastTimer); });

    renderTabs();
    renderBody();
  },

  async unmount() {
    for (const fn of cleanup) { try { fn(); } catch { /* ok */ } }
    cleanup = [];
  },
};
