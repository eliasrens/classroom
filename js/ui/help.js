/**
 * HJÄLP — tangentbordsgenvägar samlade under "?".
 *
 * Öppnas med `?` (Shift+/) var som helst i lärarvyn, eller via
 * hjälpknappen i topbaren. En lugn overlay som listar appens genvägar
 * — det enda stället de dokumenteras, så listan hålls ärlig mot vad
 * js/ui/shortcuts.js och lägena faktiskt lyssnar på.
 *
 * ALDRIG på elevskärmen: overlayn öppnas inte i elevvyn och stängs om
 * fönstret växlar dit (samma spärr som snabbanteckningen).
 */

import { icon } from "../lib/icons.js";

/**
 * SANNINGSKÄLLA för genvägarna. shortcuts.js implementerar de globala;
 * timer-genvägarna ligger i js/modes/trafikljus.js, snabbanteckningen i
 * js/ui/quick-note.js och elevtangenter/ångra i js/modes/elever.js.
 */
export const SHORTCUT_GROUPS = [
  {
    title: "Överallt",
    items: [
      { keys: ["1", "–", "5"], text: "Byt läge (Morgon, Lektion, Trafikljus, Elever, Översikt)" },
      { keys: ["E"], text: "Öppna eller fokusera elevskärmen" },
      { keys: ["F9"], text: "Snabbanteckning om en elev" },
      { keys: ["?"], text: "Visa den här genvägslistan" },
      { keys: ["Esc"], text: "Stäng ruta · lämna elevskärmens helskärm" },
    ],
  },
  {
    title: "Trafikljusur",
    items: [
      { keys: ["Mellanslag"], text: "Starta / stoppa timern" },
      { keys: ["R"], text: "Återställ timern" },
    ],
  },
  {
    title: "Elevlista — Registrera",
    items: [
      { keys: ["Elevens tangent"], text: "Snabbnotering på eleven" },
      { keys: ["Shift", "+", "tangent"], text: "Positiv notering i stället" },
      { keys: ["Ctrl", "+", "Z"], text: "Ångra senaste noteringen" },
    ],
  },
];

const isStudentWindow = (store) =>
  store.get().view === "student" ||
  document.documentElement.dataset.theme === "student";

export function initHelp({ store }) {
  let root = null;

  function groupHTML(g) {
    const rows = g.items.map((it) => `
      <div class="help__row">
        <dt class="help__keys">${it.keys.map((k) =>
          k === "+" || k === "–" ? `<span class="help__sep">${k}</span>` : `<kbd>${k}</kbd>`
        ).join(" ")}</dt>
        <dd class="help__desc">${it.text}</dd>
      </div>`).join("");
    return `<section class="help__group">
      <h3>${g.title}</h3>
      <dl class="help__list">${rows}</dl>
    </section>`;
  }

  function open() {
    if (root || isStudentWindow(store)) return;
    root = document.createElement("div");
    root.className = "help";
    root.dataset.open = "true";
    root.innerHTML = `
      <div class="help__scrim" data-close></div>
      <div class="help__box card" role="dialog" aria-modal="true" aria-label="Tangentbordsgenvägar">
        <header class="help__head">
          <strong>${icon("keyboard")} Tangentbordsgenvägar</strong>
          <button class="btn btn--ghost btn--icon" data-close aria-label="Stäng">${icon("x")}</button>
        </header>
        <div class="help__body">${SHORTCUT_GROUPS.map(groupHTML).join("")}</div>
        <p class="help__foot">Genvägar pausar när du skriver i ett fält.</p>
      </div>`;
    document.body.append(root);
    root.querySelectorAll("[data-close]").forEach((b) =>
      b.addEventListener("click", close));
    root.querySelector(".help__box").focus?.();
  }

  function close() { root?.remove(); root = null; }
  function toggle() { root ? close() : open(); }

  // Stäng om fönstret växlar till elevvy (spärren).
  store.subscribe(["view"], ({ view }) => { if (view === "student") close(); });

  // Esc stänger overlayn (fångas här så den inte lämnar elevhelskärm m.m.)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root) { e.stopPropagation(); close(); }
  });

  return { open, close, toggle, isOpen: () => !!root };
}
