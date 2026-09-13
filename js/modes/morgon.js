/**
 * LÄGE 1 — MORGONSKÄRM.
 *
 * Helskärm med slumpad naturbild. Ovanpå en halvgenomskinlig mörk
 * ruta (oskärpa bakom) med hälsning + numrerad lista över dagens
 * instruktioner. Lärarvyn har en infällbar kontrollpanel till vänster;
 * elevvyn visar samma skärm ren (hälsning + lista + ev. namntavla).
 *
 * Allt tillstånd lever i klassens inställningar (js/lib/morning.js) och
 * syncar via datalagret — elevskärmen speglar lärarens ändringar direkt.
 */

import { icon } from "../lib/icons.js";
import { studentLabel } from "../lib/names.js";
import {
  WEEKDAYS, UNSPLASH_IDS, unsplashUrl,
  normalize, loadMorning, saveMorning, settingsPath, MORNING_KEY,
  studentTextFor, orderedTasks, greetingText,
} from "../lib/morning.js";

const PANEL_KEY = "classroom:morgon:panelOpen";
// Ny slumpad bild per sidladdning, men stabil inom sessionen (per klass).
const randomizedThisSession = new Set();

export default {
  id: "morgon",
  title: "Morgonskärm",
  icon: "sunrise",

  async mount(el, ctx) {
    const { data, view, sync } = ctx;
    const isTeacher = view === "teacher";
    const classId = ctx.activeClass?.id ?? null;
    const activeClass = ctx.activeClass ?? null;

    let settings = normalize(null);
    let students = [];
    let initials = false;
    let currentBgUrl = null;

    el.innerHTML = renderShell(isTeacher);
    const $ = (sel) => el.querySelector(sel);
    const stage = $(".morgon");
    const bgImg = $(".morgon__bgimg");

    // Skyddsnät: om vyn redan bytts ut (routern har rensat <main> medan
    // ett watch-callback ligger i kö) är .morgon inte längre i DOM:en —
    // skriv då aldrig till borttagna element. Kompletterar routerns
    // serialisering av monteringar (js/router.js).
    const mounted = () => stage.isConnected;

    // ---------- Bakgrund ----------
    function showBackground(url) {
      if (!mounted()) return;
      if (url === currentBgUrl) return;
      currentBgUrl = url;
      if (!url) { stage.dataset.bg = "color"; bgImg.removeAttribute("src"); return; }
      stage.dataset.bg = "loading";
      bgImg.onload = () => { if (bgImg.src === url) stage.dataset.bg = "image"; };
      bgImg.onerror = () => { stage.dataset.bg = "color"; }; // trasig bild → lugn färg
      bgImg.src = url;
    }

    function bgPool() {
      return [...UNSPLASH_IDS.map(unsplashUrl), ...settings.background.extraUrls];
    }
    function pickRandomBg() {
      const pool = bgPool();
      const others = pool.filter((u) => u !== settings.background.current);
      const choose = (others.length ? others : pool);
      return choose[Math.floor(Math.random() * choose.length)] ?? "";
    }

    // ---------- Rendering (elev-synlig del) ----------
    function renderGreeting() {
      $(".morgon__greeting").textContent = greetingText(settings, activeClass);
    }

    function renderTasks() {
      const ol = $(".morgon__tasks");
      const items = orderedTasks(settings);
      ol.innerHTML = items.map((t) => `<li>${escapeHtml(studentTextFor(t))}</li>`).join("");
      $(".morgon__tasks-empty").hidden = items.length > 0;
    }

    function praiseName(p) {
      if (p.kind === "free") return p.text;
      const s = students.find((x) => x.id === p.studentId);
      return s ? studentLabel(s, { initials }) : null;
    }

    function renderNametavla() {
      if (!mounted()) return;
      const nt = $(".morgon__nametavla");
      nt.hidden = !settings.showNametavla;
      const names = settings.praise.map(praiseName).filter(Boolean);
      $(".morgon__nt-names").innerHTML = names.length
        ? names.map((n) => `<li>${escapeHtml(n)}</li>`).join("")
        : `<li class="morgon__nt-empty">Kryssa i elever i panelen →</li>`;
      // Elevvyn ska aldrig visa "tom"-hjälptexten som en riktig rad.
      if (!isTeacher && !names.length) nt.hidden = true;
    }

    function renderDisplay() {
      if (!mounted()) return;
      renderGreeting();
      renderTasks();
      renderNametavla();
    }

    // ---------- Skrivning ----------
    // En väg in: uppdatera lokalt, rita om, persistera. watch-återkopplingen
    // (egna eller andra fönsters ändringar) går genom applyExternal().
    async function commit(next) {
      settings = next;
      renderDisplay();
      if (isTeacher) { showBackground(settings.background.current); syncPanel(); }
      await saveMorning(data, classId, settings);
    }
    const clone = () => structuredClone(settings);

    function applyExternal(value) {
      const next = normalize(value);
      if (JSON.stringify(next) === JSON.stringify(settings)) return;
      settings = next;
      renderDisplay();
      if (isTeacher) { showBackground(settings.background.current); syncPanel(); renderTaskControls(); }
      else showBackground(settings.background.current);
    }

    // ================= LÄRARPANEL =================
    let syncPanel = () => {};
    let renderTaskControls = () => {};

    if (isTeacher) {
      const panel = $(".morgon__panel");
      const toggle = $(".morgon__panel-toggle");

      let open = true;
      try { open = localStorage.getItem(PANEL_KEY) !== "0"; } catch { /* ok */ }
      const applyOpen = () => {
        panel.dataset.open = String(open);
        toggle.dataset.open = String(open);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.title = open ? "Fäll in panelen" : "Visa kontrollpanelen";
      };
      applyOpen();
      toggle.addEventListener("click", () => {
        open = !open; applyOpen();
        try { localStorage.setItem(PANEL_KEY, open ? "1" : "0"); } catch { /* ok */ }
      });

      // ---- Hälsning ----
      panel.querySelectorAll('input[name="mg-variant"]').forEach((r) => {
        r.addEventListener("change", () => {
          if (!r.checked) return;
          const next = clone(); next.greeting.variant = r.value; commit(next);
        });
      });
      const greetInput = $(".morgon__greet-input");
      greetInput.addEventListener("input", () => {
        const next = clone(); next.greeting.override = greetInput.value; commit(next);
      });

      // ---- Att göra ----
      const taskList = $(".morgon__tasklist");
      taskList.addEventListener("change", (e) => {
        const cb = e.target.closest('input[type="checkbox"][data-task]');
        if (cb) {
          const next = clone();
          const t = next.tasks.find((x) => x.id === cb.dataset.task);
          if (t) { t.checked = cb.checked; if (cb.checked) t.checkedAt = Date.now(); }
          commit(next);
          return;
        }
        const sel = e.target.closest("select[data-weekday]");
        if (sel) {
          const next = clone();
          const t = next.tasks.find((x) => x.id === sel.dataset.weekday);
          if (t) t.weekday = sel.value;
          commit(next);
        }
      });
      taskList.addEventListener("click", (e) => {
        const editBtn = e.target.closest("button[data-edit]");
        if (editBtn) {
          const t = settings.tasks.find((x) => x.id === editBtn.dataset.edit);
          if (!t) return;
          const val = prompt("Text som visas för eleverna:", studentTextFor(t));
          if (val == null) return;
          const next = clone();
          const nt = next.tasks.find((x) => x.id === t.id);
          if (nt) nt.studentText = val.trim() || nt.label;
          commit(next);
          return;
        }
        const delBtn = e.target.closest("button[data-del]");
        if (delBtn) {
          const next = clone();
          next.tasks = next.tasks.filter((x) => x.id !== delBtn.dataset.del);
          commit(next).then(renderTaskControls); // rad borta ur listan
        }
      });

      const addInput = $(".morgon__addtask-input");
      const addTask = () => {
        const text = addInput.value.trim();
        if (!text) return;
        const next = clone();
        next.tasks.push({
          id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()),
          kind: "custom", label: text, studentText: text,
          checked: true, checkedAt: Date.now(), // auto-ikryssad, hamnar sist
        });
        addInput.value = "";
        commit(next).then(renderTaskControls);
        addInput.focus();
      };
      $(".morgon__addtask-btn").addEventListener("click", addTask);
      addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTask(); } });

      // ---- Namntavla ----
      $(".morgon__show-nt").addEventListener("change", (e) => {
        const next = clone(); next.showNametavla = e.target.checked; commit(next);
      });
      const ntStudents = $(".morgon__ntstudents");
      ntStudents.addEventListener("change", (e) => {
        const cb = e.target.closest("input[data-student]");
        if (!cb) return;
        const id = cb.dataset.student;
        const next = clone();
        const has = next.praise.some((p) => p.kind === "student" && p.studentId === id);
        next.praise = has
          ? next.praise.filter((p) => !(p.kind === "student" && p.studentId === id))
          : [...next.praise, { id, kind: "student", studentId: id }];
        if (!has) next.showNametavla = true;
        commit(next);
      });
      const ntFree = $(".morgon__ntfree-input");
      const addFree = () => {
        const text = ntFree.value.trim();
        if (!text) return;
        const next = clone();
        next.praise.push({ id: crypto.randomUUID?.() ?? String(Date.now()), kind: "free", text });
        next.showNametavla = true;
        ntFree.value = "";
        commit(next);
        ntFree.focus();
      };
      $(".morgon__ntfree-btn").addEventListener("click", addFree);
      ntFree.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addFree(); } });
      const clearNt = () => { const next = clone(); next.praise = []; commit(next); };
      $(".morgon__ntclear").addEventListener("click", clearNt);
      // Töm-knapp på själva namntavlan (teacher-only, döljs i elevvyn)
      $(".morgon__nt-clear").addEventListener("click", clearNt);

      // ---- Bakgrund ----
      $(".morgon__bg-random").addEventListener("click", () => {
        const next = clone(); next.background.current = pickRandomBg(); commit(next);
      });
      const bgUrl = $(".morgon__bg-url");
      const addUrl = () => {
        const url = bgUrl.value.trim();
        if (!url) return;
        const next = clone();
        if (!next.background.extraUrls.includes(url)) next.background.extraUrls.push(url);
        next.background.current = url;
        bgUrl.value = "";
        commit(next);
      };
      $(".morgon__bg-urlbtn").addEventListener("click", addUrl);
      bgUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } });
      $(".morgon__bg-file").addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const url = String(reader.result || "");
          const next = clone();
          if (!next.background.extraUrls.includes(url)) next.background.extraUrls.push(url);
          next.background.current = url;
          commit(next);
        };
        reader.readAsDataURL(file);
        e.target.value = "";
      });

      // ---- Panel-synk (utan att stjäla fokus / bygga om stabila fält) ----
      syncPanel = () => {
        if (!mounted()) return;
        panel.querySelectorAll('input[name="mg-variant"]').forEach((r) => {
          r.checked = r.value === settings.greeting.variant;
        });
        if (greetInput !== document.activeElement) greetInput.value = settings.greeting.override;
        greetInput.placeholder = activeClass
          ? greetingText({ ...settings, greeting: { ...settings.greeting, override: "" } }, activeClass)
          : "Välkommen!";
        $(".morgon__show-nt").checked = settings.showNametavla;
        // Kryssrutornas läge (raderna byggs om separat vid strukturändring)
        taskList.querySelectorAll('input[type="checkbox"][data-task]').forEach((cb) => {
          const t = settings.tasks.find((x) => x.id === cb.dataset.task);
          if (t) cb.checked = t.checked;
        });
        taskList.querySelectorAll("select[data-weekday]").forEach((sel) => {
          const t = settings.tasks.find((x) => x.id === sel.dataset.weekday);
          if (t && sel !== document.activeElement) sel.value = t.weekday;
        });
        syncNtStudents();
      };

      renderTaskControls = () => {
        if (!mounted()) return;
        taskList.innerHTML = settings.tasks.map(taskRow).join("");
        syncPanel();
      };

      function syncNtStudents() {
        ntStudents.querySelectorAll("input[data-student]").forEach((cb) => {
          cb.checked = settings.praise.some((p) => p.kind === "student" && p.studentId === cb.dataset.student);
        });
      }
      function renderNtStudents() {
        if (!mounted()) return;
        if (!students.length) {
          ntStudents.innerHTML = `<p class="morgon__hint">Inga elever i klassen ännu — lägg till dem i Elevlista, eller skriv fritext nedan.</p>`;
          return;
        }
        ntStudents.innerHTML = students.map((s) => `
          <label class="morgon__ntstudent">
            <input type="checkbox" data-student="${escapeAttr(s.id)}">
            <span>${escapeHtml(studentLabel(s, { initials }))}</span>
          </label>`).join("");
        syncNtStudents();
      }
      // exponera för students-watch nedan
      this._renderNtStudents = renderNtStudents;

      renderTaskControls();
    }

    // ================= WATCHERS =================
    const stops = [];

    // Inställningarna (hälsning, uppgifter, namntavla, bakgrund)
    stops.push(classId
      ? data.watch(settingsPath(classId), (docs) => {
          const doc = docs.find((d) => d.id === MORNING_KEY);
          applyExternal(doc?.value);
        })
      : () => {});

    // Namnvisning (initialer) + elevlista (för namntavlan)
    if (classId) {
      stops.push(data.watch(`classes/${classId}/settings`, (docs) => {
        const disp = docs.find((d) => d.id === "display");
        const next = disp?.value?.nameDisplay === "initials";
        if (next !== initials) { initials = next; renderNametavla(); this._renderNtStudents?.(); }
      }));
      stops.push(data.watch(`classes/${classId}/students`, (docs) => {
        students = docs.filter((s) => s.active !== false)
          .sort((a, b) => String(a.firstName).localeCompare(String(b.firstName), "sv"));
        renderNametavla();
        this._renderNtStudents?.();
      }));
    }

    // ---------- Init ----------
    settings = await loadMorning(data, classId);

    // Slumpa bakgrund vid sidladdning (stabil inom sessionen per klass).
    if (isTeacher) {
      const key = classId ?? "__noclass__";
      const needsRandom = !settings.background.current || !randomizedThisSession.has(key);
      if (needsRandom) {
        randomizedThisSession.add(key);
        settings.background.current = pickRandomBg() || settings.background.current;
        await saveMorning(data, classId, settings);
      }
    }

    renderDisplay();
    showBackground(settings.background.current);
    if (isTeacher) { syncPanel(); }

    this._stops = stops;
  },

  async unmount() {
    for (const stop of this._stops ?? []) { try { stop(); } catch { /* ok */ } }
    this._stops = null;
    this._renderNtStudents = null;
  },
};

