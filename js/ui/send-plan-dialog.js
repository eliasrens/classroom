/**
 * "SKICKA KOPIA TILL KLASS…" — dialog (issue #103, samma mönster som
 * Mina ämnen #81 / Mina klasser #102). Logiken: js/lib/send-plan.js.
 *
 *  - Klass: radioknappar för MINA klasser (js/lib/my-classes.js) utom den
 *    aktuella; utan val listas alla. "Visa alla klasser" visar även
 *    övriga. En enda tänkbar klass är förvald; ingen alls → neutral text
 *    och avstängd Skicka.
 *  - En planering: Datum, Start och Slut förifyllda från originalet och
 *    ändringsbara (det är därför funktionen finns).
 *  - Flera planeringar ("Välj flera"): bara klassvalet — var och en
 *    behåller sina datum och tider.
 *  - Dubblettvarning: har målklassen redan en av MINA planeringar med samma
 *    namn samma datum visas en rad och knappen blir "Skicka ändå". Blockerar
 *    aldrig. Målklassens planeringar följs live (data.watch) medan dialogen
 *    är öppen.
 *  - Esc/Avbryt stänger. Lägenas kortkommandon slår inte igenom
 *    (.sp-modal i dialogOpen, js/ui/shortcuts.js).
 */

import { icon } from "../lib/icons.js";
import { MY_CLASSES_DOC, myClassesPath, myClassIds, filterClasses } from "../lib/my-classes.js";
import { buildCopy, findDuplicates, sendPlanCopies } from "../lib/send-plan.js";
import { plansPath } from "../data/plans.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let current = null;

export function closeSendPlanDialog(result = null) {
  if (!current) return;
  window.removeEventListener("keydown", current.onKey, true);
  current.stopWatch?.();
  current.root.remove();
  const { resolve: done, opener } = current;
  current = null;
  if (opener?.isConnected) opener.focus?.();
  done?.(result);
}

/**
 * openSendPlanDialog({ data, currentCid, plans, subjects, now })
 *  plans: EN eller flera normaliserade planeringar (lektion.js normalizePlan).
 *  subjects: ursprungsklassens ämnen (inbyggda + egna).
 * Promise → { cid, className, ids, copies } när kopiorna skickats,
 * null om dialogen stängdes utan att skicka.
 */
