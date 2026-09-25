/**
 * Flik: RAPPORTER — elevrapporter som krypterad fil och sammanslagning
 * av flera lärares filer (issue #33). ENDAST LÄRARVY (Elevlista når
 * aldrig elevskärmen; allt här märks dessutom .teacher-only).
 *
 * HELT LOKALT: export, kryptering (WebCrypto), öppning och sammanslagning
 * sker i webbläsaren. Inga fetch-anrop, ingenting via datalagrets outbox
 * eller Firestore. Filer flyttas för hand (t.ex. USB).
 *
 *  - LADDA NED: en elev eller hela klassen, vald period (standard förra
 *    veckan), som krypterad .klassrum-fil (standard) eller utskrift/PDF.
 *  - ÖPPNA RAPPORTFILER: en eller flera filer (dra och släpp går bra),
 *    lösenord per fil, elevmatchning som läraren bekräftar, och en
 *    gemensam analys. Den egna datorns data kan tas med.
 *  - Den dekrypterade/sammanslagna datan hålls BARA i minnet (api._rep.ws)
 *    och släpps när fliken eller läget lämnas. Det enda som sparas lokalt
 *    (classes/{cid}/reports, endast lokalt) är exportloggen, avvisade
 *    påminnelser och bekräftade namnpar — aldrig notisdata.
 */

import { icon } from "../../lib/icons.js";
import { serverNow } from "../../lib/clock.js";
import { weekLabel, weekStartFromKey } from "../../lib/week.js";
import { downloadBlob } from "../../lib/download.js";
import { currentUid } from "../../data/plans.js";
import { currentTeacherName } from "../../auth.js";
import { PRAISE_DOC, praisePath } from "../../lib/morning.js";
import { praiseArchivePath } from "../../lib/week-rhythm.js";
import { mergedSubjects } from "../../lib/trafikljus-stats.js";
import {
  encryptReport, decryptReport, readReportHeader, ReportFileError, ERROR_TEXT,
  cryptoAvailable, MIME, FILE_EXT,
} from "../../lib/report-crypto.js";
import {
  PERIOD_PRESETS, periodFor, periodLabel, periodFileTag, isoDate, reportFileName,
  buildReportPayload, reportMeta, upgradePayload, suggestMatch, updateSavedPairs,
  mergeReports, mergedToPayload, logExport, mondayReminder, retentionReminder,
  reportsPath, REPORTS_LOG_ID, REPORTS_REMINDERS_ID, REPORTS_MATCHES_ID, normName, genitive,
} from "./report-data.js";
import { renderReportDocument, renderStudentReport, renderClassSummary, renderSources, studentName } from "./report-view.js";
import { openPrintView, closePrintView } from "./report-print.js";
import { openPasswordDialog, closePasswordDialog } from "./report-dialog.js";
import { activeStudents, escapeHtml, settingsPath, fmtDate } from "./shared.js";

const esc = escapeHtml;

export const REPORTS_TAB = "rapporter";

/** Flikens tillstånd (bara i minnet, per montering av Elevlista). */
const DEFAULT_STATE = { scope: "class", periodId: "lastWeek", custom: null, format: "encrypted", ws: null, focusSubmit: false };
function state(api) {
  if (!api._rep?.periodId) api._rep = { ...DEFAULT_STATE, ...(api._rep ?? {}) };
  return api._rep;
}

/**
 * Släpp ALLT dekrypterat (anropas när fliken eller läget lämnas):
 * sammanställningen, öppna dialoger och utskriftsvyn.
 */
export function closeReportWorkspace(api) {
  if (api?._rep) api._rep.ws = null;
  closePrintView();
  closePasswordDialog();
}

const teacher = () => ({ uid: currentUid(), name: currentTeacherName() || "Lärare" });
const className = (api) => api.ctx.activeClass?.name ?? "";

function currentPeriod(st, now = serverNow()) {
  return periodFor(st.periodId, now, st.custom ?? {});
}

/** Bra jobbat (listan + veckoarkivet) och ämnesnamn — lokalt. */
async function loadExtras(api) {
  const [board, archive, settingsDocs] = await Promise.all([
    api.data.list(praisePath(api.cid)),
    api.data.list(praiseArchivePath(api.cid)),
    api.data.list(settingsPath(api.cid)),
  ]);
  const praiseDocs = [
    ...archive.map((d) => ({ weekOf: d.weekOf ?? d.id, praise: d.praise ?? [] })),
    ...board.filter((d) => d.id === PRAISE_DOC && d.weekOf).map((d) => ({ weekOf: d.weekOf, praise: d.praise ?? [] })),
  ];
  return { praiseDocs, subjects: mergedSubjects(settingsDocs) };
}