// ---------------------------------------------------------------------------
// Markup-hjälpare
// ---------------------------------------------------------------------------

function renderShell(isTeacher) {
  return `
    <div class="morgon" data-view="${isTeacher ? "teacher" : "student"}" data-bg="color">
      <img class="morgon__bgimg" alt="" aria-hidden="true">
      <div class="morgon__scrim" aria-hidden="true"></div>

      ${isTeacher ? `
      <button class="morgon__panel-toggle teacher-only" aria-expanded="true" aria-controls="morgon-panel" title="Fäll in panelen">
        ${icon("chevron-left")}
      </button>
      <aside class="morgon__panel teacher-only" id="morgon-panel" data-open="true" aria-label="Kontrollpanel">
        ${renderPanel()}
      </aside>` : ""}

      <div class="morgon__center">
        <div class="morgon__card">
          <h1 class="morgon__greeting"></h1>
          <hr class="morgon__rule">
          <ol class="morgon__tasks"></ol>
          <p class="morgon__tasks-empty" hidden>Kryssa i dagens uppgifter i panelen.</p>
        </div>
      </div>

      <aside class="morgon__nametavla" hidden aria-label="Bra jobbat">
        <header class="morgon__nt-head">
          <h2 class="morgon__nt-title">⭐ Bra jobbat!</h2>
          <button class="morgon__nt-clear teacher-only btn btn--ghost btn--icon" title="Töm namntavlan" aria-label="Töm namntavlan">${icon("trash")}</button>
        </header>
        <ul class="morgon__nt-names"></ul>
      </aside>
    </div>`;
}

