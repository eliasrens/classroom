/**
 * KLASSRÅD — utskrift (issue #126). ENDAST LÄRARVY.
 *
 * Protokollet (ett ifyllt möte) eller den tomma mallen på A4, i samma
 * struktur som lärarens Word-mall: ikon och KLASSRÅD, Datum, Vecka,
 * Ordförande och Sekreterare, sedan punkterna med rubrik, hjälpfrågor och
 * "Anteckningar:". Webbläsarens egen utskrift (window.print(), "Spara som
 * PDF" finns där) — inget bibliotek, inget nätverk: protokollet har
 * elevnamn och lämnar aldrig datorn.
 *
 * Som Skrivtavlan (js/modes/skriv/print.js, issue #55): @page har
 * marginal 0 och varje A4-ark är en EGEN box med marginalerna som vit
 * padding, så utskriftsdialogens "Marginaler" spelar ingen roll. Arken
 * delas upp här: blocken läggs ut osynligt i exakt utskriftsbredd, mäts,
 * och js/lib/klassrad-print.js → printPages() packar dem på arken så att
 * en punkt aldrig delas (bara en punkt längre än ett helt ark bryts,
 * mellan två rader). Varje ark får "Sida 1 av 2" längst ned.
 *
 * Anteckningarna delas i sina SYNLIGA rader (en Range mäter var
 * webbläsaren bryter), så att en lång rad också kan brytas mellan två ark
 * utan att klippas. Linjerna att skriva på är riktiga kantlinjer, inte en
 * bakgrund — bakgrunder skrivs ofta inte ut. Inga fyllda ytor: svart text
 * och rubrikfärgen, samma utseende i mörkt och ljust tema.
 */

import { icon } from "../../lib/icons.js";
import { printModel, printPages, printTitle, MM_PX, SHEET_BODY_PX } from "../../lib/klassrad-print.js";

/** Luft mellan två punkter på samma ark (mm). Samma som --krp-gap i CSS. */
const GAP_MM = 6;
/**
 * Sidans marginal under utskriften: A4 utan marginal (arkens padding är
 * marginalen). Appens övriga utskrifter har en @page utan namn (rapport.css,
 * 12 mm) och Chrome lägger ut dokumentet i DEN sidans bredd — därför läggs
 * den här sist i <head>, bara medan arket finns.
 */
const PAGE_CSS = "@page { size: A4 portrait; margin: 0; }";

let current = null; // { root, pageStyle, title, prevTitle, pages }

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function ico(name, size) {
  const s = el("span", "krp-ico");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = icon(name, { size, strokeWidth: 1.7 });
  return s;
}

/** Ta bort arket och återställ sidan (efter utskrift, Avbryt eller unmount). */
export function closeKlassradPrint() {
  if (!current) return;
  current.root.remove();
  current.pageStyle.remove();
  document.documentElement.classList.remove("krp-printing");
  document.body.classList.remove("krp-printing");
  if (current.titled) document.title = current.prevTitle;
  current = null;
}

/** Finns ett utskriftsark (byggt av panelen eller av Ctrl+P)? */
export const hasKlassradPrint = () => current !== null;

/** Antal ark i den byggda utskriften. */
export const klassradPrintPages = () => current?.pages ?? 0;

// ---- Blocken ------------------------------------------------------------------

/** Överst: ikon och KLASSRÅD, sedan Datum, Vecka, Ordförande, Sekreterare. */
function topBlock(head, blank) {
  const top = el("header", "krp-top");
  const h = el("h1", "krp-title");
  h.append(ico("gavel", 30), el("span", null, "Klassråd"));
  const dl = el("dl", `krp-meta${blank ? " is-blank" : ""}`);
  for (const [label, value] of [
    ["Datum", head.date], ["Vecka", head.week ? String(head.week) : ""],
    ["Ordförande", head.chair], ["Sekreterare", head.secretary],
  ]) {
    const row = el("div");
    row.append(el("dt", null, `${label}:`), el("dd", value ? null : "krp-fill", value || ""));
    dl.append(row);
  }
  top.append(h, dl);
  return top;
}