async function ownPayload(api, period, studentIds = null) {
  const extras = await loadExtras(api);
  return buildReportPayload({
    cls: { id: api.cid, name: className(api) },
    teacher: teacher(),
    period,
    students: api.students,
    notes: api.notes,
    labels: api.settings.labels ?? [],
    studentIds,
    ...extras,
  });
}

const identityTargets = (payload) => Object.fromEntries(payload.students.map((s) => [s.localId, `local:${s.localId}`]));

async function recordExport(api, period, studentIds) {
  const log = await api.data.get(reportsPath(api.cid), REPORTS_LOG_ID);
  await api.data.put(reportsPath(api.cid), { id: REPORTS_LOG_ID, ...logExport(log, { period, studentIds }) });
}

async function saveReminder(api, patch) {
  const doc = await api.data.get(reportsPath(api.cid), REPORTS_REMINDERS_ID);
  await api.data.put(reportsPath(api.cid), { ...(doc ?? {}), id: REPORTS_REMINDERS_ID, ...patch });
}

function savedPairs(api) {
  return api.reportDocs?.[REPORTS_MATCHES_ID]?.pairs ?? [];
}

// ======================================================================
// Påminnelser (banner överst i Elevlista, alla flikar)
// ======================================================================

/** Rita påminnelsebannern (måndag + före gallring) i bannerEl. */
export function renderReportBanner(bannerEl, api) {
  const docs = api.reportDocs ?? {};
  const log = docs[REPORTS_LOG_ID] ?? null;
  const dismissed = docs[REPORTS_REMINDERS_ID] ?? null;
  const now = serverNow();
  const privacy = api.privacy ?? null;
  const monday = mondayReminder({ notes: api.notes, log, dismissed, now });
  const retention = privacy ? retentionReminder({
    notes: api.notes, weeks: privacy.noteRetentionWeeks, awaitingChoice: privacy.awaitingChoice, log, dismissed, now,
  }) : null;

  const items = [];
  if (retention) {
    const weeks = retention.weekKeys.map((k) => weekLabel(weekStartFromKey(k), now)).join(", ");
    const when = retention.awaiting
      ? "raderas när du bekräftar lagringstiden i Översikten"
      : (() => {
          const days = Math.max(0, Math.ceil((retention.purgeAt - now) / 86_400_000));
          return days <= 0 ? "raderas nu av den lokala gallringen" : `raderas om ${days} ${days === 1 ? "dag" : "dagar"}`;
        })();
    items.push(`
      <div class="rap-banner rap-banner--warn" role="status">
        ${icon("clock")}
        <p><strong>${retention.count} ${retention.count === 1 ? "notering" : "noteringar"} med uppföljning (${esc(weeks)}) ${esc(when)}</strong>
          från den här datorn och har inte laddats ned. Ladda ned en rapport först.</p>
        <button class="btn btn--primary" data-rap-banner="retention">${icon("download")}Ladda ned rapport</button>
        <button class="btn btn--ghost" data-rap-dismiss="retention">Inte nu</button>
      </div>`);
  }
  if (monday) {
    items.push(`
      <div class="rap-banner" role="status">
        ${icon("calendar")}
        <p><strong>Förra veckan: ${monday.students} ${monday.students === 1 ? "elev" : "elever"} med uppföljning</strong> — ladda ned veckorapporten.</p>
        <button class="btn btn--primary" data-rap-banner="monday">${icon("lock")}Ladda ned veckorapport</button>
        <button class="btn btn--ghost" data-rap-dismiss="monday">Inte nu</button>
      </div>`);
  }
  bannerEl.innerHTML = items.join("");
  bannerEl.hidden = items.length === 0;
  bannerEl.onclick = (e) => {
    const go = e.target.closest("[data-rap-banner]");
    if (go) {
      closeReportWorkspace(api); // visa exportformuläret, inte en öppen sammanställning
      const st = state(api);
      st.scope = "class";
      st.format = "encrypted";
      if (go.dataset.rapBanner === "monday") {
        st.periodId = "lastWeek";
      } else {
        st.periodId = "custom";
        st.custom = { from: isoDate(retention.period.from), to: isoDate(retention.period.to - 1) };
      }
      st.focusSubmit = true;
      api.setTab(REPORTS_TAB);
      return;
    }
    const dismiss = e.target.closest("[data-rap-dismiss]");
    if (dismiss) {
      if (dismiss.dataset.rapDismiss === "monday") void saveReminder(api, { monday: monday.weekKey });
      else void saveReminder(api, { retention: [...new Set([...(dismissed?.retention ?? []), ...retention.weekKeys])].slice(-60) });
    }
  };
}

