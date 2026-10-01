/**
 * KLASSRÅD (issue #125, epic #124) — läraren håller klassråd med klassen:
 * dagordningen visas på elevskärmen och anteckningarna fylls i under mötet.
 *
 * Lärarvyn: Datum, Vecka, Ordförande och Sekreterare överst, sedan mallens
 * punkter i ordning (ikon, nummer, rubrik, dämpade hjälpfrågor och ett
 * anteckningsfält som växer). Läraren är oftast sekreterare själv, så
 * skrivflödet går utan mus:
 *   Enter              ny rad (= ny punkt i punktlistan på elevskärmen)
 *   Ctrl+Enter / Tab   (Tab i slutet av fältet) nästa punkts anteckningar
 *   Shift+Tab          föregående punkts anteckningar
 *   PageUp/PageDown    byt visad punkt (även i ett fält); pilarna när fokus
 *                      inte står i ett textfält
 *   F                  fokusläge (utanför fälten): bara punkterna kvar
 * "Följ mig" (standard): punkten läraren skriver i är den som visas för
 * eleverna. Av → läraren styr visningen själv (klick på en punkt, ← → eller
 * "Visa alla"). Allt sparas av sig självt (debounce 400 ms) — "Sparat".
 *
 * Punkt 2 (rollen "previous") visar rutan "Från förra klassrådet": det som
 * skrevs under "Till nästa klassråd" och "Till elevrådet" senast, med
 * datum; läraren bockar av rad för rad. Arkivet ("Tidigare klassråd") och
 * mallen ("Redigera mall…", js/modes/klassrad/template-dialog.js) står i
 * sidopanelen. Ändrad mall påverkar bara nya möten.
 *
 * Elevskärmen: ett lugnt, stort papper — KLASSRÅD, datum, vecka, ordförande
 * och sekreterare överst, sedan den visade punkten stort med anteckningarna
 * live som punktlista. "Visa alla" ger en översikt i två kolumner som skalas
 * så att allt ryms utan scroll. Ingen redigering, inga lärarkontroller.
 *
 * Eleverna ser det klassråd som senast SKICKADES UT med "Visa på elevskärm"
 * (issue #88, lägets onPresent) — öppnar läraren ett gammalt protokoll i
 * arkivet ändras inget för eleverna förrän hon trycker igen.
 *
 * Data (DATAMODELL.md, js/lib/klassrad.js): mötena ENDAST LOKALT i
 * classes/{cid}/klassrad (elevnamn och synpunkter — aldrig Firestore).
 * Mallen och sekreterarens förval privat per lärare i
 * teachers/{uid}/settings/klassrad (aldrig ett elevnamn). Live via
 * sync-bussen (`klassrad:state`); `rev` ordnar bussen mot storage-eventet
 * som hos Skrivtavlan.
 */

import { icon } from "../lib/icons.js";
import { currentTeacherName } from "../auth.js";
import { currentUid } from "../data/plans.js";
import { studentLabel } from "../lib/names.js";
import {
  KLASSRAD_EVENT as EVENT, KLASSRAD_SETTINGS_DOC, STATE_ID, SAVE_DEBOUNCE_MS, MAX_NAME, MAX_NOTES,
  klassradPath, klassradSettingsPath, templateFromSettings, isDefaultTemplate,
  withSecretaryPref, secretaryPref, secretaryDefault, teacherLabel,
  newMeeting, normalizeMeeting, hasContent, noteLines, pointNumbers, sortMeetings,
  previousFollowUp, notesNavTarget, stepShown, publicMeeting,
  isoDate, isIsoDate, weekOfDate, formatDate,
} from "../lib/klassrad.js";
import { openTemplateDialog, closeTemplateDialog } from "./klassrad/template-dialog.js";

const FOCUS_KEY = "classroom:klassrad:focus"; // fokusläget (sessionStorage, bara lärarvyn)
const MIN_FIT = 0.32; // minsta skalning på elevskärmen innan texten får rulla

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Skriver användaren i ett fält? (samma regel som js/ui/shortcuts.js) */
function inTextField(t) {
  if (!t || t.nodeType !== 1) return false;
  if (t.isContentEditable || t.matches("textarea, select")) return true;
  if (!t.matches("input")) return false;
  const type = (t.getAttribute("type") ?? "").toLowerCase();
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
}

/** Mötets namn i elevskärmspanelen ("Klassråd · 1 okt"). */
const meetingLabel = (m) => formatDate(m.date, { short: true });

// ---- Gemensam rendering (elevskärmen; rutan används även i lärarvyn) ---------

function numLabel(n) {
  return n != null ? `<span class="kr-num">${n}</span>` : "";
}