function renderPanel() {
  return `
    <div class="morgon__panel-scroll">
      <section class="morgon__section">
        <h3>${icon("sunrise")} Hälsning</h3>
        <div class="morgon__variant">
          <label><input type="radio" name="mg-variant" value="godmorgon"> Godmorgon</label>
          <label><input type="radio" name="mg-variant" value="valkommen"> Välkommen</label>
        </div>
        <input class="morgon__greet-input" type="text" autocomplete="off"
          aria-label="Redigera hälsning" placeholder="Godmorgon 4A!">
        <p class="morgon__hint">Följer klassvalet — skriv här för att åsidosätta.</p>
      </section>

      <section class="morgon__section">
        <h3>${icon("check")} Att göra</h3>
        <div class="morgon__tasklist" role="group" aria-label="Dagens uppgifter"></div>
        <div class="morgon__addtask">
          <input class="morgon__addtask-input" type="text" placeholder="Lägg till egen uppgift…" autocomplete="off" aria-label="Ny uppgift">
          <button class="btn btn--icon morgon__addtask-btn" title="Lägg till uppgift" aria-label="Lägg till uppgift">${icon("plus")}</button>
        </div>
        <p class="morgon__hint">Listan visas i den ordning du kryssar i.</p>
      </section>

      <section class="morgon__section">
        <h3>${icon("star")} Namntavla</h3>
        <label class="morgon__show"><input type="checkbox" class="morgon__show-nt"> Visa namntavla</label>
        <div class="morgon__ntstudents" role="group" aria-label="Elever"></div>
        <div class="morgon__addtask">
          <input class="morgon__ntfree-input" type="text" placeholder="Fritext, t.ex. hela bordsgrupp 3…" autocomplete="off" aria-label="Fritext till namntavlan">
          <button class="btn btn--icon morgon__ntfree-btn" title="Lägg till" aria-label="Lägg till fritext">${icon("plus")}</button>
        </div>
        <button class="btn btn--ghost morgon__ntclear">${icon("trash")}<span>Töm namntavlan</span></button>
      </section>

      <section class="morgon__section">
        <h3>${icon("image")} Bakgrund</h3>
        <button class="btn morgon__bg-random">${icon("refresh")}<span>Slumpa om bild</span></button>
        <div class="morgon__addtask">
          <input class="morgon__bg-url" type="url" placeholder="Egen bild-URL…" autocomplete="off" aria-label="Egen bild-URL">
          <button class="btn btn--icon morgon__bg-urlbtn" title="Lägg till bild-URL" aria-label="Lägg till bild-URL">${icon("plus")}</button>
        </div>
        <label class="btn btn--ghost morgon__bg-upload">
          ${icon("upload")}<span>Ladda upp egen bild</span>
          <input class="morgon__bg-file" type="file" accept="image/*" hidden>
        </label>
      </section>
    </div>`;
}

