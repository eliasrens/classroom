/**
 * UTFÄLLBAR SEKTION — gemensam för lärarpanelerna (issue #66).
 *
 * Rubrikraden är EN knapp (hela raden är klickyta): pil ▸/▾, rubrik och —
 * när sektionen är stängd — en kort sammanfattning i grå text. Knappen är
 * en riktig <button>, så Enter/Space fungerar utan egen tangenthantering;
 * aria-expanded/aria-controls pekar på innehållet.
 *
 * Öppning/stängning animeras i CSS (css/app.css, .collapsible) och
 * respekterar prefers-reduced-motion. Stängt innehåll är visibility:hidden
 * → hoppas över av Tab och skärmläsare.
 *
 * Öppet/stängt sparas i localStorage per dator och sektion
 * (`classroom:ui:collapse:<scope>:<key>`) — bara UI-tillstånd, ingen elevdata.
 * Sektioner med `persist: false` (t.ex. Lektionsplaneringens fält, vars
 * standardläge följer innehållet) sparas inte.
 *
 *   el.innerHTML = collapsibleHTML({ key: "tasks", title: "Att göra", body });
 *   const sections = mountCollapsibles(el, { scope: "morgon", defaults: { tasks: true } });
 *   sections.setSummary("tasks", "4 uppgifter · 2 visas");
 */

const STORAGE_PREFIX = "classroom:ui:collapse:";
let uid = 0;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * Markup för en sektion. `title` och `icon` är färdig HTML (ikon-SVG ok),
 * `body` sektionens innehåll. `persist: false` = spara inte läget.
 * `lead`/`trail` (valfria, färdig HTML) hamnar i rubrikraden före resp. efter
 * knappen — för kontroller som inte får ligga inuti knappen (en kryssruta,
 * en egen knapp). Rubrikraden blir då en flexrad (.collapsible__heading--row).
 */
export function collapsibleHTML({ key, title, icon = "", body = "", className = "", persist = true, level = 3, lead = "", trail = "" }) {
  const id = `cl-${++uid}`;
  const h = `h${Math.min(Math.max(level, 2), 6)}`;
  return `<section class="collapsible ${className}" data-collapsible="${esc(key)}" data-open="false"${persist ? "" : ' data-persist="false"'}>
    <${h} class="collapsible__heading${lead || trail ? " collapsible__heading--row" : ""}">${lead}
      <button type="button" class="collapsible__head" id="${id}-head" aria-expanded="false" aria-controls="${id}-body">
        <span class="collapsible__arrow" aria-hidden="true"></span>
        <span class="collapsible__title">${icon}<span>${title}</span></span>
        <span class="collapsible__summary" data-summary></span>
      </button>${trail}
    </${h}>
    <div class="collapsible__body" id="${id}-body" role="region" aria-labelledby="${id}-head">
      <div class="collapsible__inner">${body}</div>
    </div>
  </section>`;
}

function readStored(scope, key) {
  try {
    const v = localStorage.getItem(`${STORAGE_PREFIX}${scope}:${key}`);
    return v === "1" ? true : v === "0" ? false : null;
  } catch { return null; }
}
function writeStored(scope, key, open) {
  try { localStorage.setItem(`${STORAGE_PREFIX}${scope}:${key}`, open ? "1" : "0"); } catch { /* ok */ }
}

/**
 * Kopplar alla `[data-collapsible]` under `root` (även sådana som läggs till
 * senare — klick hanteras via delegering). `defaults` = { key: öppen? } när
 * inget sparat läge finns — eller en funktion `(key) => öppen?` för nycklar
 * som inte är kända i förväg (t.ex. en per vecka). `onToggle(key, open)`
 * anropas efter varje växling som läraren gör.
 */
export function mountCollapsibles(root, { scope, defaults = {}, onToggle } = {}) {
  const find = (key) => root.querySelector(`[data-collapsible="${CSS.escape(key)}"]`);
  const persists = (sec) => sec.dataset.persist !== "false";

  function apply(sec, open) {
    sec.dataset.open = String(open);
    sec.querySelector(":scope > .collapsible__heading > .collapsible__head")
      ?.setAttribute("aria-expanded", String(open));
  }

  /** Sätt start-läget för sektioner som inte kopplats ännu. */
  function init() {
    for (const sec of root.querySelectorAll("[data-collapsible]:not([data-cl-ready])")) {
      sec.dataset.clReady = "";
      const key = sec.dataset.collapsible;
      const stored = persists(sec) ? readStored(scope, key) : null;
      const fallback = typeof defaults === "function" ? defaults(key) : defaults[key];
      apply(sec, stored ?? !!fallback);
    }
  }

  const onClick = (e) => {
    const head = e.target.closest(".collapsible__head");
    if (!head || !root.contains(head)) return;
    const sec = head.closest("[data-collapsible]");
    if (!sec) return;
    const open = sec.dataset.open !== "true";
    apply(sec, open);
    if (persists(sec)) writeStored(scope, sec.dataset.collapsible, open);
    onToggle?.(sec.dataset.collapsible, open);
  };
  root.addEventListener("click", onClick);
  init();

  return {
    /** Koppla sektioner som lagts till efter mount (t.ex. ombyggd redigerare). */
    init,
    isOpen: (key) => find(key)?.dataset.open === "true",
    /** Öppna/stäng programmatiskt. Sparas bara med `{ persist: true }`. */
    setOpen(key, open, { persist = false } = {}) {
      const sec = find(key);
      if (!sec) return;
      apply(sec, !!open);
      if (persist && persists(sec)) writeStored(scope, key, !!open);
    },
    /** Sammanfattningen (visas när stängd). Sträng = text, `{ html }` = färdig HTML. */
    setSummary(key, summary) {
      const el = find(key)?.querySelector(":scope > .collapsible__heading [data-summary]");
      if (!el) return;
      if (summary && typeof summary === "object") { el.innerHTML = summary.html ?? ""; el.title = el.textContent.trim(); }
      else {
        // Texten i ett eget spann så den trunkeras med … på smala paneler;
        // hela texten finns i title.
        el.innerHTML = summary ? `<span>${esc(summary)}</span>` : "";
        el.title = summary ?? "";
      }
    },
    destroy() { root.removeEventListener("click", onClick); },
  };
}

/** Kort sammanfattning av fritext: de första orden, eller "tomt". */
export function firstWords(text, max = 42) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "tomt";
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
