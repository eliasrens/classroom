/**
 * ÖVERSIKT › INSTÄLLNINGAR OCH DATASKYDD (issue #45 — flyttat ur Översikten).
 *
 * De tvärgående integritetsinställningarna (Läge 5): lokal gallring av
 * noteringar med uppgraderingsskyddet "pausad gallring" (#32) och
 * påminnelsen om ej nedladdade uppföljningar (#33), engångsflytten av
 * elevdata ur molnet (visas bara om molnet faktiskt har elevdata kvar,
 * #60) och "Radera all data" för klassen.
 */

import { icon } from "../../lib/icons.js";
import { setActiveClass } from "../../ui/class-picker.js";
import { mergedSubjects } from "../../lib/trafikljus-stats.js";
import { MY_SUBJECTS_DOC, mySubjectsPath, myIds } from "../../lib/my-subjects.js";
import { openMySubjectsDialog } from "../../ui/my-subjects-dialog.js";
import { MY_CLASSES_DOC, myClassesPath, myClassIds } from "../../lib/my-classes.js";
import { openMyClassesDialog } from "../../ui/my-classes-dialog.js";
import {
  savePrivacy, runRetention, parsePrivacy, RETENTION_OPTIONS, DEFAULT_RETENTION_WEEKS, deleteAllClassData,
} from "../../lib/privacy.js";
import { weekKey } from "../../lib/week.js";
import { moveStudentDataFromCloud, cloudHasStudentData } from "../../data/cloud-cleanup.js";
import { serverNow } from "../../lib/clock.js";
import { followUpsAtRisk, reportsPath, REPORTS_LOG_ID } from "../elever/report-data.js";
import { esc } from "./shared.js";