// ======================================================================
// Fliken
// ======================================================================

export function renderReports(el, api) {
  const st = state(api);
  el.innerHTML = `
    <section class="rap teacher-only">
      ${st.ws ? workspaceHtml(api, st) : `
        <div class="rap__cols">
          ${exportHtml(api, st)}
          ${openHtml()}
        </div>`}
    </section>`;
  if (st.ws) wireWorkspace(el, api, st);
  else wireStart(el, api, st);
}

// ---- Ladda ned ----

function exportHtml(api, st) {
  const students = activeStudents(api.students);
  if (st.scope !== "class" && !students.some((s) => s.id === st.scope)) st.scope = "class";
  const period = currentPeriod(st);
  const inP = api.notes.filter((n) => n.studentId && (n.createdAt ?? 0) >= period.from && (n.createdAt ?? 0) < period.to
    && (st.scope === "class" || n.studentId === st.scope));
  const follow = inP.filter((n) => n.followUp).length;
  const nStudents = new Set(inP.map((n) => n.studentId)).size;
  const who = st.scope === "class" ? `${nStudents} ${nStudents === 1 ? "elev" : "elever"}` : api.label(api.studentById(st.scope));
  const custom = st.custom ?? { from: isoDate(period.from), to: isoDate(period.to - 1) };
  return `
    <section class="rap__card card" aria-labelledby="rap-export-h">
      <h2 id="rap-export-h">${icon("download")} Ladda ned rapport</h2>
      <p class="rap__lead">En rapport per elev eller för hela klassen — till exempel efter varje vecka.
        Allt görs här i webbläsaren; ingenting skickas över nätet.</p>
      <form class="rap__form" data-rap-export>
        <label class="rap__field"><span>Vem</span>
          <select name="scope">
            <option value="class" ${st.scope === "class" ? "selected" : ""}>Hela klassen</option>
            ${students.length ? `<optgroup label="En elev">${students.map((s) => `
              <option value="${esc(s.id)}" ${st.scope === s.id ? "selected" : ""}>${api.label(s)}</option>`).join("")}</optgroup>` : ""}
          </select>
        </label>
        <label class="rap__field"><span>Period</span>
          <select name="period">
            ${PERIOD_PRESETS.map((p) => `<option value="${p.id}" ${p.id === period.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
          </select>
        </label>
        ${period.id === "custom" ? `
          <div class="rap__dates">
            <label><span class="sr-only">Från</span><input type="date" name="from" value="${esc(custom.from)}"></label>
            <span>–</span>
            <label><span class="sr-only">Till</span><input type="date" name="to" value="${esc(custom.to)}"></label>
          </div>` : ""}
        <p class="rap__period">${icon("calendar")} ${esc(period.label)}</p>

        <fieldset class="rap__formats">
          <legend>Format</legend>
          <label class="rap__format ${st.format === "encrypted" ? "is-active" : ""}">
            <input type="radio" name="format" value="encrypted" ${st.format === "encrypted" ? "checked" : ""}>
            <span><strong>${icon("lock")} Krypterad fil (.klassrum)</strong> — rekommenderas.
              Skyddas med ett lösenord du väljer och kan öppnas och slås samman med kollegors filer.
              Filen innehåller inga elevnamn i klartext.</span>
          </label>
          <label class="rap__format ${st.format === "print" ? "is-active" : ""}">
            <input type="radio" name="format" value="print" ${st.format === "print" ? "checked" : ""}>
            <span><strong>${icon("printer")} Utskrift / PDF</strong> — för att föra över uppföljningar till skolans
              dokumentationssystem. <em>Okrypterad — spara den inte löst på datorn.</em></span>
          </label>
        </fieldset>

        <p class="rap__summary">Rapporten innehåller <strong>${inP.length} ${inP.length === 1 ? "notering" : "noteringar"}</strong>
          (${follow} med uppföljning) om ${who}.</p>
        ${st.format === "encrypted" && !cryptoAvailable() ? `<p class="rap__err">${esc(ERROR_TEXT["no-crypto"])}</p>` : ""}
        <div class="rap__actions">
          <button class="btn btn--primary" type="submit" data-rap-go>${icon(st.format === "print" ? "printer" : "lock")}${
            st.format === "print" ? "Visa utskrift" : "Välj lösenord och ladda ned"}</button>
        </div>
      </form>
    </section>`;
}

function openHtml() {
  return `
    <section class="rap__card card" aria-labelledby="rap-open-h">
      <h2 id="rap-open-h">${icon("merge")} Öppna rapportfiler</h2>
      <p class="rap__lead">Öppna en eller flera <strong>${FILE_EXT}</strong>-filer — dina egna eller kollegors — och slå
        ihop dem till en gemensam sammanställning och analys. Varje fil har sitt eget lösenord.</p>
      <label class="rap__drop" data-rap-drop>
        ${icon("upload", { size: 28, strokeWidth: 1.5 })}
        <span>Dra och släpp filer här</span>
        <span class="btn">${icon("file")}Välj filer…</span>
        <input class="sr-only" type="file" multiple accept="${FILE_EXT},${MIME}" data-rap-files aria-label="Välj rapportfiler">
      </label>
      <p class="rap__note">${icon("shield")} Den öppnade datan finns bara i minnet medan du tittar. Den sparas
        ingenstans och försvinner när du lämnar fliken.</p>
    </section>`;
}

function wireStart(el, api, st) {
  const form = el.querySelector("[data-rap-export]");
  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "scope") st.scope = t.value;
    if (t.name === "format") st.format = t.value;
    if (t.name === "period") {
      st.periodId = t.value;
      if (t.value === "custom" && !st.custom) {
        const p = periodFor("lastWeek");
        st.custom = { from: isoDate(p.from), to: isoDate(p.to - 1) };
      }
    }
    if (t.name === "from" || t.name === "to") st.custom = { ...(st.custom ?? {}), [t.name]: t.value };
    api.refresh();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void startExport(api, st);
  });
  if (st.focusSubmit) {
    st.focusSubmit = false;
    const btn = form.querySelector("[data-rap-go]");
    btn.focus();
    btn.scrollIntoView({ block: "center" });
  }
  wireFileInputs(el, api, st);
}

async function startExport(api, st) {
  const period = currentPeriod(st);
  const studentIds = st.scope === "class" ? null : [st.scope];
  const payload = await ownPayload(api, period, studentIds);
  const cls = className(api);
  const now = serverNow();
  if (st.format === "print") {
    const merged = mergeReports([{ key: "own", payload, targets: identityTargets(payload) }], { locals: api.students });
    openPrintView({
      title: `${studentIds ? "Elevrapport" : "Klassrapport"} ${cls} ${periodFileTag(period)}`,
      html: renderReportDocument(merged, {
        className: cls, studentKey: studentIds ? `local:${studentIds[0]}` : null, now,
        title: studentIds ? "Elevrapport" : "Klassrapport",
      }),
      onPrint: () => void recordExport(api, period, studentIds),
    });
    return;
  }
  if (!cryptoAvailable()) { api.toast(ERROR_TEXT["no-crypto"]); return; }
  const fileName = reportFileName({ className: cls, period, teacherName: teacher().name });
  const notes = payload.students.reduce((sum, s) => sum + s.notes.length, 0);
  openPasswordDialog({
    title: "Välj ett lösenord för filen",
    fileName,
    summary: `${studentIds ? "En elev" : `Hela klassen (${payload.students.length} elever)`} · ${period.label} · ${notes} noteringar`,
    onSubmit: async (password) => {
      const bytes = await encryptReport(payload, password, { meta: reportMeta(payload) });
      downloadBlob(new Blob([bytes], { type: MIME }), fileName);
      await recordExport(api, period, studentIds);
      api.toast(`Sparad: ${fileName} — lösenordet sparas inte.`);
    },
  });
}

// ---- Öppna filer ----

let fileSeq = 0;

function wireFileInputs(el, api, st) {
  el.querySelectorAll("[data-rap-files]").forEach((input) => {
    input.addEventListener("change", () => {
      void addFiles(api, st, [...input.files]);
      input.value = "";
    });
  });
  const drop = el.querySelector("[data-rap-drop]");
  if (!drop) return;
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("is-over");
    void addFiles(api, st, [...(e.dataTransfer?.files ?? [])]);
  });
}

async function addFiles(api, st, files) {
  if (!files.length) return;
  st.ws ??= { files: [], includeOwn: true, view: "", seq: 0 };
  for (const f of files) {
    const entry = { key: `f${++fileSeq}`, name: f.name, size: f.size, status: "locked", error: null, meta: null, bytes: null, payload: null, targets: {}, reasons: {}, confirmed: false };
    try {
      entry.bytes = new Uint8Array(await f.arrayBuffer());
      entry.meta = readReportHeader(entry.bytes).meta;
    } catch (err) {
      entry.status = "error";
      entry.error = err instanceof ReportFileError ? err.message : ERROR_TEXT["not-klassrum"];
      entry.bytes = null;
    }
    st.ws.files.push(entry);
  }
  api.refresh();
}

async function unlockFile(api, st, entry, password) {
  entry.busy = true;
  entry.error = null;
  api.refresh();
  try {
    const raw = await decryptReport(entry.bytes, password);
    const up = upgradePayload(raw);
    if (!up.ok) throw new ReportFileError(up.code, ERROR_TEXT[up.code]);
    entry.payload = up.payload;
    entry.bytes = null; // krypterade byte behövs inte längre
    entry.status = "open";
    // Förslag på matchning (läraren bekräftar alltid).
    const locals = activeStudents(api.students);
    for (const rs of entry.payload.students) {
      const sugg = suggestMatch(rs, locals, { saved: savedPairs(api), teacherUid: entry.payload.exporter.uid });
      entry.targets[rs.localId] = sugg.localId ? `local:${sugg.localId}` : "sep";
      entry.reasons[rs.localId] = sugg.reason;
    }
  } catch (err) {
    entry.error = err instanceof ReportFileError ? err.message : ERROR_TEXT.corrupt;
  } finally {
    entry.busy = false;
    api.refresh();
  }
}

function fileTitle(meta) {
  const who = meta?.teacherName ?? "Okänd lärare";
  const label = String(meta?.periodLabel ?? "").replace(/\s*\(.*\)$/, "");
  return [who, label, meta?.className].filter(Boolean).join(", ");
}

const REASON_TEXT = {
  saved: "Sparad matchning",
  "name+tag": "Samma namn och särskiljare",
  name: "Samma namn",
  ambiguous: "Flera möjliga — välj",
  none: "Ingen träff — välj eller håll isär",
  manual: "Vald av dig",
};

function targetOptions(api, selected, { sepLabel }) {
  const locals = activeStudents(api.students);
  return `
    ${locals.map((s) => `<option value="local:${esc(s.id)}" ${selected === `local:${s.id}` ? "selected" : ""}>${api.label(s)}</option>`).join("")}
    <option value="sep" ${selected === "sep" ? "selected" : ""}>${esc(sepLabel)}</option>`;
}

function fileHtml(api, entry, ws) {
  // META kommer ur filens klartexthuvud — oautentiserat tills filen öppnats
  // med rätt lösenord. Allt härifrån escapas; tal kontrolleras.
  const meta = entry.meta ?? {};
  const head = `
    <div class="rap-file__head">
      ${icon("file")}
      <div class="rap-file__title">
        <strong>${esc(entry.status === "error" ? entry.name : fileTitle(meta))}</strong>
        <span class="rap__sub">${esc(entry.name)}${Number.isInteger(meta.studentCount) ? ` · ${meta.studentCount} ${meta.studentCount === 1 ? "elev" : "elever"}` : ""}${
          meta.exportedAt ? ` · exporterad ${esc(fmtDate(meta.exportedAt))}` : ""}${meta.kind === "merged" ? ` · sammanställning (${esc((meta.teachers ?? []).join(", "))})` : ""}</span>
      </div>
      <button class="btn btn--ghost btn--icon" data-rap-remove="${entry.key}" title="Ta bort filen ur sammanställningen" aria-label="Ta bort filen">${icon("x")}</button>
    </div>`;

  if (entry.status === "error") {
    return `<li class="rap-file card is-error">${head}<p class="rap__err" role="alert">${esc(entry.error)}</p></li>`;
  }
  if (entry.status === "locked") {
    return `
      <li class="rap-file card">${head}
        <form class="rap-file__unlock" data-rap-unlock="${entry.key}">
          <label><span>Lösenord för ${meta.teacherName ? `${esc(genitive(meta.teacherName))} fil` : "filen"}</span>
            <input type="password" name="pw" autocomplete="off" spellcheck="false" required ${entry.busy ? "disabled" : ""}></label>
          <button class="btn btn--primary" type="submit" ${entry.busy ? "disabled" : ""}>${icon("lock")}${entry.busy ? "Öppnar…" : "Öppna"}</button>
        </form>
        ${entry.error ? `<p class="rap__err" role="alert">${esc(entry.error)}</p>` : ""}
      </li>`;
  }

  // Öppnad: matchning
  const p = entry.payload;
  const from = p.exporter?.name ?? "kollegan";
  const cls = className(api);
  const classWarn = normName(p.className) !== normName(cls)
    ? `<p class="rap__warn">${icon("flag")} Filen gäller klass <strong>${esc(p.className)}</strong> men du har <strong>${esc(cls)}</strong> vald. Eleverna matchas mot elevlistan i ${esc(cls)}.</p>` : "";
  const dup = ws.files.find((f) => f !== entry && f.status === "open" && f.payload.exporter.uid === p.exporter.uid
    && f.payload.exportedAt === p.exportedAt && ws.files.indexOf(f) < ws.files.indexOf(entry));
  const dupNote = dup ? `<p class="rap__sub">${icon("copy")} Samma fil som ovan — noteringarna räknas bara en gång.</p>` : "";

  if (entry.confirmed) {
    const pairs = p.students.map((rs) => {
      const t = entry.targets[rs.localId];
      const local = t?.startsWith("local:") ? api.studentById(t.slice(6)) : null;
      return `<li>${esc(genitive(from))} <strong>${esc(studentName(rs))}</strong> = ${local ? `din <strong>${api.label(local)}</strong>` : "<em>hålls isär</em>"}</li>`;
    }).join("");
    return `
      <li class="rap-file card is-confirmed">${head}${classWarn}${dupNote}
        <div class="rap-file__done">${icon("check")} <span>Matchning bekräftad.</span>
          <button class="btn btn--ghost" data-rap-edit="${entry.key}">${icon("pen")}Ändra</button></div>
        <ul class="rap-file__pairs">${pairs}</ul>
      </li>`;
  }

  let match;
  if (p.students.length === 1) {
    const rs = p.students[0];
    match = `
      <div class="rap-match1">
        <label><span>Vilken elev gäller filen?</span>
          <select data-rap-target="${entry.key}" data-remote="${esc(rs.localId)}">
            ${targetOptions(api, entry.targets[rs.localId], { sepLabel: "Ingen av mina elever — håll isär" })}
          </select></label>
        <span class="rap__sub">I ${esc(genitive(from))} fil: "${esc(studentName(rs))}" · ${rs.notes.length} noteringar ·
          ${esc(REASON_TEXT[entry.reasons[rs.localId]] ?? "")}</span>
      </div>`;
  } else if (p.students.length === 0) {
    match = `<p class="rap__sub">Filen innehåller inga elever.</p>`;
  } else {
    match = `
      <div class="rap-match__wrap">
        <table class="rap-match">
          <thead><tr><th>I ${esc(genitive(from))} fil</th><th>Din elev</th><th>Förslag</th></tr></thead>
          <tbody>${p.students.map((rs) => `
            <tr>
              <td><strong>${esc(studentName(rs))}</strong> <span class="rap__sub">${rs.notes.length} not.</span></td>
              <td><select data-rap-target="${entry.key}" data-remote="${esc(rs.localId)}" aria-label="Din elev för ${esc(studentName(rs))}">
                ${targetOptions(api, entry.targets[rs.localId], { sepLabel: "— Håll isär —" })}</select></td>
              <td class="rap__sub">${esc(REASON_TEXT[entry.reasons[rs.localId]] ?? "")}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>`;
  }
  const targets = Object.values(entry.targets).filter((t) => t.startsWith("local:"));
  const doubled = targets.length !== new Set(targets).size;
  return `
    <li class="rap-file card is-open">${head}${classWarn}${dupNote}
      ${match}
      ${doubled ? `<p class="rap__warn">${icon("flag")} Flera elever i filen kopplas till samma elev hos dig — de slås ihop.</p>` : ""}
      <div class="rap-file__confirm">
        <p class="rap__sub">Ingenting slås ihop förrän du bekräftar. Olika stavningar ("Mohammed" = "Mohammad")
          kopplar du ihop genom att välja rätt elev.</p>
        <button class="btn btn--primary" data-rap-confirm="${entry.key}">${icon("check")}Bekräfta matchningen</button>
      </div>
    </li>`;
}

/** Den sammanslagna datan (bara i minnet), eller null om inget är bekräftat. */
async function buildMerged(api, ws) {
  const confirmed = ws.files.filter((f) => f.status === "open" && f.confirmed);
  if (!confirmed.length) return null;
  const sources = confirmed.map((f) => ({
    key: f.key,
    payload: f.payload,
    targets: Object.fromEntries(Object.entries(f.targets).map(([rid, t]) => [rid, t === "sep" ? undefined : t]).filter(([, t]) => t)),
  }));
  if (ws.includeOwn) {
    const from = Math.min(...confirmed.map((f) => f.payload.period.from));
    const to = Math.max(...confirmed.map((f) => f.payload.period.to));
    const own = await ownPayload(api, { from, to, label: periodLabel({ from, to }) });
    own.sources = own.sources.map((s) => ({ ...s, thisComputer: true }));
    sources.unshift({ key: "own", payload: own, targets: identityTargets(own) });
  }
  return mergeReports(sources, { locals: api.students });
}

function workspaceHtml(api, st) {
  const ws = st.ws;
  const anyConfirmed = ws.files.some((f) => f.status === "open" && f.confirmed);
  return `
    <div class="rap__ws">
      <header class="rap__ws-head card">
        <div>
          <h2>${icon("merge")} Sammanställning av rapportfiler</h2>
          <p class="rap__note">${icon("shield")} Den dekrypterade datan finns bara i minnet — den sparas inte och
            försvinner när du stänger eller lämnar fliken.</p>
        </div>
        <div class="rap__ws-actions">
          <label class="btn">${icon("plus")}Lägg till filer
            <input class="sr-only" type="file" multiple accept="${FILE_EXT},${MIME}" data-rap-files aria-label="Lägg till rapportfiler"></label>
          <button class="btn" data-rap-close>${icon("x")}Stäng och rensa</button>
        </div>
      </header>

      <div class="rap__drop rap__drop--slim" data-rap-drop>${icon("upload")}<span>Dra och släpp fler filer här</span></div>

      <ol class="rap-files">${ws.files.map((f) => fileHtml(api, f, ws)).join("")}</ol>

      <label class="rap__own card">
        <input type="checkbox" data-rap-own ${ws.includeOwn ? "checked" : ""}>
        <span>Ta med mina egna noteringar från den här datorn <span class="rap__sub">(samma period som filerna)</span></span>
      </label>

      <div class="rap__analysis" data-rap-analysis>
        ${anyConfirmed ? `<p class="rap__sub">Sammanställer…</p>`
          : `<p class="rap__hint card">Öppna en fil och bekräfta matchningen för att se den gemensamma analysen.</p>`}
      </div>
    </div>`;
}

function wireWorkspace(el, api, st) {
  const ws = st.ws;
  const byKey = (k) => ws.files.find((f) => f.key === k);
  wireFileInputs(el, api, st);

  el.querySelector("[data-rap-close]").addEventListener("click", () => {
    closeReportWorkspace(api);
    api.refresh();
  });
  el.querySelector("[data-rap-own]").addEventListener("change", (e) => {
    ws.includeOwn = e.target.checked;
    api.refresh();
  });
  el.querySelectorAll("[data-rap-unlock]").forEach((form) => form.addEventListener("submit", (e) => {
    e.preventDefault();
    const entry = byKey(form.dataset.rapUnlock);
    const input = form.querySelector("[name=pw]");
    const pw = input.value;
    input.value = "";
    if (entry && pw) void unlockFile(api, st, entry, pw);
  }));
  el.querySelector(".rap-files").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rap-remove]");
    if (rm) {
      ws.files = ws.files.filter((f) => f.key !== rm.dataset.rapRemove);
      if (ws.files.length === 0) st.ws = null;
      api.refresh();
      return;
    }
    const edit = e.target.closest("[data-rap-edit]");
    if (edit) { const f = byKey(edit.dataset.rapEdit); if (f) f.confirmed = false; api.refresh(); return; }
    const conf = e.target.closest("[data-rap-confirm]");
    if (conf) {
      const f = byKey(conf.dataset.rapConfirm);
      if (!f) return;
      f.confirmed = true;
      // Spara BARA namnparen (namn ↔ lokalt id) — ingen notisdata.
      const rows = f.payload.students.map((rs) => {
        const t = f.targets[rs.localId];
        return { name: rs.name, tag: rs.tag, localId: t?.startsWith("local:") ? t.slice(6) : null };
      });
      const pairs = updateSavedPairs(savedPairs(api), f.payload.exporter.uid, rows);
      void api.data.put(reportsPath(api.cid), { id: REPORTS_MATCHES_ID, pairs });
      api.refresh();
    }
  });
  el.querySelectorAll("[data-rap-target]").forEach((sel) => sel.addEventListener("change", () => {
    const f = byKey(sel.dataset.rapTarget);
    if (!f) return;
    f.targets[sel.dataset.remote] = sel.value;
    f.reasons[sel.dataset.remote] = "manual";
    api.refresh();
  }));

  const slot = el.querySelector("[data-rap-analysis]");
  if (!ws.files.some((f) => f.status === "open" && f.confirmed)) return;
  const token = (ws.renderToken = (ws.renderToken ?? 0) + 1);
  void buildMerged(api, ws).then((merged) => {
    if (!merged || st.ws !== ws || ws.renderToken !== token || !slot.isConnected) return;
    ws.merged = merged;
    renderAnalysis(slot, api, st, merged);
  });
}

