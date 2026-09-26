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
import { createPraiseBoard } from "../ui/praise-board.js";
import {
  WEEKDAYS,
  normalize, loadMorning, saveMorning, saveBackground, watchMorning,
  studentTextFor, orderedTasks, greetingText, currentPraise, praiseIsStale,
} from "../lib/morning.js";
import { rolloverPraise } from "../lib/week-rhythm.js";
import { weekKey } from "../lib/week.js";
import { serverNow } from "../lib/clock.js";
import {
  categoryById, seasonFor, pickSeasonBg, shouldAutoRandomize, dayKey, findImage, thumbUrl,
} from "../lib/backgrounds.js";
import { openBgPicker, closeBgPicker } from "../ui/bg-picker.js";
import { collapsibleHTML, mountCollapsibles } from "../ui/collapsible.js";

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
    let currentBgUrl = null;

    el.innerHTML = renderShell(isTeacher);
    const $ = (sel) => el.querySelector(sel);
    const stage = $(".morgon");
    const bgImg = $(".morgon__bgimg");

    // "Bra jobbat"-tavlan: återanvändbar komponent som växer i kolumner.
    // Centerytans högermarginal följer tavlans faktiska bredd (--nt-space).
    const board = createPraiseBoard({
      title: "Bra jobbat", // utan stjärna (#71)
      className: "morgon__nametavla praise-board--glass",
      clearable: isTeacher,
      onClear: () => clearNt(),
      maxWidth: () => {
        const panel = isTeacher && stage.querySelector('.morgon__panel[data-open="true"]');
        const free = stage.clientWidth - (panel ? panel.offsetWidth : 0);
        return Math.max(free * 0.36, 240);
      },
      onLayout: (w) => {
        if (!w) { stage.style.removeProperty("--nt-space"); return; }
        const right = parseFloat(getComputedStyle(board.el).right) || 0;
        stage.style.setProperty("--nt-space", `${Math.ceil(w + right * 2)}px`);
        syncNameSize();
      },
    });
    // Samma korta guldstreck som under hälsningen, mellan rubrik och namn (#71).
    const ntRule = document.createElement("hr");
    ntRule.className = "morgon__rule";
    board.el.querySelector(".praise-board__head").after(ntRule);
    board.el.hidden = true;
    stage.append(board.el);
    this._board = board;
    let clearNt = () => {};

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

    // Slumpen tar bara den aktuella årstidens bilder (issue #64).
    const pickRandomBg = () => pickSeasonBg(settings.background.current, serverNow());

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
      return s ? studentLabel(s) : null;
    }

    // Namnen ska vara lika stora som uppgiftsraden (#71). Uppgifternas storlek
    // beror på kortets bredd, som i sin tur beror på tavlans bredd — mät den
    // färdiga storleken och anpassa om (några varv räcker; det konvergerar —
    // toleransen 0,1 px stoppar en ±1 px-växling i tavlans avrundade bredd).
    let nameSync = 0;
    function taskFontPx() {
      const ol = $(".morgon__tasks");
      let li = ol.querySelector("li");
      const temp = !li;
      if (temp) { li = document.createElement("li"); ol.append(li); }
      const f = parseFloat(getComputedStyle(li).fontSize);
      if (temp) li.remove();
      return f;
    }
    function syncNameSize() {
      if (!mounted() || board.el.hidden || nameSync > 4) return;
      // Rubriken skalas efter namnens faktiska storlek (css/modes/morgon.css).
      const list = board.el.querySelector(".praise-board__names");
      const names = `${parseFloat(getComputedStyle(list).fontSize)}px`;
      if (board.el.style.getPropertyValue("--nt-names") !== names) {
        board.el.style.setProperty("--nt-names", names);
        nameSync++;
        try { board.fit(); } finally { nameSync--; }
        return;
      }
      const f = taskFontPx();
      const cur = parseFloat(board.el.style.getPropertyValue("--praise-font-max")) || 0;
      if (!f || Math.abs(f - cur) < 0.1) return;
      board.el.style.setProperty("--praise-font-max", `${f}px`);
      nameSync++;
      try { board.fit(); } finally { nameSync--; }
    }

    function renderNametavla() {
      if (!mounted()) return;
      // Veckorytm: förra veckans lista visas aldrig (ren från måndag 00:00).
      const names = currentPraise(settings).map(praiseName).filter(Boolean);
      // Elevvyn ska aldrig visa "tom"-hjälptexten som en riktig rad.
      board.el.hidden = !settings.showNametavla || (!isTeacher && !names.length);
      board.setNames(names, { emptyText: isTeacher ? "Kryssa i elever i panelen →" : "" });
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

    // Ändring i Bra jobbat-listan. Hör listan fortfarande till förra
    // veckan (tömningen har inte hunnit ske, t.ex. offline) arkiveras och
    // töms den FÖRST — annars hamnar nya namn i förra veckans lista.
    async function editPraise(fn) {
      if (praiseIsStale(settings)) await rolloverPraise(data, classId, { allowLocal: true });
      const next = clone();
      if (praiseIsStale(next)) next.praise = []; // rollover misslyckades helt — börja ändå rent
      next.weekOf = weekKey();
      fn(next);
      await commit(next);
    }

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
        board.fit(); // tavlans maxbredd beror på panelen
        try { localStorage.setItem(PANEL_KEY, open ? "1" : "0"); } catch { /* ok */ }
      });
      // Kortet glider åt sidan (padding-övergång) och uppgifternas storlek kan
      // ändras med det — låt namnen följa med när övergången är klar (#71).
      $(".morgon__center").addEventListener("transitionend", (e) => {
        if (e.target === e.currentTarget) board.fit();
      });

      // Utfällbara delar (issue #66) — öppet/stängt sparas per dator.
      const sections = mountCollapsibles(panel, { scope: "morgon", defaults: PANEL_DEFAULTS });
      this._sections = sections;

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
          if (t) { t.checked = cb.checked; if (cb.checked) t.checkedAt = serverNow(); }
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
          checked: true, checkedAt: serverNow(), // auto-ikryssad, hamnar sist
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
        void editPraise((next) => {
          const has = next.praise.some((p) => p.kind === "student" && p.studentId === id);
          next.praise = has
            ? next.praise.filter((p) => !(p.kind === "student" && p.studentId === id))
            : [...next.praise, { id, kind: "student", studentId: id }];
          if (!has) next.showNametavla = true;
        });
      });
      const ntFree = $(".morgon__ntfree-input");
      const addFree = () => {
        const text = ntFree.value.trim();
        if (!text) return;
        ntFree.value = "";
        void editPraise((next) => {
          next.praise.push({ id: crypto.randomUUID?.() ?? String(Date.now()), kind: "free", text });
          next.showNametavla = true;
        });
        ntFree.focus();
      };
      $(".morgon__ntfree-btn").addEventListener("click", addFree);
      ntFree.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addFree(); } });
      clearNt = () => void editPraise((next) => { next.praise = []; });
      $(".morgon__ntclear").addEventListener("click", clearNt);
      // Töm-knappen på själva namntavlan (teacher-only) går via onClear ovan.

      // ---- Bakgrund ----
      // Allt läraren själv gör med bakgrunden (Slumpa, Välj bild, egen
      // bild) gäller resten av dagen — omladdning slumpar inte bort den.
      const setBackground = (url, extra = false) => {
        const next = clone();
        if (extra && !next.background.extraUrls.includes(url)) next.background.extraUrls.push(url);
        next.background.current = url;
        next.background.pickedOn = dayKey(serverNow());
        return commit(next);
      };
      $(".morgon__bg-random").addEventListener("click", () => { void setBackground(pickRandomBg()); });
      const pickBtn = $(".morgon__bg-pick");
      pickBtn.addEventListener("click", () => openBgPicker({
        current: settings.background.current,
        extraUrls: settings.background.extraUrls,
        season: seasonFor(serverNow()),
        container: document.body, // ovanför elevskärmens förhandsvisning
        returnFocus: pickBtn,
        onPick: (url) => { void setBackground(url); },
      }));
      this._closePicker = closeBgPicker;
      const bgUrl = $(".morgon__bg-url");
      const addUrl = () => {
        const url = bgUrl.value.trim();
        if (!url) return;
        bgUrl.value = "";
        void setBackground(url, true);
      };
      $(".morgon__bg-urlbtn").addEventListener("click", addUrl);
      bgUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } });
      $(".morgon__bg-file").addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const url = String(reader.result || "");
          if (url) void setBackground(url, true);
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
        syncBgHint();
        syncSummaries();
      };

      // Sammanfattningarna på de stängda rubrikraderna.
      function syncSummaries() {
        const n = settings.tasks.length;
        const shown = settings.tasks.filter((t) => t.checked).length;
        sections.setSummary("tasks",
          `${n} ${n === 1 ? "uppgift" : "uppgifter"} · ${shown ? `${shown} visas` : "ingen visas"}`);
        const names = currentPraise(settings).map(praiseName).filter(Boolean).length;
        sections.setSummary("praise",
          (names ? `${names} namn` : "Tom") + (settings.showNametavla ? "" : " · dold"));
        sections.setSummary("greeting", greetingText(settings, activeClass));
        sections.setSummary("background", { html: bgSummaryHTML(settings.background) });
      }

      const bgHint = $(".morgon__bg-hint");
      function syncBgHint() {
        const season = categoryById(seasonFor(serverNow()))?.label ?? "";
        const img = findImage(settings.background.current);
        const name = img ? (img.place ?? img.alt) : settings.background.current ? "Egen bild" : "";
        bgHint.textContent = `Slumpa tar en ${season.toLowerCase()}bild.`
          + (name ? ` Nu: ${name}.` : "")
          + (settings.background.pickedOn === dayKey(serverNow()) ? " Ditt val gäller i dag." : "");
      }

      renderTaskControls = () => {
        if (!mounted()) return;
        taskList.innerHTML = settings.tasks.map(taskRow).join("");
        syncPanel();
      };

      function syncNtStudents() {
        ntStudents.querySelectorAll("input[data-student]").forEach((cb) => {
          cb.checked = currentPraise(settings).some((p) => p.kind === "student" && p.studentId === cb.dataset.student);
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
            <span>${escapeHtml(studentLabel(s))}</span>
          </label>`).join("");
        syncNtStudents();
      }
      // exponera för students-watch nedan
      this._renderNtStudents = () => { renderNtStudents(); syncSummaries(); };

      renderTaskControls();
    }

    // ================= WATCHERS =================
    // Registreras direkt (inte först i slutet av mount): kraschar eller
    // hänger resten av mount städar unmount ändå bort det som hann starta.
    const stops = [];
    this._stops = stops;

    // Inställningarna (hälsning, uppgifter, namntavla, bakgrund) + den
    // LOKALA Bra jobbat-listan (issue #32) — sammanslagna av watchMorning.
    stops.push(classId
      ? watchMorning(data, classId, (value) => applyExternal(value))
      : () => {});

    // Elevlista (för namntavlan)
    if (classId) {
      stops.push(data.watch(`classes/${classId}/students`, (docs) => {
        students = docs.filter((s) => s.active !== false)
          .sort((a, b) => String(a.firstName).localeCompare(String(b.firstName), "sv"));
        renderNametavla();
        this._renderNtStudents?.();
      }));
    }

    // Veckoskifte medan skärmen står på (t.ex. över helgen): rita om
    // namntavlan när listan blir "förra veckans" — även offline.
    let wasStale = null;
    const weekTick = setInterval(() => {
      const stale = praiseIsStale(settings);
      if (stale !== wasStale) { wasStale = stale; renderNametavla(); if (isTeacher) syncPanel(); }
    }, 30_000);
    stops.push(() => clearInterval(weekTick));

    // ---------- Init ----------
    settings = await loadMorning(data, classId);

    // Slumpa bakgrund vid sidladdning (stabil inom sessionen per klass).
    // Bara bakgrunden skrivs (mot senaste versionen) — den lokala kopian
    // kan vara inaktuell precis efter sidladdning, se saveBackground.
    // Har läraren själv valt en bild i dag slumpas den inte bort (#64).
    if (isTeacher) {
      const key = classId ?? "__noclass__";
      const firstInSession = !randomizedThisSession.has(key);
      randomizedThisSession.add(key);
      if (shouldAutoRandomize(settings.background, { firstInSession }, serverNow())) {
        settings.background.current = pickRandomBg() || settings.background.current;
        settings.background.pickedOn = "";
        void saveBackground(data, classId, settings.background.current, { auto: true });
      }
    }

    renderDisplay();
    showBackground(settings.background.current);
    if (isTeacher) { syncPanel(); }
  },

  async unmount() {
    for (const stop of this._stops ?? []) { try { stop(); } catch { /* ok */ } }
    this._stops = null;
    this._renderNtStudents = null;
    this._sections?.destroy();
    this._sections = null;
    this._closePicker?.();
    this._closePicker = null;
    this._board?.destroy();
    this._board = null;
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
    </div>`;
}

// Panelens delar är utfällbara (issue #66). Hälsningen ligger överst
// (issue #69) men stängd; det som används varje morgon är öppet;
// hälsning och bakgrund visar en sammanfattning på rubrikraden.
const PANEL_DEFAULTS = { tasks: true, praise: true, greeting: false, background: false };

function renderPanel() {
  return `
    <div class="morgon__panel-scroll">
      ${collapsibleHTML({ key: "greeting", className: "morgon__section", icon: icon("sunrise"), title: "Hälsning", body: `
        <div class="morgon__variant">
          <label><input type="radio" name="mg-variant" value="godmorgon"> Godmorgon</label>
          <label><input type="radio" name="mg-variant" value="valkommen"> Välkommen</label>
        </div>
        <input class="morgon__greet-input" type="text" autocomplete="off"
          aria-label="Redigera hälsning" placeholder="Godmorgon 4A!">
        <p class="morgon__hint">Följer klassvalet — skriv här för att åsidosätta.</p>` })}

      ${collapsibleHTML({ key: "tasks", className: "morgon__section", icon: icon("check"), title: "Att göra", body: `
        <div class="morgon__tasklist" role="group" aria-label="Dagens uppgifter"></div>
        <div class="morgon__addtask">
          <input class="morgon__addtask-input" type="text" placeholder="Lägg till egen uppgift…" autocomplete="off" aria-label="Ny uppgift">
          <button class="btn btn--icon morgon__addtask-btn" title="Lägg till uppgift" aria-label="Lägg till uppgift">${icon("plus")}</button>
        </div>
        <p class="morgon__hint">Listan visas i den ordning du kryssar i.</p>` })}

      ${collapsibleHTML({ key: "praise", className: "morgon__section", icon: icon("star"), title: "Bra jobbat", body: `
        <label class="morgon__show"><input type="checkbox" class="morgon__show-nt"> Visa Bra jobbat-tavlan</label>
        <div class="morgon__ntstudents" role="group" aria-label="Elever"></div>
        <div class="morgon__addtask">
          <input class="morgon__ntfree-input" type="text" placeholder="Fritext, t.ex. hela bordsgrupp 3…" autocomplete="off" aria-label="Fritext till Bra jobbat">
          <button class="btn btn--icon morgon__ntfree-btn" title="Lägg till" aria-label="Lägg till fritext">${icon("plus")}</button>
        </div>
        <button class="btn btn--ghost morgon__ntclear">${icon("trash")}<span>Töm Bra jobbat</span></button>` })}

      ${collapsibleHTML({ key: "background", className: "morgon__section", icon: icon("image"), title: "Bakgrund", body: `
        <div class="morgon__bg-buttons">
          <button class="btn morgon__bg-random">${icon("refresh")}<span>Slumpa</span></button>
          <button class="btn morgon__bg-pick" aria-haspopup="dialog">${icon("image")}<span>Välj bild</span></button>
        </div>
        <p class="morgon__hint morgon__bg-hint"></p>
        <div class="morgon__addtask">
          <input class="morgon__bg-url" type="url" placeholder="Egen bild-URL…" autocomplete="off" aria-label="Egen bild-URL">
          <button class="btn btn--icon morgon__bg-urlbtn" title="Lägg till bild-URL" aria-label="Lägg till bild-URL">${icon("plus")}</button>
        </div>
        <label class="btn btn--ghost morgon__bg-upload">
          ${icon("upload")}<span>Ladda upp egen bild</span>
          <input class="morgon__bg-file" type="file" accept="image/*" hidden>
        </label>` })}
    </div>`;
}

/** Bakgrundens sammanfattning: miniatyr + kategori (eller "Egen bild"). */
function bgSummaryHTML(bg) {
  const url = bg?.current ?? "";
  if (!url) return `<span>Ingen bild</span>`;
  const img = findImage(url);
  const label = img
    ? [categoryById(img.category)?.label, img.place].filter(Boolean).join(" · ")
    : "Egen bild";
  return `<span>${escapeHtml(label)}</span>`
    + `<img class="morgon__bg-thumb" src="${escapeAttr(thumbUrl(url))}" alt="" loading="lazy">`;
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