function taskRow(t) {
  const control = t.kind === "starten"
    ? `<select data-weekday="${escapeAttr(t.id)}" class="morgon__weekday" aria-label="Veckodag för Starten">
         ${WEEKDAYS.map((d) => `<option value="${d}"${d === t.weekday ? " selected" : ""}>${d}</option>`).join("")}
       </select>`
    : "";
  const actions = t.kind === "custom"
    ? `<button class="morgon__task-btn" data-edit="${escapeAttr(t.id)}" title="Ändra elevtext" aria-label="Ändra elevtext">${icon("pencil")}</button>
       <button class="morgon__task-btn" data-del="${escapeAttr(t.id)}" title="Ta bort" aria-label="Ta bort uppgift">${icon("x")}</button>`
    : t.kind === "fixed"
      ? `<button class="morgon__task-btn" data-edit="${escapeAttr(t.id)}" title="Ändra elevtext" aria-label="Ändra elevtext">${icon("pencil")}</button>`
      : "";
  return `
    <div class="morgon__task">
      <label class="morgon__task-main">
        <input type="checkbox" data-task="${escapeAttr(t.id)}">
        <span class="morgon__task-label">${escapeHtml(t.label)}</span>
      </label>
      ${control}
      <span class="morgon__task-actions">${actions}</span>
    </div>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const escapeAttr = escapeHtml;