/** Rutan "Från förra klassrådet". `editable` = kryssrutor (lärarvyn). */
function prevBoxHTML(prev, done, { editable = false } = {}) {
  if (!prev) return "";
  const doneSet = new Set(done);
  const week = weekOfDate(prev.from.date);
  const head = `<h4 class="kr-prev__title">${icon("back")}<span>Från förra klassrådet</span>
    <span class="kr-prev__date">${esc(formatDate(prev.from.date, { short: true }))}${week ? ` · v. ${week}` : ""}</span></h4>`;
  if (!prev.groups.length) {
    return `<aside class="kr-prev">${head}<p class="kr-prev__none">Inget att följa upp från förra gången.</p></aside>`;
  }
  const many = prev.groups.length > 1;
  const groups = prev.groups.map((g) => `
    ${many ? `<p class="kr-prev__group">${esc(g.title)}</p>` : ""}
    <ul class="kr-prev__list">${g.items.map((it) => {
      const isDone = doneSet.has(it.key);
      return editable
        ? `<li class="${isDone ? "is-done" : ""}"><label><input type="checkbox" data-done="${esc(it.key)}" ${isDone ? "checked" : ""}>
            <span>${esc(it.text)}</span></label></li>`
        : `<li class="${isDone ? "is-done" : ""}"><span class="kr-prev__mark" aria-hidden="true">${isDone ? icon("check") : ""}</span>
            <span>${esc(it.text)}</span>${isDone ? `<span class="sr-only"> (gjort)</span>` : ""}</li>`;
    }).join("")}</ul>`).join("");
  return `<aside class="kr-prev">${head}${groups}</aside>`;
}