export async function openSendPlanDialog({ data, currentCid, plans, subjects, now = Date.now() }) {
  closeSendPlanDialog();
  const opener = document.activeElement;
  const single = plans.length === 1;
  const src = plans[0];

  const classes = (await data.list("classes"))
    .filter((c) => c.id !== currentCid)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "sv"));
  const mine = myClassIds(await data.get(myClassesPath(), MY_CLASSES_DOC));
  const mineOnly = filterClasses(classes, mine);
  let showAll = false;
  let chosen = mineOnly.length === 1 ? mineOnly[0].id : null;
  let targetPlans = [];

  const root = document.createElement("div");
  root.className = "ms-modal sp-modal teacher-only";
  const title = single ? "Skicka kopia till klass" : `Skicka ${plans.length} planeringar till klass`;
  const when = single
    ? `<div class="sp-when">
        <label class="field-label">Datum <input type="date" data-sp="date" value="${esc(src.date)}" required></label>
        <label class="field-label">Start <input type="time" data-sp="start" value="${esc(src.start)}"></label>
        <label class="field-label">Slut <input type="time" data-sp="end" value="${esc(src.end)}"></label>
      </div>`
    : `<p class="ms-lead">${plans.length} planeringar behåller sina datum och tider.</p>`;
  root.innerHTML = `
    <form class="ms-dialog sp-dialog" role="dialog" aria-modal="true" aria-labelledby="sp-dialog-title" novalidate>
      <h2 id="sp-dialog-title">${icon("copy")} ${esc(title)}</h2>
      ${single ? `<p class="ms-lead">Kopian av <strong>${esc(src.name)}</strong> blir en egen planering i
        den valda klassen. Den visas inte på elevskärmen där.</p>` : ""}
      <fieldset class="sp-classes">
        <legend>Klass</legend>
        <div class="sp-class-list" data-el="classes"></div>
      </fieldset>
      ${when}
      <p class="sp-warn" data-el="warn" role="status" hidden></p>
      <p class="sp-error" data-el="error" role="alert" hidden></p>
      <div class="ms-actions">
        <button class="btn" type="button" data-cancel>Avbryt</button>
        <button class="btn btn--primary" type="submit" data-el="send">${icon("copy")}<span></span></button>
      </div>
    </form>`;
  document.body.append(root);

  const form = root.querySelector("form");
  const listEl = form.querySelector('[data-el="classes"]');
  const warnEl = form.querySelector('[data-el="warn"]');
  const errorEl = form.querySelector('[data-el="error"]');
  const sendBtn = form.querySelector('[data-el="send"]');
  const input = (k) => form.querySelector(`[data-sp="${k}"]`);
  const className = (id) => classes.find((c) => c.id === id)?.name ?? "";

  /** Kopiorna som de skulle bli med dialogens nuvarande värden. */
  const copies = () => plans.map((p) => buildCopy(p, single
    ? { date: input("date").value, start: input("start").value, end: input("end").value }
    : {}));

  function renderClasses() {
    const visible = showAll ? classes : mineOnly;
    const hidden = classes.length - visible.length;
    if (classes.length === 0) {
      listEl.innerHTML = `<p class="ms-lead">Det finns ingen annan klass att skicka till.</p>`;
      return;
    }
    listEl.innerHTML = visible.map((c) => `<label class="ms-row">
        <input type="radio" name="sp-class" value="${esc(c.id)}" ${c.id === chosen ? "checked" : ""}>
        <span>${esc(c.name)}</span>
      </label>`).join("")
      + (hidden > 0
        ? `<button type="button" class="sp-show-all" data-show-all>Visa alla klasser (${hidden} till)</button>`
        : "");
  }

  function renderState() {
    const dups = chosen ? findDuplicates(targetPlans, copies()) : [];
    if (dups.length === 0) {
      warnEl.hidden = true;
      warnEl.textContent = "";
    } else {
      const cls = className(chosen);
      warnEl.textContent = single
        ? `${cls} har redan "${dups[0].name}" den dagen.`
        : `${cls} har redan ${dups.length} av de ${plans.length} planeringarna samma dag (samma namn).`;
      warnEl.hidden = false;
    }
    const label = dups.length ? "Skicka ändå" : single ? "Skicka kopia" : `Skicka ${plans.length} kopior`;
    sendBtn.querySelector("span").textContent = label;
    sendBtn.disabled = !chosen || (single && !input("date").value);
  }

  // Målklassens planeringar följs live — dubblettvarningen stämmer även
  // om de hinner synka in medan dialogen är öppen.
  let stopWatch = null;
  function watchTarget() {
    stopWatch?.();
    targetPlans = [];
    stopWatch = chosen ? data.watch(plansPath(chosen), (docs) => { targetPlans = docs; renderState(); }) : null;
    if (current) current.stopWatch = stopWatch;
    renderState();
  }

  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); closeSendPlanDialog(); return; }
    if (root.contains(e.target)) e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  root.addEventListener("mousedown", (e) => { if (e.target === root) closeSendPlanDialog(); });

  form.addEventListener("change", (e) => {
    if (e.target.name === "sp-class") { chosen = e.target.value; errorEl.hidden = true; watchTarget(); return; }
    renderState();
  });
  form.addEventListener("input", renderState);
  form.addEventListener("click", (e) => {
    if (!e.target.closest("[data-show-all]")) return;
    showAll = true;
    renderClasses();
    (listEl.querySelector(`input[value="${CSS.escape(chosen ?? "")}"]`)
      ?? listEl.querySelector("input[type=radio]"))?.focus();
  });
  form.querySelector("[data-cancel]").addEventListener("click", () => closeSendPlanDialog());

  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || sendBtn.disabled) return;
    busy = true;
    try {
      const list = copies();
      const ids = await sendPlanCopies(data, { targetCid: chosen, copies: list, subjects, now });
      closeSendPlanDialog({ cid: chosen, className: className(chosen), ids, copies: list });
    } catch (err) {
      busy = false;
      console.warn("[skicka kopia] kunde inte skicka:", err);
      errorEl.textContent = "Kopian kunde inte skickas. Försök igen.";
      errorEl.hidden = false;
    }
  });

  renderClasses();
  const promise = new Promise((resolve) => { current = { root, onKey, resolve, opener, stopWatch: null }; });
  watchTarget();
  // En förvald klass → rakt till tiden (det är den som oftast ska ändras).
  const focus = chosen && single ? input("start")
    : listEl.querySelector("input[type=radio]") ?? form.querySelector("[data-cancel]");
  focus?.focus();
  return promise;
}