function pointTitle(p, { cont = false } = {}) {
  const h = el(cont ? "p" : "h2", cont ? "krp-cont" : "krp-point__title");
  if (!cont) h.append(ico(p.icon, 22));
  if (p.num != null) h.append(el("span", "krp-num", `${p.num}.`));
  h.append(el("span", null, p.title));
  if (cont) h.append(el("span", "krp-cont__note", "(forts.)"));
  return h;
}

/** "Från förra klassrådet" — bockade och obockade rader. */
function prevBox(prev) {
  const box = el("div", "krp-prev");
  const h = el("p", "krp-prev__title");
  h.append(ico("back", 16), el("span", null, "Från förra klassrådet"),
    el("span", "krp-prev__date", `${prev.date}${prev.week ? ` · v. ${prev.week}` : ""}`));
  box.append(h);
  const many = prev.groups.length > 1;
  for (const g of prev.groups) {
    if (many) box.append(el("p", "krp-prev__group", g.title));
    const ul = el("ul", "krp-prev__list");
    for (const it of g.items) {
      const li = el("li", it.done ? "is-done" : null);
      const mark = el("span", "krp-check");
      mark.setAttribute("aria-hidden", "true");
      if (it.done) mark.innerHTML = icon("check", { size: 12, strokeWidth: 2.6 });
      li.append(mark, el("span", null, it.text));
      if (it.done) li.append(el("span", "krp-done", "gjort"));
      ul.append(li);
    }
    box.append(ul);
  }
  return box;
}

/** Punktens fasta del: rubrik, hjälpfrågor, rutan och anteckningsrubriken. */
function pointHead(p) {
  const head = el("div", "krp-point__head");
  head.append(pointTitle(p));
  if (p.prompts.length) {
    const q = el("div", "krp-prompts");
    for (const t of p.prompts) q.append(el("p", null, t));
    head.append(q);
  }
  if (p.prev) head.append(prevBox(p.prev));
  head.append(el("p", "krp-notes-h", p.heading));
  return head;
}

/**
 * Dela en anteckningsrad (ett element med en textnod, pre-wrap, i exakt
 * utskriftsbredd) i de synliga rader webbläsaren bryter den i.
 */