function notesListHTML(text, { emptyText = "" } = {}) {
  const lines = noteLines(text);
  if (!lines.length) return emptyText ? `<p class="kr-notes-empty">${esc(emptyText)}</p>` : "";
  return `<ul class="kr-notes-list">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

function headHTML(m) {
  const week = weekOfDate(m.date);
  const field = (label, value) => `<div><dt>${label}</dt><dd>${value ? esc(value) : `<span class="kr-blank">—</span>`}</dd></div>`;
  return `
    <h1 class="kr-head__title">Klassråd</h1>
    <dl class="kr-head__meta">
      ${field("Datum", formatDate(m.date))}
      ${field("Vecka", week ? String(week) : "")}
      ${field("Ordförande", m.chair)}
      ${field("Sekreterare", m.secretary)}
    </dl>`;
}

/** Elevskärmens kropp: den visade punkten stort, eller översikten. */
function bodyHTML(m, prev) {
  const nums = pointNumbers(m.points);
  if (m.shown === "all") {
    return `<div class="kr-all">${m.points.map((p, i) => `
      <section class="kr-mini">
        <h3 class="kr-mini__title"><span class="kr-ico">${icon(p.icon)}</span>${numLabel(nums[i])}<span>${esc(p.title)}</span></h3>
        ${notesListHTML(p.notes, { emptyText: "—" })}
      </section>`).join("")}</div>`;
  }
  const i = m.points.findIndex((p) => p.id === m.shown);
  const p = m.points[i];
  if (!p) return "";
  const label = p.notesLabel && p.notesLabel !== "Anteckningar" ? `<p class="kr-big__label">${esc(p.notesLabel)}</p>` : "";
  return `
    <article class="kr-big">
      <h2 class="kr-big__title"><span class="kr-ico">${icon(p.icon)}</span>${numLabel(nums[i])}<span>${esc(p.title)}</span></h2>
      ${p.prompts.length ? `<ul class="kr-big__prompts">${p.prompts.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
      ${p.role === "previous" ? prevBoxHTML(prev, m.followDone) : ""}
      ${label}
      ${notesListHTML(p.notes)}
    </article>`;
}

/**
 * Skala elevskärmens kropp så att allt ryms utan scroll: största faktorn
 * (≤ 1) där innehållet inte flödar över. Översikten (två kolumner) flödar
 * över i sidled (en tredje kolumn), den enskilda punkten nedåt.
 */
function fitBody(box) {
  const content = box.firstElementChild;
  if (!content || !box.clientHeight) return;
  const fits = () => box.scrollHeight <= box.clientHeight + 1 && content.scrollWidth <= content.clientWidth + 1;
  let lo = MIN_FIT;
  let hi = 1;
  box.style.setProperty("--kr-fit", "1");
  if (fits()) return;
  for (let k = 0; k < 9; k++) {
    const mid = (lo + hi) / 2;
    box.style.setProperty("--kr-fit", mid.toFixed(4));
    if (fits()) lo = mid; else hi = mid;
  }
  box.style.setProperty("--kr-fit", lo.toFixed(4));
}

// ---- Läget --------------------------------------------------------------------

export default {
  id: "klassrad",
  title: "Klassråd",
  icon: "gavel",

  async mount(el, ctx) {
    const offs = [];
    this._offs = offs; // städning registreras innan något startas
    const mode = this; // för onPresent (elevskärmspanelen, issue #88)

    const { view, activeClass, data, sync, store } = ctx;
    const isStudent = view === "student";

    if (!activeClass) {
      el.innerHTML = `
        <div class="mode-placeholder">
          <div class="mode-placeholder__icon">${icon("gavel", { size: 44, strokeWidth: 1.4 })}</div>
          <h1>Klassråd</h1>
          <p>${isStudent ? "Ingen klass vald." : "Välj en klass i topbaren för att hålla klassråd."}</p>
        </div>`;
      return;
    }

    const cid = activeClass.id;
    if (isStudent) mountStudent();
    else mountTeacher();

    // ---- Elevskärmen: bara papperet, följer läraren ----

    function mountStudent() {
      el.innerHTML = studentMarkup();
      const head = el.querySelector(".kr-head");
      const body = el.querySelector(".kr-body");
      const emptyEl = el.querySelector(".kr-empty");
      let lastRev = -1;
      let shown = null; // { meeting, prev }

      function draw() {
        if (!body.isConnected) return;
        const m = shown?.meeting ?? null;
        emptyEl.hidden = !!m;
        head.hidden = !m;
        body.hidden = !m;
        if (!m) return;
        head.innerHTML = headHTML(m);
        body.innerHTML = bodyHTML(m, shown.prev);
        body.classList.toggle("is-all", m.shown === "all");
        fitBody(body);
      }

      function apply(payload) {
        if (!payload || payload.cid !== cid) return;
        if (payload.rev < lastRev) return; // en sen sparning — bussen har redan nyare
        lastRev = payload.rev;
        shown = { meeting: payload.meeting ?? null, prev: payload.prev ?? null };
        draw();
      }

      offs.push(data.watch(klassradPath(cid), (docs) => {
        const state = docs.find((d) => d.id === STATE_ID);
        const meetings = docs.map(normalizeMeeting).filter(Boolean);
        const m = meetings.find((x) => x.id === state?.presented) ?? null;
        const rev = Math.max(Number(state?.rev) || 0, m?.rev ?? 0);
        apply({ cid, meeting: publicMeeting(m), prev: m ? previousFollowUp(meetings, m) : null, rev });
      }));
      offs.push(sync.on(EVENT, ({ payload }) => apply(payload)));

      if (typeof ResizeObserver === "function") {
        let frame = 0;
        const ro = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => fitBody(body)); });
        ro.observe(el.querySelector(".kr-paper"));
        offs.push(() => { cancelAnimationFrame(frame); ro.disconnect(); });
      }
      document.fonts?.ready?.then(() => { if (body.isConnected) fitBody(body); }, () => {});
    }

    // ---- Lärarvyn ----

    function mountTeacher() {
      el.innerHTML = teacherMarkup();
      const $ = (s) => el.querySelector(s);
      const root = $(".kr");
      const dateInput = $('input[name="kr-date"]');
      const weekOut = $(".kr-week");
      const chairInput = $('input[name="kr-chair"]');
      const secInput = $('input[name="kr-secretary"]');
      const pointsEl = $(".kr-points");
      const archiveEl = $(".kr-archive");
      const shownLabel = $(".kr-shownlabel");
      const savedEl = $(".kr-saved");
      const followBtn = $('[data-act="follow"]');
      const allBtn = $('[data-act="all"]');
      const prevBtn = $('[data-act="prev"]');
      const nextBtn = $('[data-act="next"]');
      const focusBtn = $('[data-act="focus"]');
      const readingEl = $(".kr-reading");

      const uid = currentUid();
      const settingsPath = klassradSettingsPath(uid);
      const path = klassradPath(cid);
      const teacherName = () => teacherLabel(currentTeacherName());

      /** @type {Array<ReturnType<typeof normalizeMeeting>>} */
      let meetings = [];
      const saved = new Set(); // id:n på möten som finns i lagringen
      let cur = null;
      let presented = null;
      let follow = true;
      let rev = 0;
      let loaded = false;
      let settingsDoc = null;
      let template = templateFromSettings(null);
      let students = [];
      let lastPoint = null; // senast visade punkt (för "Visa alla" av)
      let saveTimer = 0;
      let confirmId = null; // möte vars borttagning väntar på bekräftelse

      const curM = () => meetings.find((m) => m.id === cur) ?? null;
      const presentedM = () => meetings.find((m) => m.id === presented) ?? null;
      const nextRev = () => (rev = Math.max(Date.now(), rev + 1));
      const textareas = () => [...pointsEl.querySelectorAll("textarea[data-notes]")];

      // ---- Tillstånd ut: bussen direkt, lagringen med debounce ----

      function publish() {
        if (!loaded) return;
        const m = presentedM();
        const r = nextRev();
        if (m) m.rev = r;
        sync.publish(EVENT, { cid, meeting: publicMeeting(m), prev: m ? previousFollowUp(meetings, m) : null, rev: r });
      }

      function saveMeeting(m) {
        if (!m) return;
        if (saveTimer && m.id === cur) { clearTimeout(saveTimer); saveTimer = 0; }
        saved.add(m.id);
        void data.put(path, m).then(() => {
          savedEl.hidden = false;
          savedEl.classList.remove("is-pending");
          savedEl.lastElementChild.textContent = "Sparat";
        });
      }

      function saveState() {
        void data.put(path, { id: STATE_ID, cur: saved.has(cur) ? cur : null, presented, follow, rev });
      }

      /** En ändring i det öppna mötet: ut på bussen direkt, sparas strax. */
      function changed(m = curM(), { now = false } = {}) {
        if (!m) return;
        m.editedAt = Date.now();
        if (m.id === presented) publish();
        savedEl.hidden = false;
        savedEl.classList.add("is-pending");
        savedEl.lastElementChild.textContent = "Sparar…";
        clearTimeout(saveTimer);
        if (now) saveMeeting(m);
        else saveTimer = setTimeout(() => { saveTimer = 0; saveMeeting(m); }, SAVE_DEBOUNCE_MS);
        if (!saved.has(m.id)) { saved.add(m.id); renderArchive(); saveState(); }
      }

      const flush = () => { if (saveTimer) saveMeeting(curM()); };
      window.addEventListener("pagehide", flush);
      offs.push(() => { window.removeEventListener("pagehide", flush); flush(); clearTimeout(saveTimer); });

      // ---- Rapportera lägets "sak" och skicka ut (issue #88) ----

      function updateSpot() {
        const m = curM();
        const pm = presentedM();
        const spot = {
          modeId: "klassrad",
          current: m ? { id: m.id, label: meetingLabel(m) } : null,
          presented: pm ? { id: pm.id, label: meetingLabel(pm) } : null,
        };
        if (JSON.stringify(store?.get().presentSpot) !== JSON.stringify(spot)) store?.set({ presentSpot: spot });
      }

      mode.onPresent = () => {
        const m = curM();
        if (m && !saved.has(m.id)) saveMeeting(m);
        else flush();
        presented = m?.id ?? null;
        saveState();
        renderArchive();
        drawShown();
        publish(); // en redan öppen elevskärm får klassrådet direkt
        updateSpot();
      };
      offs.push(() => { mode.onPresent = null; store?.set({ presentSpot: null }); });

      // ---- Rendering ----

      function autoGrow(ta) {
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight + 2}px`;
      }

      function drawFields() {
        const m = curM();
        if (!m) return;
        if (document.activeElement !== dateInput) dateInput.value = m.date;
        const week = weekOfDate(m.date);
        weekOut.textContent = week ? String(week) : "—";
        if (document.activeElement !== chairInput) chairInput.value = m.chair;
        if (document.activeElement !== secInput) secInput.value = m.secretary;
        $('[data-act="me"]').title = `Fyll i ${teacherName()} som sekreterare`;
        const today = isoDate();
        const old = saved.has(m.id) && m.date !== today && sortMeetings(meetings.filter((x) => saved.has(x.id)))[0]?.id !== m.id;
        readingEl.hidden = !old;
        if (old) readingEl.querySelector("span").textContent = `Du har ett tidigare klassråd öppet (${formatDate(m.date)}). Ändringar sparas i det.`;
      }

      function drawPickers() {
        const opts = `<option value="">Elev…</option>${students.map((s) => `<option>${esc(s)}</option>`).join("")}`;
        for (const sel of el.querySelectorAll("select.kr-pick")) {
          sel.innerHTML = opts;
          sel.disabled = students.length === 0;
          sel.title = students.length ? "Välj en elev ur klassens elevlista" : "Elevlistan är tom";
        }
      }

      function renderPoints() {
        const m = curM();
        if (!m) { pointsEl.innerHTML = ""; return; }
        const nums = pointNumbers(m.points);
        const prev = previousFollowUp(meetings, m);
        pointsEl.innerHTML = m.points.map((p, i) => `
          <li class="kr-tpoint" data-point="${esc(p.id)}">
            <div class="kr-tpoint__head">
              <span class="kr-ico" aria-hidden="true">${icon(p.icon)}</span>${numLabel(nums[i])}
              <h3 class="kr-tpoint__title">${esc(p.title) || `<span class="kr-blank">Utan rubrik</span>`}</h3>
              <button type="button" class="btn btn--ghost kr-showbtn" data-show="${esc(p.id)}" aria-pressed="false">
                ${icon("monitor")}<span>Visa</span></button>
            </div>
            ${p.prompts.length ? `<ul class="kr-tpoint__prompts">${p.prompts.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
            ${p.role === "previous" ? `<div class="kr-prevslot">${prevBoxHTML(prev, m.followDone, { editable: true })}</div>` : ""}
            <label class="kr-tpoint__label" for="kr-notes-${esc(p.id)}">${esc(p.notesLabel)}</label>
            <textarea class="kr-notes" id="kr-notes-${esc(p.id)}" data-notes="${esc(p.id)}" rows="2" maxlength="${MAX_NOTES}"
              spellcheck="true" placeholder="Skriv — Enter ger ny rad, Tab går till nästa punkt"></textarea>
          </li>`).join("");
        for (const ta of textareas()) {
          ta.value = m.points.find((p) => p.id === ta.dataset.notes)?.notes ?? "";
          autoGrow(ta);
        }
        drawShown();
      }

      function drawShown() {
        const m = curM();
        if (!m) return;
        const live = presented === m.id;
        const all = m.shown === "all";
        for (const li of pointsEl.querySelectorAll(".kr-tpoint")) {
          const on = !all && li.dataset.point === m.shown;
          li.classList.toggle("is-shown", on);
          li.classList.toggle("is-all", all);
          const b = li.querySelector(".kr-showbtn");
          b.setAttribute("aria-pressed", String(on));
          b.lastElementChild.textContent = on ? (live ? "Visas för eleverna" : "Vald att visas") : "Visa";
          b.title = on
            ? (live ? "Den här punkten syns på elevskärmen" : "Den här punkten visas när du skickar ut klassrådet med Visa på elevskärm")
            : "Visa den här punkten för eleverna";
        }
        allBtn.setAttribute("aria-pressed", String(all));
        followBtn.setAttribute("aria-pressed", String(follow));
        followBtn.classList.toggle("is-off", !follow);
        const i = m.points.findIndex((p) => p.id === m.shown);
        prevBtn.disabled = !all && i <= 0;
        nextBtn.disabled = !all && i >= m.points.length - 1;
        const nums = pointNumbers(m.points);
        const what = all ? "alla punkter" : (i >= 0 ? `${nums[i] != null ? `${nums[i]}. ` : ""}${m.points[i].title}` : "—");
        shownLabel.innerHTML = live
          ? `<span class="kr-dot is-live"></span>Eleverna ser: <strong>${esc(what)}</strong>`
          : `<span class="kr-dot"></span>Visas när du skickar ut: <strong>${esc(what)}</strong>`;
        shownLabel.title = live ? "" : "Tryck Visa på elevskärm för att visa det här klassrådet för eleverna";
      }

      function renderArchive() {
        const list = sortMeetings(meetings.filter((m) => saved.has(m.id) && m.id !== cur));
        archiveEl.innerHTML = list.length ? `<ul class="kr-archive__list">${list.map((m) => {
          const week = weekOfDate(m.date);
          const live = m.id === presented
            ? `<span class="kr-archive__live" title="Det här klassrådet visas på elevskärmen">${icon("monitor", { size: 13 })}</span>` : "";
          const confirm = confirmId === m.id;
          return `<li class="kr-archive__item${confirm ? " is-confirm" : ""}">
            <button type="button" class="btn btn--ghost kr-archive__open" data-open="${esc(m.id)}"
              title="Öppna, läs och redigera klassrådet">
              <span class="kr-archive__date">${esc(formatDate(m.date, { short: true, year: true }))}</span>${live}
              <span class="kr-archive__week">${week ? `v. ${week}` : ""}</span></button>
            ${confirm
              ? `<span class="kr-archive__confirm" role="group" aria-label="Bekräfta borttagning">
                  <span>Ta bort för gott?</span>
                  <button type="button" class="btn kr-danger" data-confirm-del="${esc(m.id)}">Ta bort</button>
                  <button type="button" class="btn btn--ghost" data-cancel-del>Avbryt</button></span>`
              : `<button type="button" class="btn btn--ghost btn--icon kr-archive__del" data-del="${esc(m.id)}"
                  title="Ta bort klassrådet ${esc(formatDate(m.date))}" aria-label="Ta bort klassrådet ${esc(formatDate(m.date))}">${icon("trash")}</button>`}
          </li>`;
        }).join("")}</ul>` : `<p class="kr-sub">Inga tidigare klassråd ännu.</p>`;
        updateSpot();
      }

      function renderAll() {
        drawFields();
        renderPoints();
        renderArchive();
      }

      // ---- Visad punkt ----

      function scrollToPoint(id) {
        const li = pointsEl.querySelector(`[data-point="${CSS.escape(id)}"]`);
        li?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }

      function setShown(id, { focusNotes = false } = {}) {
        const m = curM();
        if (!m) return;
        if (id !== "all" && !m.points.some((p) => p.id === id)) return;
        if (id !== "all") lastPoint = id;
        if (m.shown !== id) {
          m.shown = id;
          changed(m);
        }
        drawShown();
        if (id === "all") return;
        if (focusNotes && follow) {
          const ta = pointsEl.querySelector(`textarea[data-notes="${CSS.escape(id)}"]`);
          if (ta && document.activeElement !== ta) {
            ta.focus({ preventScroll: true });
            ta.setSelectionRange(ta.value.length, ta.value.length);
          }
        }
        scrollToPoint(id);
      }

      function step(dir) {
        const m = curM();
        if (!m?.points.length) return;
        if (m.shown === "all") {
          // Ur översikten: tillbaka till den senast visade punkten (eller första/sista).
          const back = m.points.some((p) => p.id === lastPoint) ? lastPoint : m.points.at(dir > 0 ? 0 : -1).id;
          setShown(back, { focusNotes: true });
          return;
        }
        setShown(stepShown(m.points, m.shown, dir), { focusNotes: true });
      }

      function toggleAll() {
        const m = curM();
        if (!m) return;
        if (m.shown === "all") setShown(lastPoint && m.points.some((p) => p.id === lastPoint) ? lastPoint : (m.points[0]?.id ?? "all"), { focusNotes: true });
        else setShown("all");
      }

      function setFollow(on) {
        follow = on;
        saveState();
        drawShown();
        const ta = document.activeElement;
        if (on && ta?.dataset?.notes && curM()?.shown !== "all") setShown(ta.dataset.notes);
      }

      // ---- Mötet: öppna, nytt, ta bort ----

      /** Ett osparat, tomt möte försvinner när läraren lämnar det. */
      function dropIfBlank(id) {
        const m = meetings.find((x) => x.id === id);
        if (m && !saved.has(m.id) && !hasContent(m)) meetings = meetings.filter((x) => x !== m);
      }

      function openMeeting(id) {
        if (id === cur) return;
        flush();
        const prevCur = cur;
        cur = meetings.some((m) => m.id === id) ? id : null;
        dropIfBlank(prevCur);
        confirmId = null;
        lastPoint = null;
        saveState();
        renderAll();
        window.scrollTo({ top: 0 });
      }

      function startNew() {
        const m = curM();
        if (m && !saved.has(m.id) && !hasContent(m)) {
          // Det öppna mötet är redan nytt och tomt — bara dagens datum.
          m.date = isoDate();
          drawFields();
          textareas()[0]?.focus();
          return;
        }
        const fresh = newMeeting(template, { secretary: secretaryDefault(settingsDoc, cid, currentTeacherName()) });
        meetings.push(fresh);
        openMeeting(fresh.id);
        textareas()[0]?.focus({ preventScroll: true });
      }

      function deleteMeeting(id) {
        const m = meetings.find((x) => x.id === id);
        if (!m) return;
        meetings = meetings.filter((x) => x !== m);
        saved.delete(id);
        confirmId = null;
        void data.remove(path, id);
        // Tas det utskickade klassrådet bort blir elevskärmen tom — den
        // byter aldrig i tysthet till ett annat (issue #88).
        if (presented === id) { presented = null; publish(); }
        saveState();
        renderArchive();
        // Rutan "Från förra klassrådet" kan ha hämtat från det borttagna.
        renderPoints();
      }

      // ---- Mallen ----

      function saveSettings(next) {
        settingsDoc = next;
        void data.put(settingsPath, next);
      }

      async function editTemplate() {
        await openTemplateDialog({
          template,
          onSave: (t) => {
            const { template: _t, ...rest } = settingsDoc ?? {};
            saveSettings({ ...rest, id: KLASSRAD_SETTINGS_DOC, template: isDefaultTemplate(t) ? null : t });
            applyTemplate(templateFromSettings({ template: t }));
          },
        });
      }
      offs.push(() => closeTemplateDialog());

      /** Ny mall: bara ett nytt, tomt (osparat) möte byter punkter. */
      function applyTemplate(t) {
        template = t;
        const m = curM();
        if (m && !saved.has(m.id) && !hasContent(m)) {
          const fresh = newMeeting(template, { date: m.date, secretary: m.secretary });
          Object.assign(m, { points: fresh.points, shown: fresh.shown });
          renderPoints();
        }
      }

      // ---- Sekreteraren: "Jag" + senaste valet per klass ----

      function rememberSecretary(value) {
        const before = settingsDoc?.secretary?.[cid] ?? null;
        if (secretaryPref(value, currentTeacherName()) === before) return;
        saveSettings(withSecretaryPref(settingsDoc, cid, value, currentTeacherName()));
      }

      function setName(field, value, { remember = false } = {}) {
        const m = curM();
        if (!m) return;
        const v = String(value ?? "").replace(/\s+/g, " ").slice(0, MAX_NAME);
        m[field] = v.trim();
        (field === "chair" ? chairInput : secInput).value = v;
        changed(m);
        if (remember && field === "secretary") rememberSecretary(m.secretary);
      }

      // ---- Händelser ----

      dateInput.addEventListener("change", () => {
        const m = curM();
        if (!m || !isIsoDate(dateInput.value)) { drawFields(); return; }
        m.date = dateInput.value;
        changed(m);
        drawFields();
        renderPoints(); // "förra klassrådet" räknas från datumet
        renderArchive();
      });
      chairInput.addEventListener("input", () => setName("chair", chairInput.value));
      secInput.addEventListener("input", () => setName("secretary", secInput.value));
      secInput.addEventListener("change", () => rememberSecretary(curM()?.secretary ?? ""));
      for (const sel of el.querySelectorAll("select.kr-pick")) {
        sel.addEventListener("change", () => {
          if (!sel.value) return;
          setName(sel.dataset.for, sel.value, { remember: true });
          sel.value = "";
        });
      }

      pointsEl.addEventListener("input", (e) => {
        const ta = e.target.closest("textarea[data-notes]");
        const m = curM();
        const p = m?.points.find((x) => x.id === ta?.dataset.notes);
        if (!p) return;
        p.notes = ta.value.slice(0, MAX_NOTES);
        autoGrow(ta);
        changed(m);
      });

      pointsEl.addEventListener("focusin", (e) => {
        const ta = e.target.closest("textarea[data-notes]");
        if (!ta || !follow || curM()?.shown === "all") return;
        setShown(ta.dataset.notes);
      });

      pointsEl.addEventListener("keydown", (e) => {
        const ta = e.target.closest("textarea[data-notes]");
        if (!ta || e.isComposing) return;
        const all = textareas();
        const index = all.indexOf(ta);
        const to = notesNavTarget({
          key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
          selectionStart: ta.selectionStart, selectionEnd: ta.selectionEnd, length: ta.value.length,
          index, count: all.length,
        });
        if (to == null) return;
        e.preventDefault();
        const next = all[to];
        next.focus({ preventScroll: true });
        next.setSelectionRange(next.value.length, next.value.length);
        scrollToPoint(next.dataset.notes);
      });

      pointsEl.addEventListener("change", (e) => {
        const box = e.target.closest("input[data-done]");
        const m = curM();
        if (!box || !m) return;
        const set = new Set(m.followDone);
        if (box.checked) set.add(box.dataset.done); else set.delete(box.dataset.done);
        m.followDone = [...set];
        box.closest("li")?.classList.toggle("is-done", box.checked);
        changed(m);
      });

      // Klick på en punkt (inte i fälten) = visa den för eleverna.
      pointsEl.addEventListener("click", (e) => {
        const show = e.target.closest("[data-show]");
        if (show) { setShown(show.dataset.show); return; }
        if (e.target.closest("textarea, input, label, button, a")) return;
        const li = e.target.closest(".kr-tpoint");
        if (li) setShown(li.dataset.point);
      });

      root.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || !root.contains(b)) return;
        if (b.dataset.open) { openMeeting(b.dataset.open); return; }
        if (b.dataset.del) { confirmId = b.dataset.del; renderArchive(); archiveEl.querySelector("[data-confirm-del]")?.focus(); return; }
        if (b.dataset.confirmDel) { deleteMeeting(b.dataset.confirmDel); return; }
        if (b.hasAttribute("data-cancel-del")) { confirmId = null; renderArchive(); return; }
        switch (b.dataset.act) {
          case "prev": step(-1); break;
          case "next": step(1); break;
          case "all": toggleAll(); break;
          case "follow": setFollow(!follow); break;
          case "focus": setFocusMode(!root.classList.contains("is-focus")); break;
          case "new": startNew(); break;
          case "template": void editTemplate(); break;
          case "latest": {
            const latest = sortMeetings(meetings.filter((m) => saved.has(m.id) || m.id === cur))[0];
            if (latest) openMeeting(latest.id);
            break;
          }
          case "me": setName("secretary", teacherName(), { remember: true }); secInput.focus(); break;
          default: break;
        }
      });

      // ---- Fokusläget ----

      function setFocusMode(on) {
        root.classList.toggle("is-focus", on);
        focusBtn.setAttribute("aria-pressed", String(on));
        focusBtn.lastElementChild.textContent = on ? "Avsluta fokus" : "Fokusläge";
        try { if (on) sessionStorage.setItem(FOCUS_KEY, "1"); else sessionStorage.removeItem(FOCUS_KEY); } catch { /* ok */ }
      }
      try { setFocusMode(sessionStorage.getItem(FOCUS_KEY) === "1"); } catch { setFocusMode(false); }

      // ---- Kortkommandon: PageUp/PageDown, pilar och F ----

      const modalOpen = () => document.querySelector(
        ".kr-modal, .quick-note[data-open], .help[data-open], .ca-modal, .ms-modal, .mc-modal, .sp-modal, .rap-modal, .pwchange") != null;

      const onKey = (e) => {
        if (e.defaultPrevented || e.altKey || modalOpen()) return;
        const t = e.target;
        if (t !== document.body && !el.contains(t)) return;
        if (e.key === "PageDown" || e.key === "PageUp") {
          if (e.ctrlKey || e.metaKey || e.shiftKey) return;
          e.preventDefault();
          step(e.key === "PageDown" ? 1 : -1);
          return;
        }
        if (e.ctrlKey || e.metaKey || inTextField(t)) return;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); return; }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); return; }
        if ((e.key === "f" || e.key === "F") && !e.shiftKey) {
          e.preventDefault();
          setFocusMode(!root.classList.contains("is-focus"));
        }
      };
      document.addEventListener("keydown", onKey);
      offs.push(() => document.removeEventListener("keydown", onKey));

      // ---- Start: mallen (molnet) först, sedan mötena (lokalt, synkront) ----

      offs.push(data.watch(settingsPath, (docs) => {
        settingsDoc = docs.find((d) => d.id === KLASSRAD_SETTINGS_DOC) ?? null;
        const t = templateFromSettings(settingsDoc);
        if (JSON.stringify(t) !== JSON.stringify(template)) applyTemplate(t);
        // Förvalet kan komma från molnet efter att mötet skapats.
        const m = curM();
        if (loaded && m && !saved.has(m.id) && !m.secretary) {
          m.secretary = secretaryDefault(settingsDoc, cid, currentTeacherName());
          drawFields();
        }
      }));

      offs.push(data.watch(`classes/${cid}/students`, (docs) => {
        students = docs.filter((s) => s.active !== false).map(studentLabel)
          .sort((a, b) => a.localeCompare(b, "sv"));
        drawPickers();
      }));

      offs.push(data.watch(path, (docs) => {
        if (loaded) return; // lärarvyn är enda skribenten — bara första svaret
        loaded = true;
        meetings = docs.map(normalizeMeeting).filter(Boolean);
        for (const m of meetings) saved.add(m.id);
        const state = docs.find((d) => d.id === STATE_ID);
        follow = state?.follow !== false;
        rev = Math.max(Number(state?.rev) || 0, ...meetings.map((m) => m.rev));
        presented = meetings.some((m) => m.id === state?.presented) ? state.presented : null;
        // Det öppna klassrådet öppnas igen samma dag; annars ett nytt, tomt
        // möte (de gamla ligger i arkivet).
        const today = isoDate();
        const last = meetings.find((m) => m.id === state?.cur);
        const reopen = last && (last.date === today || isoDate(last.editedAt) === today)
          ? last
          : sortMeetings(meetings).find((m) => m.date === today);
        if (reopen) cur = reopen.id;
        else {
          const fresh = newMeeting(template, { secretary: secretaryDefault(settingsDoc, cid, currentTeacherName()) });
          meetings.push(fresh);
          cur = fresh.id;
        }
        renderAll();
        publish(); // en redan öppen elevskärm visar direkt samma sak
        requestAnimationFrame(() => {
          if (!pointsEl.isConnected || document.activeElement !== document.body) return;
          const m = curM();
          const ta = pointsEl.querySelector(`textarea[data-notes="${CSS.escape(m?.shown ?? "")}"]`) ?? textareas()[0];
          ta?.focus({ preventScroll: true });
          ta?.setSelectionRange(ta.value.length, ta.value.length);
        });
      }));
    }
  },

  async unmount() {
    for (const off of (this._offs ?? []).splice(0)) { try { off(); } catch { /* ok */ } }
  },
};

