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
import { praiseEditorHTML, mountPraiseEditor } from "../ui/praise-editor.js";
import {
  WEEKDAYS,
  normalize, loadMorning, saveMorning, saveBackground, watchMorning,
  studentTextFor, seedStudentText, orderedTasks, greetingText, currentPraise, praiseIsStale,
} from "../lib/morning.js";
import { editPraise as editPraiseShared } from "../lib/praise-edit.js";
import { serverNow } from "../lib/clock.js";
import {
  categoryById, seasonFor, pickSeasonBg, shouldAutoRandomize, dayKey, findImage, thumbUrl,
} from "../lib/backgrounds.js";
import { openBgPicker, closeBgPicker } from "../ui/bg-picker.js";
import { collapsibleHTML, mountCollapsibles } from "../ui/collapsible.js";
import { createCornerLayer, createPlacementSharer, watchStudentPlacement } from "../widgets/host.js";
import { watchDockCovered, DOCK_SOFT_ATTR, DOCK_WALL_ATTR } from "../lib/dock.js";
import { isPreviewWindow } from "../sync.js";
import { mountWidgetSettings, widgetsSummary } from "../widgets/settings-ui.js";
import { normalizeMorningWidgets } from "../widgets/registry.js";

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
      // Guldstjärna, "Bra jobbat" och guldstreck kommer från komponenten (#78);
      // strecket får samma mått som under hälsningen (#71).
      rule: "morgon__rule",
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
    board.el.hidden = true;
    stage.append(board.el);
    this._board = board;
    let clearNt = () => {};

    // Widgets i hörnen (issue #115). Kortet och Bra jobbat-tavlan får aldrig
    // skymmas — en widget som skulle göra det krymps i sitt hörn, och flyttas
    // till närmaste lediga hörn först när inte ens S ryms (#119).
    let widgetsUI = null;
    // Elevskärmen delar var widgetarna hamnade med lärarens panel (#119) —
    // aldrig förhandsvisningen, den är bara en bild av elevskärmen.
    const sharePlacement = view === "student" && !isPreviewWindow() ? createPlacementSharer(classId) : null;
    const corners = createCornerLayer(stage, {
      view, classId, sync,
      obstacles: () => [$(".morgon__card"), board.el],
      obstacleNames: () => ["kortet", "Bra jobbat-tavlan"],
      onPlaced: (placed) => { widgetsUI?.setPlacement(placed); sharePlacement?.(placed); },
    });
    this._corners = corners;
    // Elevskärm-dockan viker undan för widgetarna (host.js) — helst inte in
    // över kortet eller Bra jobbat-tavlan, aldrig över lärarpanelen (#120,
    // js/lib/dock.js).
    if (isTeacher) {
      for (const x of [$(".morgon__card"), board.el]) x?.setAttribute(DOCK_SOFT_ATTR, "");
      $(".morgon__panel")?.setAttribute(DOCK_WALL_ATTR, "");
    }
    // Kortets och tavlans storlek ändras med innehållet → lägg ut hörnen igen.
    if (typeof ResizeObserver === "function") {
      let frame = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => corners.layout());
      });
      ro.observe(stage);
      ro.observe($(".morgon__card"));
      ro.observe(board.el);
      this._cornersRO = () => { cancelAnimationFrame(frame); ro.disconnect(); };
    }
    // Kortet glider (padding-övergång) när panelen eller tavlan växlar.
    $(".morgon__center").addEventListener("transitionend", (e) => {
      if (e.target === e.currentTarget) corners.layout();
    });

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
      corners.set(settings.widgets);
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

    // Ändring i Bra jobbat-listan — samma regel som i Lektionsplaneringen
    // (js/lib/praise-edit.js): en lista från förra veckan arkiveras och
    // töms FÖRST, annars hamnar nya namn i förra veckans lista.
    const editPraise = (fn) => editPraiseShared({ data, classId, get: () => settings, commit }, fn);

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
        const day = e.target.closest("input[data-weekday]");
        if (day?.checked) {
          const next = clone();
          const t = next.tasks.find((x) => x.id === day.dataset.weekday);
          if (t) t.weekday = day.value;
          commit(next).then(renderTaskControls); // "Eleverna ser"-raden bär veckodagen
        }
      });
      taskList.addEventListener("click", (e) => {
        const editBtn = e.target.closest("button[data-edit]");
        if (editBtn) { startEdit(editBtn.dataset.edit); return; }
        if (e.target.closest("button[data-edit-save]")) { saveEdit(); return; }
        if (e.target.closest("button[data-edit-cancel]")) { cancelEdit(); return; }
        const resetBtn = e.target.closest("button[data-reset]");
        if (resetBtn) { resetText(resetBtn.dataset.reset); return; }
        const delBtn = e.target.closest("button[data-del]");
        if (delBtn) {
          const next = clone();
          next.tasks = next.tasks.filter((x) => x.id !== delBtn.dataset.del);
          commit(next).then(renderTaskControls); // rad borta ur listan
        }
      });

      // ---- Redigera elevtexten direkt i raden (issue #87, ingen prompt()) ----
      // Fast uppgift: raden "Eleverna ser" blir ett textfält. Egen uppgift:
      // namnet (= elevtexten) redigeras i raden. Enter/✓ sparar, Esc/✕
      // avbryter, klick utanför sparar. Tom text sparas aldrig.
      let editing = null; // { id } medan ett textfält är öppet
      let rebuilding = false;
      const editInput = () => taskList.querySelector(".morgon__task-edit");

      function startEdit(id) {
        const t = settings.tasks.find((x) => x.id === id);
        if (!t || t.kind === "starten") return;
        editing = { id };
        renderTaskControls();
        const input = editInput();
        input?.focus();
        input?.select();
      }
      function endEdit({ focusPen }) {
        const id = editing?.id;
        editing = null;
        renderTaskControls();
        if (focusPen && id) taskList.querySelector(`button[data-edit="${CSS.escape(id)}"]`)?.focus();
      }
      function cancelEdit({ fromBlur = false } = {}) {
        if (editing) endEdit({ focusPen: !fromBlur });
      }
      function saveEdit({ fromBlur = false } = {}) {
        const input = editInput();
        if (!editing || !input) return;
        const val = input.value.trim();
        if (!val) {
          // Tom text: klick utanför avbryter, Enter/✓ visar en diskret hint.
          if (fromBlur) { cancelEdit({ fromBlur }); return; }
          input.setAttribute("aria-invalid", "true");
          taskList.querySelector(".morgon__task-edithint")?.removeAttribute("hidden");
          input.focus();
          return;
        }
        const next = clone();
        const t = next.tasks.find((x) => x.id === editing.id);
        if (t && val !== studentTextFor(t)) {
          if (t.kind === "custom") t.label = val;
          t.studentText = val;
          void commit(next);
        } else if (t?.kind === "custom" && t.label !== val) {
          t.label = val; // äldre data där namn och elevtext skilde sig
          void commit(next);
        }
        endEdit({ focusPen: !fromBlur });
      }
      function resetText(id) {
        const original = seedStudentText(id);
        if (original == null) return;
        const next = clone();
        const t = next.tasks.find((x) => x.id === id);
        if (t) t.studentText = original;
        editing = null;
        void commit(next);
        renderTaskControls();
        taskList.querySelector(`button[data-edit="${CSS.escape(id)}"]`)?.focus();
      }
      // Knapparna i redigeringsläget tar inte fokus från textfältet — annars
      // hinner "klick utanför sparar" köra innan ✕ (i webbläsare där knappar
      // inte får fokus vid klick blir relatedTarget null).
      taskList.addEventListener("pointerdown", (e) => {
        if (e.target.closest("[data-edit-save], [data-edit-cancel], .morgon__task-editfoot [data-reset]")) e.preventDefault();
      });
      taskList.addEventListener("keydown", (e) => {
        if (!e.target.matches(".morgon__task-edit")) return;
        if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
      });
      taskList.addEventListener("input", (e) => {
        if (!e.target.matches(".morgon__task-edit")) return;
        e.target.removeAttribute("aria-invalid");
        taskList.querySelector(".morgon__task-edithint")?.setAttribute("hidden", "");
      });
      taskList.addEventListener("focusout", (e) => {
        if (rebuilding || !editing || !e.target.matches(".morgon__task-edit")) return;
        const row = e.target.closest(".morgon__task");
        if (e.relatedTarget && row?.contains(e.relatedTarget)) return; // ✓/✕ i samma rad
        saveEdit({ fromBlur: true });
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
      // Elevlista, fritext och Töm: delad redigerare (issue #112, samma som
      // i Lektionsplaneringen). Ett tillagt namn slår på tavlan.
      const praiseEditor = mountPraiseEditor(panel.querySelector('[data-collapsible="praise"]'), {
        edit: editPraise,
        onAdded: (next) => { next.showNametavla = true; },
      });
      this._praiseEditor = praiseEditor;
      clearNt = () => void praiseEditor.clear();
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

      // ---- Widgets (issue #115) ----
      // Sektionen byggs om bara när listan ändrats UTIFRÅN (annat fönster);
      // egna ändringar ritar den själv, så ett fält man skriver i behåller fokus.
      let widgetsKey = JSON.stringify(settings.widgets);
      widgetsUI = mountWidgetSettings(panel.querySelector(".morgon__widgets-set"), {
        form: "morning",
        ctx: { view, classId, sync },
        get: () => settings.widgets,
        set: (list) => {
          const next = clone();
          next.widgets = normalizeMorningWidgets(list);
          widgetsKey = JSON.stringify(next.widgets);
          return commit(next);
        },
      });
      this._widgetsUI = widgetsUI;
      // Elevskärmens platser, så länge den är öppen (presence → store.studentOpen).
      let studentPlaced = null;
      const showStudent = () => widgetsUI.setStudentPlacement(ctx.store?.get().studentOpen ? studentPlaced : null);
      this._placementStops = [
        watchStudentPlacement(classId, (map) => { studentPlaced = map; showStudent(); }),
        ctx.store?.subscribe(["studentOpen"], showStudent),
        // Elevskärm-dockan lyfts över widgetarna; ryms den inte säger panelen till (#120).
        watchDockCovered((ids) => widgetsUI.setDockCovered(ids)),
      ];
      const syncWidgets = () => {
        const key = JSON.stringify(settings.widgets);
        if (key !== widgetsKey) { widgetsKey = key; widgetsUI.render(); }
      };

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
        taskList.querySelectorAll("input[data-weekday]").forEach((day) => {
          const t = settings.tasks.find((x) => x.id === day.dataset.weekday);
          if (t) day.checked = day.value === t.weekday;
        });
        syncNtStudents();
        syncBgHint();
        syncWidgets();
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
        sections.setSummary("widgets", widgetsSummary(settings.widgets, "morning"));
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
        // Uppgiften som redigeras kan ha tagits bort (t.ex. från en annan dator).
        if (editing && !settings.tasks.some((t) => t.id === editing.id)) editing = null;
        // Ett öppet textfält överlever ombyggnaden (ändring från annat fönster).
        const open = editing && editInput();
        const keep = open && { value: open.value, start: open.selectionStart, end: open.selectionEnd, focused: open === document.activeElement };
        rebuilding = true;
        try {
          taskList.innerHTML = settings.tasks.map((t) => taskRow(t, editing?.id === t.id)).join("");
        } finally { rebuilding = false; }
        const input = keep && editInput();
        if (input) {
          input.value = keep.value;
          if (keep.focused) { input.focus(); input.setSelectionRange(keep.start, keep.end); }
        }
        syncPanel();
      };

      function syncNtStudents() {
        praiseEditor.setPraise(currentPraise(settings));
      }
      function renderNtStudents() {
        if (!mounted()) return;
        praiseEditor.setStudents(students);
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
    this._praiseEditor?.destroy();
    this._praiseEditor = null;
    this._sections?.destroy();
    this._sections = null;
    this._closePicker?.();
    this._closePicker = null;
    this._board?.destroy();
    this._board = null;
    this._cornersRO?.();
    this._cornersRO = null;
    for (const off of this._placementStops ?? []) { try { off?.(); } catch { /* ok */ } }
    this._placementStops = null;
    this._widgetsUI?.destroy();
    this._widgetsUI = null;
    this._corners?.destroy();
    this._corners = null;
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
const PANEL_DEFAULTS = { tasks: true, praise: true, greeting: false, background: false, widgets: false };

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
        ${praiseEditorHTML()}` })}

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

      ${collapsibleHTML({ key: "widgets", className: "morgon__section", icon: icon("clock"), title: "Widgets", body: `
        <div class="morgon__widgets-set"></div>` })}
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

function taskRow(t, isEditing = false) {
  const id = escapeAttr(t.id);
  const shown = studentTextFor(t);
  // Startens veckodag: dag-chips (Mån–Fre) på egen rad under namnet
  // (issue #85) — ett klick, alltid synliga, får alltid plats i panelen.
  const control = t.kind === "starten"
    ? `<div class="morgon__days" role="radiogroup" aria-label="Veckodag för Starten">
         ${WEEKDAYS.map((d) => `<label class="morgon__day" title="${d}">
           <input type="radio" name="weekday-${id}" value="${d}" data-weekday="${id}" aria-label="${d}"${d === t.weekday ? " checked" : ""}>
           <span aria-hidden="true">${d.slice(0, 3)}</span>
         </label>`).join("")}
       </div>`
    : "";
  const checkbox = `<input type="checkbox" data-task="${id}">`;
  const pen = (title) => `<button class="morgon__task-btn" data-edit="${id}" title="${title}" aria-label="${title}">${icon("pencil")}</button>`;
  const editButtons = `
    <button class="morgon__task-btn" data-edit-save title="Spara (Enter)" aria-label="Spara">${icon("check")}</button>
    <button class="morgon__task-btn" data-edit-cancel title="Avbryt (Esc)" aria-label="Avbryt">${icon("x")}</button>`;
  const editField = (label) => `<input class="morgon__task-edit" type="text" value="${escapeAttr(shown)}" autocomplete="off" aria-label="${label}">`;
  const original = t.kind === "fixed" ? seedStudentText(t.id) : null;
  const modified = original != null && t.studentText !== original;
  const resetBtn = modified
    ? `<button class="morgon__task-link" data-reset="${id}" title="Tillbaka till: ${escapeAttr(original)}">Återställ</button>`
    : "";
  const editFoot = (extra = "") => `
    <div class="morgon__task-editfoot">
      <span class="morgon__task-edithint" role="alert" hidden>Texten kan inte vara tom.</span>
      ${extra}
    </div>`;

  let main = `
      <label class="morgon__task-main">
        ${checkbox}
        <span class="morgon__task-label" title="${escapeAttr(t.label)}">${escapeHtml(t.label)}</span>
      </label>`;
  let actions = t.kind === "custom"
    ? `${pen("Ändra uppgiften")}
       <button class="morgon__task-btn" data-del="${id}" title="Ta bort" aria-label="Ta bort uppgift">${icon("x")}</button>`
    : t.kind === "fixed" ? pen("Ändra elevtext") : "";
  // "Eleverna ser: …" — bara när elevtexten skiljer sig från namnet.
  let sub = shown !== t.label || modified
    ? `<div class="morgon__task-sub">
         <span class="morgon__task-student" title="${escapeAttr(shown)}">Eleverna ser: ${escapeHtml(shown)}</span>
         ${resetBtn}
       </div>`
    : "";

  if (isEditing && t.kind === "fixed") {
    actions = "";
    sub = `
      <div class="morgon__task-sub morgon__task-editor">
        <span class="morgon__task-sublabel">Eleverna ser:</span>
        ${editField(`Text som eleverna ser för ${t.label}`)}
        ${editButtons}
      </div>
      ${editFoot(resetBtn)}`;
  } else if (isEditing && t.kind === "custom") {
    main = `
      <div class="morgon__task-main morgon__task-editor">
        ${checkbox}
        ${editField("Uppgiftens text")}
      </div>`;
    actions = editButtons;
    sub = editFoot();
  }

  return `
    <div class="morgon__task${isEditing ? " is-editing" : ""}">
      ${main}
      ${control}
      <span class="morgon__task-actions">${actions}</span>
      ${sub}
    </div>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const escapeAttr = escapeHtml;