function renderAnalysis(slot, api, st, merged) {
  const ws = st.ws;
  const now = serverNow();
  const cls = className(api);
  if (ws.view && !merged.students.some((s) => s.key === ws.view)) ws.view = "";
  const selected = merged.students.find((s) => s.key === ws.view) ?? null;
  const teacherDots = (s) => merged.teachers.filter((t) => s.notes.some((n) => n.createdBy === t.uid))
    .map((t) => `<span class="rp-dot" style="--t-color:${esc(t.color)}" title="${esc(t.name)}"></span>`).join("");

  slot.innerHTML = `
    <div class="rap__analysis-bar card">
      <label class="rap__field"><span>Visa</span>
        <select data-rap-view>
          <option value="">Hela klassen (${merged.students.length} elever)</option>
          ${merged.students.map((s) => `<option value="${esc(s.key)}" ${s.key === ws.view ? "selected" : ""}>${esc(studentName(s))}${
            s.fromFile ? ` (${esc(genitive(s.fromFile))} fil)` : ""} — ${s.notes.length} not.</option>`).join("")}
        </select>
      </label>
      <div class="rap__actions">
        <button class="btn" data-rap-save="encrypted">${icon("lock")}Spara sammanställningen (krypterad)</button>
        <button class="btn" data-rap-save="print">${icon("printer")}Utskrift / PDF</button>
      </div>
    </div>
    <div class="rp-doc rp-doc--screen card">
      ${renderSources(merged, { now })}
      ${selected ? renderStudentReport(selected, merged, { className: cls, now }) : `
        ${renderClassSummary(merged, { className: cls, now })}
        <ul class="rap-students">
          ${merged.students.map((s) => {
            const fu = s.notes.filter((n) => n.followUp).length;
            return `<li><button class="rap-student" data-rap-open="${esc(s.key)}">
              <strong>${esc(studentName(s))}</strong>${s.fromFile ? ` <span class="rap__sub">(${esc(genitive(s.fromFile))} fil)</span>` : ""}
              <span class="rap__sub">${s.notes.length} ${s.notes.length === 1 ? "notering" : "noteringar"}${fu ? ` · <span class="rap-fu">${icon("flag")}${fu} uppföljning${fu === 1 ? "" : "ar"}</span>` : ""}</span>
              <span class="rap-student__dots">${teacherDots(s)}</span>
            </button></li>`;
          }).join("")}
        </ul>`}
    </div>`;

  slot.querySelector("[data-rap-view]").addEventListener("change", (e) => {
    ws.view = e.target.value;
    renderAnalysis(slot, api, st, merged);
  });
  slot.querySelector(".rap-students")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rap-open]");
    if (b) { ws.view = b.dataset.rapOpen; renderAnalysis(slot, api, st, merged); slot.scrollIntoView({ block: "start" }); }
  });
  slot.querySelectorAll("[data-rap-save]").forEach((b) => b.addEventListener("click", () => {
    const payload = mergedToPayload(merged, { className: cls, classId: api.cid, teacher: teacher(), now: serverNow() });
    if (b.dataset.rapSave === "print") {
      openPrintView({
        title: `Sammanställning ${cls} ${periodFileTag(merged.period)}`,
        html: renderReportDocument(merged, { className: cls, studentKey: ws.view || null, now: serverNow(), title: "Sammanställning" }),
      });
      return;
    }
    if (!cryptoAvailable()) { api.toast(ERROR_TEXT["no-crypto"]); return; }
    const fileName = reportFileName({ className: cls, period: merged.period, teacherName: teacher().name, merged: true });
    openPasswordDialog({
      title: "Lösenord för sammanställningen",
      fileName,
      summary: `Sammanställning · ${merged.teachers.map((t) => t.name).join(", ")} · ${payload.students.length} elever · ${payload.period.label}`,
      onSubmit: async (password) => {
        const bytes = await encryptReport(payload, password, { meta: reportMeta(payload) });
        downloadBlob(new Blob([bytes], { type: MIME }), fileName);
        api.toast(`Sparad: ${fileName} — lösenordet sparas inte.`);
      },
    });
  }));
}