// ---- Markup-mallar --------------------------------------------------------

function studentMarkup() {
  return `
    <section class="kr kr--student">
      <div class="kr-paper" aria-live="off">
        <header class="kr-head" hidden></header>
        <div class="kr-body" hidden></div>
        <p class="kr-empty" hidden>Inget klassråd visas.</p>
      </div>
    </section>`;
}

function teacherMarkup() {
  return `
    <section class="kr kr--teacher">
      <div class="kr-main">
        <div class="kr-fields">
          <label class="kr-field kr-field--date"><span class="kr-field__label">Datum</span>
            <input type="date" name="kr-date" required></label>
          <div class="kr-field kr-field--week"><span class="kr-field__label">Vecka</span>
            <output class="kr-week" aria-live="polite"></output></div>
          <div class="kr-field kr-field--name">
            <label class="kr-field__label" for="kr-chair">Ordförande</label>
            <div class="kr-namebox">
              <input type="text" id="kr-chair" name="kr-chair" maxlength="${MAX_NAME}" autocomplete="off" spellcheck="false" placeholder="Namn">
              <select class="kr-pick" data-for="chair" aria-label="Välj ordförande ur elevlistan"></select>
            </div>
          </div>
          <div class="kr-field kr-field--name">
            <label class="kr-field__label" for="kr-secretary">Sekreterare</label>
            <div class="kr-namebox">
              <input type="text" id="kr-secretary" name="kr-secretary" maxlength="${MAX_NAME}" autocomplete="off" spellcheck="false" placeholder="Namn">
              <button type="button" class="btn kr-me" data-act="me">Jag</button>
              <select class="kr-pick" data-for="secretary" aria-label="Välj sekreterare ur elevlistan"></select>
            </div>
          </div>
        </div>

        <p class="kr-reading" hidden>${icon("archive")}<span></span>
          <button type="button" class="btn btn--ghost" data-act="latest">Till det senaste</button></p>

        <div class="kr-bar" role="toolbar" aria-label="Visa för eleverna">
          <div class="kr-nav">
            <button type="button" class="btn" data-act="prev" title="Föregående punkt (PageUp)">${icon("chevron-left")}<span>Föregående</span></button>
            <button type="button" class="btn" data-act="next" title="Nästa punkt (PageDown)"><span>Nästa</span>${icon("chevron-right")}</button>
            <button type="button" class="btn" data-act="all" aria-pressed="false" title="Visa en översikt med alla punkter">${icon("layout")}<span>Visa alla</span></button>
          </div>
          <span class="kr-shownlabel" aria-live="polite"></span>
          <span class="kr-bar__end">
            <span class="kr-saved" role="status" hidden>${icon("check")}<span>Sparat</span></span>
            <button type="button" class="btn kr-follow" data-act="follow" aria-pressed="true"
              title="Punkten du skriver i är den som visas för eleverna">${icon("pen")}<span>Följ mig</span></button>
            <button type="button" class="btn btn--ghost" data-act="focus" aria-pressed="false"
              title="Fokusläge (F): bara punkterna och anteckningarna">${icon("expand")}<span>Fokusläge</span></button>
          </span>
        </div>

        <ol class="kr-points" aria-label="Punkter"></ol>

        <p class="kr-hint teacher-only">Skicka ut med <strong>Visa på elevskärm</strong>. <kbd>Enter</kbd> ger en ny rad,
          <kbd>Tab</kbd> i slutet av fältet eller <kbd>Ctrl</kbd>+<kbd>Enter</kbd> går till nästa punkt och <kbd>Shift</kbd>+<kbd>Tab</kbd> tillbaka.
          <kbd>PageUp</kbd>/<kbd>PageDown</kbd> byter punkt, <kbd>F</kbd> ger fokusläge. Klassråden sparas bara på den här datorn, aldrig i molnet.</p>
      </div>

      <aside class="kr-side teacher-only" aria-label="Klassråd">
        <section class="kr-box">
          <button type="button" class="btn btn--primary" data-act="new">${icon("plus")}<span>Nytt klassråd</span></button>
          <button type="button" class="btn btn--ghost" data-act="template">${icon("pencil")}<span>Redigera mall…</span></button>
        </section>
        <section class="kr-box">
          <h2 class="kr-h">Tidigare klassråd</h2>
          <div class="kr-archive"></div>
        </section>
      </aside>
    </section>`;
}