function visualLines(item, lh) {
  const node = item.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [""];
  if (item.getBoundingClientRect().height < lh * 1.5) return [node.data];
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
    if (r.top > lineTop + lh / 2) {
      out.push(text.slice(start, i));
      start = i;
      lineTop = r.top;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Punktens rader: anteckningarnas synliga rader, eller tomma linjer. */
function pointLines(p, measure, lh) {
  const lines = [];
  for (const text of p.lines) {
    const item = el("div", "krp-item", text);
    measure.append(item);
    visualLines(item, lh).forEach((t, k) => {
      lines.push(el("div", `krp-line${k === 0 ? " krp-line--first" : ""}`, t.replace(/\s+$/, "")));
    });
    item.remove();
  }
  for (let k = 0; k < p.rules; k++) lines.push(el("div", "krp-rule"));
  return lines;
}

function sheet() {
  const s = el("section", "krp-sheet");
  const body = el("div", "krp-body");
  s.append(body);
  return { s, body };
}

// ---- Arken ----------------------------------------------------------------------

/**
 * Bygg arken (synkront) direkt i <body>: på skärmen osynliga men i exakt
 * utskriftsbredd, under utskriften det enda som syns.
 *   kind       "protocol" (meeting + prev) eller "template" (template)
 *   className  klassens namn — sidfoten och filnamnet
 * Svar: { root, pages, title }.
 */
export function buildKlassradPrint({ kind = "protocol", meeting = null, template = null, prev = null, className = "" } = {}) {
  closeKlassradPrint();
  const model = printModel({ kind, meeting, template, prev });
  const blank = model.kind === "template";
  const title = printTitle({ kind: model.kind, className, date: meeting?.date });

  const root = el("div", "krp teacher-only");
  root.setAttribute("aria-hidden", "true");
  const pageStyle = el("style", null, PAGE_CSS);
  current = { root, pageStyle, title, prevTitle: document.title, titled: false, pages: 0 }; // closeKlassradPrint städar även vid fel
  root.style.setProperty("--krp-gap", `${GAP_MM}mm`);
  const m = sheet();
  root.append(m.s);
  document.body.append(root);
  document.head.append(pageStyle);
  document.documentElement.classList.add("krp-printing"); // marginalerna: vitt, inte appens mörka botten
  document.body.classList.add("krp-printing");

  // Mät: radhöjden, "(forts.)"-raden, rubriken och varje punkt.
  const probe = el("div", "krp-line", "Ag");
  m.body.append(probe);
  const lh = probe.getBoundingClientRect().height;
  probe.remove();

  const top = topBlock(model.head, blank);
  m.body.append(top);
  const topH = top.getBoundingClientRect().height;
  top.remove();

  const parts = model.points.map((p) => {
    const wrap = el("section", "krp-point");
    const head = pointHead(p);
    wrap.append(head);
    m.body.append(wrap);
    const lines = pointLines(p, wrap, lh);
    wrap.append(...lines);
    const headH = head.getBoundingClientRect().height;
    const heights = lines.map((l) => l.getBoundingClientRect().height);
    let contH = 0;
    if (p.lines.length) {
      const c = pointTitle(p, { cont: true });
      wrap.prepend(c);
      contH = c.getBoundingClientRect().height;
      c.remove();
    }
    wrap.remove();
    return { p, head, lines, headH, heights, contH };
  });
  m.s.remove();

  const blocks = [{ head: topH, lines: [] }, ...parts.map((x) => ({ head: x.headH, lines: x.heights }))];
  const contH = Math.max(0, ...parts.map((x) => x.contH));
  const pages = printPages(blocks, { pageH: SHEET_BODY_PX - 1, gap: GAP_MM * MM_PX, contH });

  const footLeft = blank ? title : `Klassråd ${className}`.trim() + (model.head.week ? ` · v. ${model.head.week}` : "");
  pages.forEach((page, i) => {
    const s = sheet();
    for (const part of page) {
      if (part.block === 0) { s.body.append(topBlock(model.head, blank)); continue; }
      const x = parts[part.block - 1];
      const sec = el("section", `krp-point${part.cont ? " krp-point--cont" : ""}`);
      sec.append(part.cont ? pointTitle(x.p, { cont: true }) : x.head.cloneNode(true));
      for (let k = part.from; k < part.to; k++) sec.append(x.lines[k].cloneNode(true));
      s.body.append(sec);
    }
    const foot = el("footer", "krp-foot");
    foot.append(el("span", null, footLeft), el("span", null, `Sida ${i + 1} av ${pages.length}`));
    s.s.append(foot);
    root.append(s.s);
  });
  current.pages = pages.length;
  return { root, pages: pages.length, title };
}

/** Kopior av arken i förhandsvisningen (panelen i lärarvyn). */
export function renderKlassradPreview(container) {
  const sheets = current ? [...current.root.querySelectorAll(".krp-sheet")] : [];
  container.replaceChildren(...sheets.map((s, i) => {
    const page = el("div", "krp-preview__page");
    page.setAttribute("aria-label", `Sida ${i + 1} av ${sheets.length}`);
    page.setAttribute("role", "img");
    page.append(s.cloneNode(true));
    return page;
  }));
}

/** Dokumenttiteln = PDF:ens förslag på filnamn ("Klassråd 4B v.40 2026-10-01"). */
export function titleKlassradPrint() {
  if (!current || current.titled) return;
  current.prevTitle = document.title;
  current.titled = true;
  document.title = current.title;
}

/** Skriv ut det byggda arket (webbläsarens utskriftsruta). */
export function printKlassrad() {
  if (!current) return;
  titleKlassradPrint();
  window.print();
}
