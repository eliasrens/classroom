/**
 * SKRIVTAVLA — utskrift (issue #50). ENDAST LÄRARVY.
 *
 * Skriver ut en eller flera sidor av Skrivtavlan på linjerat A4 med
 * Andika, t.ex. till elever som varit sjuka. Webbläsarens egen utskrift
 * (window.print(), där "Spara som PDF" också finns) — inget bibliotek,
 * inget nätverk: texten kan innehålla elevnamn och lämnar aldrig datorn.
 *
 * Utskriften ser likadan ut varje gång: fast storlek (PRINT_FONT_PX),
 * oberoende av skärmens A−/A+. Arket byggs som ett eget element direkt i
 * <body> (.skr-print, css/modes/skriv.css); under utskriften döljs allt
 * annat (body.skr-printing).
 *
 * Linjerna är RIKTIGA element (en kantlinje per rad), inte en bakgrund —
 * bakgrunder skrivs ofta inte ut ("Bakgrundsgrafik" av). Därför delas
 * varje textrad upp i sina SYNLIGA rader: texten läggs först ut i exakt
 * utskriftsbredd (osynligt, på skärmen), radbrytningarna mäts med en
 * Range, och varje synlig rad blir ett eget element med sin linje på den
 * uppmätta baslinjen. En rad kan då aldrig klippas mellan två A4-sidor.
 *
 * Sidhuvudet (klass, datum, valfri rubrik) ligger i en <thead>, som
 * webbläsaren upprepar överst på varje utskrivet A4-ark.
 */

/** 15 pt = 20 px. Radavstånd som på skärmen (skriv.js LINE_HEIGHT). */
const PRINT_FONT_PX = 20;
const LINE_HEIGHT = 1.75;
const PRINT_LH = Math.round(PRINT_FONT_PX * LINE_HEIGHT); // 35 px ≈ 9,3 mm
const RULE_W = 1.5;

let current = null; // { root, onAfter, prevTitle }

/** Ta bort arket och återställ sidan (efter utskrift, eller vid unmount). */
export function closeSkrivPrint() {
  if (!current) return;
  window.removeEventListener("afterprint", current.onAfter);
  current.root.remove();
  document.body.classList.remove("skr-printing");
  document.title = current.prevTitle;
  current = null;
}

const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const longDate = (d) => d.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Dela en textrad (ett element med en textnod, pre-wrap, utskriftsbredd)
 * i de synliga rader webbläsaren bryter den i.
 */
function visualLines(rowEl) {
  const node = rowEl.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE || node.length === 0) return [""];
  const text = node.data;
  const range = document.createRange();
  const out = [];
  let start = 0;
  let lineTop = null;
  for (let i = 0; i < text.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getClientRects()[0];
    if (!r) continue;
    if (lineTop === null) { lineTop = r.top; continue; }
    if (r.top > lineTop + PRINT_LH / 2) {
      out.push(text.slice(start, i));
      start = i;
      lineTop = r.top;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Ett ark per sida: <table> med sidhuvud i <thead> + raderna i <tbody>. */
function pageSection({ text, at }, head) {
  const section = el("section", "skr-print__page");
  const table = el("table", "skr-print__table");
  const thead = el("thead");
  const th = el("th");
  const header = el("div", "skr-print__head");
  const left = el("span", "skr-print__who");
  left.append(el("strong", "skr-print__class", head.className));
  if (head.title) left.append(el("span", "skr-print__title", head.title));
  header.append(left, el("span", "skr-print__date", longDate(new Date(at || Date.now()))));
  th.append(header);
  thead.append(el("tr")).append(th);
  const tbody = el("tbody");
  const td = el("td");
  const body = el("div", "skr-print__text");
  for (const row of text.replace(/\s+$/, "").split("\n")) body.append(el("div", "skr-print__row", row));
  td.append(body);
  tbody.append(el("tr")).append(td);
  table.append(thead, tbody);
  section.append(table);
  return section;
}

/**
 * Bygg arket (synkront — typsnittet måste redan vara laddat, se
 * printSkrivPages) och byt varje textrad mot sina synliga rader.
 */
export function buildSkrivPrint({ pages, className, title }) {
  closeSkrivPrint();
  const root = el("div", "skr-print teacher-only");
  root.setAttribute("aria-hidden", "true");
  root.style.setProperty("--skr-p-font", `${PRINT_FONT_PX}px`);
  root.style.setProperty("--skr-p-lh", `${PRINT_LH}px`);
  root.style.setProperty("--skr-p-rule-w", `${RULE_W}px`);
  const probe = el("div", "skr-print__text skr-print__probe");
  const probeLine = el("div", "skr-print__line", "Ag");
  const base = el("span", "skr-print__base");
  probeLine.append(base);
  probe.append(probeLine);
  root.append(probe);
  const head = { className: className || "", title: (title || "").trim() };
  for (const p of pages) root.append(pageSection(p, head));
  document.body.append(root);

  // Baslinjen: linjens överkant där bokstäverna står.
  const baseY = base.getBoundingClientRect().bottom - probeLine.getBoundingClientRect().top;
  const ruleY = Math.min(PRINT_LH - RULE_W, Math.max(0, Math.round(baseY)));
  root.style.setProperty("--skr-p-rule-y", `${ruleY}px`);
  probe.remove();

  // Mät alla rader först, byt sedan (en layout i stället för en per rad).
  const rows = [...root.querySelectorAll(".skr-print__row")];
  const split = rows.map(visualLines);
  rows.forEach((row, i) => {
    row.replaceWith(...split[i].map((t) => el("div", "skr-print__line", t)));
  });

  const onAfter = () => closeSkrivPrint();
  current = { root, onAfter, prevTitle: document.title };
  // Dokumenttiteln = PDF:ens förslag på filnamn. Utan elevnamn.
  document.title = `Skrivtavla ${head.className} ${isoDate(new Date())}`.replace(/\s+/g, " ").trim();
  document.body.classList.add("skr-printing");
  window.addEventListener("afterprint", onAfter);
  return root;
}

/** Ladda Andika, bygg arket och öppna webbläsarens utskrift. */
export async function printSkrivPages(opts) {
  try { await document.fonts?.load(`${PRINT_FONT_PX}px "Andika"`, "aAgG åäö"); } catch { /* reservtypsnitt */ }
  buildSkrivPrint(opts);
  window.print();
}

/** Har utskriften redan ett ark (t.ex. byggt innan Ctrl+P)? */
export const hasSkrivPrint = () => current !== null;
