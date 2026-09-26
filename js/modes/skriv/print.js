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
 * Marginalerna (issue #55): @page har marginal 0, och varje A4-ark är en
 * EGEN box (.skr-print__sheet, 209 × 296,5 mm) med ~15 mm vit padding runt
 * om. Därför blir det alltid vitt runt linjerna, vad läraren än väljer
 * under "Marginaler" i utskriftsdialogen ("Standard", "Minimum", "Inga").
 * Arken delas upp här, inte av webbläsaren: varje ark får sitt eget
 * sidhuvud (klass, datum, valfri rubrik) och ett helt antal rader.
 */

/** 15 pt = 20 px. Radavstånd som på skärmen (skriv.js LINE_HEIGHT). */
const PRINT_FONT_PX = 20;
const LINE_HEIGHT = 1.75;
const PRINT_LH = Math.round(PRINT_FONT_PX * LINE_HEIGHT); // 35 px ≈ 9,3 mm
const RULE_W = 1.5;
/**
 * Arkets inre höjd: 296,5 mm (en halv mm under A4, så att avrundning
 * aldrig ger en tom extrasida) − 2 × 15 mm padding. Samma mått som
 * .skr-print__sheet i css/modes/skriv.css.
 */
const SHEET_INNER_PX = ((296.5 - 2 * 15) * 96) / 25.4;

/**
 * Sidans marginal under utskriften. Appens övriga utskrifter har en egen
 * @page utan namn (css/modes/rapport.css, 12 mm) och Chrome lägger ut hela
 * dokumentet i DEN sidans bredd — då skulle arken (209 mm) krympas.
 * Därför, bara medan arket finns: A4 utan marginal (arkens padding är
 * marginalen). Läggs sist i <head> så att den vinner.
 */
const PAGE_CSS = "@page { size: A4 portrait; margin: 0; }";

let current = null; // { root, pageStyle, onAfter, prevTitle }

/** Ta bort arket och återställ sidan (efter utskrift, eller vid unmount). */
export function closeSkrivPrint() {
  if (!current) return;
  window.removeEventListener("afterprint", current.onAfter);
  current.root.remove();
  current.pageStyle.remove();
  document.documentElement.classList.remove("skr-printing");
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

/** Sidhuvudet överst på varje A4-ark. */
function sheetHead({ at }, head) {
  const header = el("div", "skr-print__head");
  const left = el("span", "skr-print__who");
  left.append(el("strong", "skr-print__class", head.className));
  if (head.title) left.append(el("span", "skr-print__title", head.title));
  header.append(left, el("span", "skr-print__date", longDate(new Date(at || Date.now()))));
  return header;
}

/** Ett A4-ark: sidhuvud + textyta. */
function sheet(header) {
  const section = el("section", "skr-print__sheet");
  const body = el("div", "skr-print__text");
  section.append(header, body);
  return { section, body };
}

/**
 * Bygg arken (synkront — typsnittet måste redan vara laddat, se
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
  // Först ett ark per sida av Skrivtavlan, med textraderna — för mätningen.
  const firsts = pages.map((p) => {
    const s = sheet(sheetHead(p, head));
    for (const row of p.text.replace(/\s+$/, "").split("\n")) s.body.append(el("div", "skr-print__row", row));
    root.append(s.section);
    return s;
  });
  document.body.append(root);
  const pageStyle = el("style", null, PAGE_CSS);
  document.head.append(pageStyle);
  const onAfter = () => closeSkrivPrint();
  current = { root, pageStyle, onAfter, prevTitle: document.title }; // closeSkrivPrint städar även vid fel

  // Baslinjen: linjens överkant där bokstäverna står.
  const baseY = base.getBoundingClientRect().bottom - probeLine.getBoundingClientRect().top;
  const ruleY = Math.min(PRINT_LH - RULE_W, Math.max(0, Math.round(baseY)));
  root.style.setProperty("--skr-p-rule-y", `${ruleY}px`);
  probe.remove();

  // Mät alla rader först, byt sedan (en layout i stället för en per rad).
  const split = firsts.map((s) => [...s.body.children].flatMap(visualLines));

  // Dela varje sida i A4-ark. Ett ark rymmer sidhuvudet + ett helt antal
  // rader; det sista fylls med tomma linjer — linjerat ända ner, som ett
  // riktigt skrivpapper (#50).
  firsts.forEach((first, i) => {
    const headH = first.body.getBoundingClientRect().top - first.section.firstChild.getBoundingClientRect().top;
    const perSheet = Math.max(1, Math.floor((SHEET_INNER_PX - headH - 1) / PRINT_LH));
    const lines = split[i];
    const n = Math.max(1, Math.ceil(lines.length / perSheet));
    first.body.replaceChildren();
    let at = first.section;
    for (let k = 0; k < n; k++) {
      const s = k === 0 ? first : sheet(first.section.firstChild.cloneNode(true));
      if (k > 0) { at.after(s.section); at = s.section; }
      for (let j = k * perSheet; j < (k + 1) * perSheet; j++) {
        s.body.append(j < lines.length
          ? el("div", "skr-print__line", lines[j])
          : el("div", "skr-print__line skr-print__line--blank"));
      }
    }
  });

  // Dokumenttiteln = PDF:ens förslag på filnamn. Utan elevnamn.
  document.title = `Skrivtavla ${head.className} ${isoDate(new Date())}`.replace(/\s+/g, " ").trim();
  document.documentElement.classList.add("skr-printing"); // marginalerna: vitt, inte appens mörka botten
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