export function mountInstallningar(el, { data, store }) {
  const offs = [];
  let classes = [];
  let cloudHasData = false; // flytt-knappen visas bara om molnet har elevdata kvar (#60)
  let retentionWeeks = DEFAULT_RETENTION_WEEKS;
  let retentionAwaiting = false; // uppgraderingsskydd: gallring pausad tills läraren valt
  let localNotes = [];     // LOKALA noteringar — bara för påminnelsen före gallring (issue #33)
  let reportLog = null;    // lokal exportlogg (classes/{cid}/reports → log)
  let myDoc = null;        // Mina ämnen — lärarens privata val (issue #81)
  let myClassesDoc = null; // Mina klasser — lärarens privata val (issue #102)
  let settingsDocs = [];   // klassens delade settings (egna ämnen)
  const activeId = () => store.get().classId ?? null;

  /** Elevlista → fliken Rapporter (påminnelsen före gallring, issue #33). */
  function goReports() {
    try { sessionStorage.setItem("classroom:elever:tab", "rapporter"); } catch { /* ok */ }
    location.hash = "#/elever";
  }

  // ---- Integritet: lokal gallring av noteringar (per dator) ----
  // Ett aktivt val häver uppgraderingsskyddet; kör gallringen direkt
  // så att "starta gallringen" i bekräftelsen stämmer.
  async function setRetention(value) {
    const cid = activeId();
    if (!cid) return;
    // Issue #33: raderar valet noteringar med uppföljning som aldrig laddats
    // ned? Fråga först — det finns ingen annan kopia av dem.
    const risk = followUpsAtRisk({ notes: localNotes, weeks: Number(value), log: reportLog, before: serverNow() });
    if (risk.length > 0) {
      const weeks = [...new Set(risk.map((n) => weekKey(n.createdAt).replace(/^\d{4}-W0?/, "v.")))].join(", ");
      const ok = confirm(
        `${risk.length} ${risk.length === 1 ? "notering" : "noteringar"} med uppföljning (${weeks}) har inte laddats ned ` +
        "och raderas nu från den här datorn.\n\nRadera ändå?\n\n" +
        "Välj Avbryt och ladda ned en rapport först: Elevlista → Rapporter.");
      if (!ok) { render(); return; }
    }
    await savePrivacy(data, cid, { noteRetentionWeeks: Number(value) });
    await runRetention(data, cid);
  }

  // ---- Integritet: flytta elevdata från molnet (engångs, issue #32) ----
  async function migrateCloud() {
    const ok = confirm(
      "Flytta elevdata från molnet?\n\n" +
      "Detta gäller ALLA klasser i molnet:\n" +
      "• Gamla noteringar räknas om till anonym klasstatistik (utan elever och texter).\n" +
      "• Elevlistor, noteringar och Bra jobbat-arkiv RADERAS ur molnet.\n\n" +
      "Varje lärardator behåller sin egen lokala kopia. Datorer som inte har " +
      "öppnat appen med den nya versionen ännu behåller sin cache och migrerar " +
      "den lokalt vid nästa start.");
    if (!ok) return;
    try {
      const report = await moveStudentDataFromCloud();
      const lines = report.map((r) => `${r.name}: ${r.notes} noteringar → anonym statistik, ${r.deleted} dokument raderade`);
      alert(`Klart — elevdata är flyttad från molnet.\n\n${lines.join("\n")}`);
      void checkCloud();
    } catch (err) {
      console.warn("[oversikt] flytt av elevdata från molnet misslyckades:", err);
      alert(`Kunde inte slutföra flytten: ${err?.message ?? err}\n\nInget lokalt har gått förlorat — försök igen.`);
    }
  }

  /** Kontrollera (billigt) om molnet har elevdata kvar. Vid fel visas
   *  knappen inte — hellre aldrig än förvirrande i normalfallet. */
  async function checkCloud() {
    let next = false;
    try { next = await cloudHasStudentData(); } catch (err) {
      console.warn("[oversikt] kunde inte kontrollera elevdata i molnet:", err);
    }
    if (next !== cloudHasData) { cloudHasData = next; render(); }
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
    // Ingen klass vald efteråt: "Välj klass…" (samma fallback som
    // klassväljaren, #31). Välj ALDRIG automatiskt en annan (riktig) klass —
    // lärarvyn börjar skriva där direkt (veckorytm, autosparning).
    setActiveClass(store, null);
    alert(`Klart — ${n} poster raderade för "${cls.name}".`);
  }

  function render() {
    const cid = activeId();
    const cls = classes.find((c) => c.id === cid) ?? null;
    const risk = retentionAwaiting
      ? followUpsAtRisk({ notes: localNotes, weeks: retentionWeeks, log: reportLog, before: serverNow() })
      : [];

    // Mina ämnen (issue #81): privat per lärare, styr ämnesväljaren och
    // ämnesfiltret i lektionsplaneringen. Inget val = alla ämnen visas.
    const mine = myIds(myDoc);
    const subjects = mergedSubjects(settingsDocs);
    const mineNames = (mine ?? [])
      .map((id) => subjects.find((s) => s.id === id)?.name)
      .filter(Boolean);
    const mineSummary = !mine
      ? "Inget val — alla ämnen visas i ämnesväljaren."
      : `${mineNames.length} valda: ${mineNames.join(", ")}.`;

    // Mina klasser (issue #102): privat per lärare, styr klassväljaren och
    // Översiktens klasslista. Inget val = alla klasser visas. Borttagna
    // klasser (okända id:n) räknas inte.
    const myClasses = myClassIds(myClassesDoc);
    const myClassNames = (myClasses ?? [])
      .map((id) => classes.find((c) => c.id === id)?.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "sv"));
    const myClassesSummary = myClassNames.length === 0
      ? "Inget val — alla klasser visas."
      : `${myClassNames.length} ${myClassNames.length === 1 ? "vald" : "valda"}: ${myClassNames.join(", ")}.`;

    el.innerHTML = `
      <section class="ov-section card" aria-label="Mina klasser">
        <h2 class="ov-section__title">${icon("users")} Mina klasser</h2>
        <p class="ov-field__hint">Välj klasserna du undervisar i, så visar klassväljaren bara dem.
          Valet är ditt eget och följer dig mellan datorer.</p>
        <p class="ov-mine-summary">${esc(myClassesSummary)}</p>
        <button class="btn" data-my-classes>${icon("check")} Välj mina klasser…</button>
      </section>

      <section class="ov-section card" aria-label="Mina ämnen">
        <h2 class="ov-section__title">${icon("book")} Mina ämnen</h2>
        <p class="ov-field__hint">Välj ämnena du undervisar i, så visar ämnesväljaren i
          lektionsplaneringen bara dem. Valet är ditt eget och följer dig mellan datorer.
          Statistik och Veckor visar alltid alla ämnen.</p>
        <p class="ov-mine-summary">${esc(mineSummary)}</p>
        <button class="btn" data-my-subjects>${icon("check")} Välj mina ämnen…</button>
      </section>

      <section class="ov-section ov-privacy card" aria-label="Integritet och data">
        <h2 class="ov-section__title">${icon("shield")} Integritet &amp; data</h2>
        <p class="ov-privacy__note"><strong>Elevdata stannar på den här datorn.</strong>
          Elevlistan, noteringar, Bra jobbat, skrivtavlan och tankekartor sparas bara här.
          Till molnet går enbart klasstatistik (trafikljus och anonyma räkningar). Det som
          ska sparas långsiktigt dokumenteras i skolans system, till exempel via
          Elevlista › Rapporter.</p>
        ${!cls ? `<p class="ov-empty">Välj en klass för att ändra inställningarna.</p>` : `
        <label class="ov-field">
          <span class="ov-field__label">Radera noteringar automatiskt efter</span>
          <select data-retention>
            ${RETENTION_OPTIONS.map((o) => `
              <option value="${o.weeks}" ${o.weeks === retentionWeeks ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
          </select>
        </label>
        <p class="ov-field__hint">Lokal gallring på den här datorn (standard 20 veckor, ca en termin).
          Rensningen körs automatiskt när klassen öppnas. Klassens anonyma statistik i molnet påverkas inte.</p>
        ${retentionAwaiting ? `
        <div class="ov-retention-pause">
          <p><strong>Gallringen är pausad.</strong> Den här datorn hade tidigare
            "Spara tills vidare", så inga noteringar raderas förrän du bekräftar
            en lagringstid ovan. Äldre noteringar än den valda tiden raderas då
            från den här datorn.</p>
          ${risk.length ? `
          <p class="ov-retention-risk">${icon("flag")} <strong>${risk.length} ${risk.length === 1 ? "notering" : "noteringar"} med uppföljning
            raderas när du bekräftar</strong> och har inte laddats ned.
            <button class="ov-link" data-go-reports>Ladda ned en rapport först (Elevlista → Rapporter).</button></p>` : ""}
          <button class="btn" data-confirm-retention>Bekräfta ${retentionWeeks} veckor och starta gallringen</button>
        </div>` : ""}

        ${cloudHasData ? `
        <div class="ov-danger">
          <button class="btn" data-migrate>${icon("upload")} Flytta elevdata från molnet</button>
          <span class="ov-danger__hint">Engångsflytt (alla klasser): räknar om molnets gamla noteringar till
            anonym klasstatistik och raderar elevlistor, noteringar och Bra jobbat-arkiv ur molnet.</span>
        </div>` : ""}

        <div class="ov-danger">
          <button class="btn ov-danger__btn" data-del>${icon("trash")} Radera all data för ${esc(cls.name)}</button>
          <span class="ov-danger__hint">Elever, planeringar, noteringar, pass — allt, både på datorn och i molnet. Kan inte ångras.</span>
        </div>`}
      </section>`;
  }

  // ---- Händelser (delegering — markupen ritas om) ----
  el.addEventListener("change", (e) => {
    if (e.target.matches("[data-retention]")) void setRetention(e.target.value);
  });
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-my-classes]")) {
      void openMyClassesDialog({ data, classes, mine: myClassIds(myClassesDoc) });
    }
    else if (e.target.closest("[data-my-subjects]")) {
      void openMySubjectsDialog({ data, subjects: mergedSubjects(settingsDocs), mine: myIds(myDoc) });
    }
    else if (e.target.closest("[data-confirm-retention]")) void setRetention(retentionWeeks);
    else if (e.target.closest("[data-go-reports]")) goReports();
    else if (e.target.closest("[data-migrate]")) void migrateCloud();
    else if (e.target.closest("[data-del]")) void deleteClass();
  });

  // ---- Datakällor (live) ----
  offs.push(data.watch("classes", (docs) => { classes = docs; render(); }));

  // Mina ämnen — privat per lärare, kan ändras här, i lektionsplaneringen
  // eller på en annan enhet (issue #81).
  offs.push(data.watch(mySubjectsPath(), (docs) => {
    myDoc = docs.find((d) => d.id === MY_SUBJECTS_DOC) ?? null;
    render();
  }));

  // Mina klasser — privat per lärare (issue #102). Samma settings-samling
  // som Mina ämnen, men egen watch så att var sektion läser sitt dokument.
  offs.push(data.watch(myClassesPath(), (docs) => {
    myClassesDoc = docs.find((d) => d.id === MY_CLASSES_DOC) ?? null;
    render();
  }));

  const cid = activeId();
  if (cid) {
    // Klassens delade settings — bara för att kunna namnge egna ämnen.
    offs.push(data.watch(`classes/${cid}/settings`, (docs) => { settingsDocs = docs; render(); }));
    // Lokala noteringar + exportlogg: bara för att varna innan gallringen
    // raderar uppföljningar som aldrig laddats ned (issue #33).
    offs.push(data.watch(`classes/${cid}/notes`, (docs) => { localNotes = docs; render(); }));
    offs.push(data.watch(reportsPath(cid), (docs) => {
      reportLog = docs.find((d) => d.id === REPORTS_LOG_ID) ?? null;
      render();
    }));
    // Gallringsinställningen är LOKAL per dator (issue #32).
    offs.push(data.watch(`classes/${cid}/privacy`, (docs) => {
      ({ noteRetentionWeeks: retentionWeeks, awaitingChoice: retentionAwaiting } =
        parsePrivacy(docs.find((d) => d.id === "privacy")?.value));
      render();
    }));
  }

  render();
  void checkCloud();
  return offs;
}
