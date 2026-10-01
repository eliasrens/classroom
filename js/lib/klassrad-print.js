/**
 * KLASSRÅD — utskriften, ren logik (issue #126, epic #124). Ingen DOM,
 * går att testa i Node (docs/test-klassrad-print.mjs). Arken byggs av
 * js/modes/klassrad/print.js.
 *
 * Två utskrifter, samma layout som lärarens Word-mall:
 *   "protocol"  ett möte (det öppna eller ett ur arkivet), ifyllt
 *   "template"  lärarens AKTUELLA mall, tom — linjer att skriva på för
 *               hand (för en elevsekreterare)
 *
 * SIDINDELNINGEN görs här, inte av webbläsaren: varje A4-ark är en egen
 * box (som Skrivtavlan, issue #55) och får "Sida 1 av 2" längst ned.
 * printPages() packar blocken (rubriken, punkterna) på arken så att en
 * punkt — rubrik, frågor och anteckningar — aldrig delas mellan två
 * sidor. Bara en punkt som är längre än ett helt ark bryts, och då
 * mellan två anteckningsrader: rubriken står kvar med minst MIN_LINES
 * rader, och nästa ark börjar med "(forts.)".
 *
 * Filnamnet (= dokumenttiteln) är "Klassråd 4B v.40 2026-10-01" — klass,
 * vecka och datum, aldrig ett elevnamn.
 */

import { weekOfDate, formatDate, isIsoDate, noteLines, pointNumbers } from "./klassrad.js";

/** Tomma linjer i den tomma mallen, och under en tom punkt i protokollet. */
export const TEMPLATE_RULES = 5;
export const EMPTY_RULES = 3;
/** Minst så här många anteckningsrader står kvar med rubriken när en lång punkt bryts. */
export const MIN_LINES = 2;

/**
 * Arket i mm. 209 × 296,5 (strax under A4: avrundning får aldrig ge en
 * tom extrasida) med marginalerna som VIT padding — utskriftsdialogens
 * "Marginaler" spelar ingen roll (@page har marginal 0). Sidfoten står i
 * den nedre marginalen. Samma mått som .krp-sheet i css/modes/klassrad.css.
 */
export const SHEET_MM = Object.freeze({ width: 209, height: 296.5, top: 18, side: 19, bottom: 20 });
export const MM_PX = 96 / 25.4;
/** Textytans höjd per ark, i px (CSS-px, 96 dpi). */
export const SHEET_BODY_PX = (SHEET_MM.height - SHEET_MM.top - SHEET_MM.bottom) * MM_PX;

const cleanName = (s) => String(s ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();

/**
 * Dokumenttiteln — Chrome föreslår den som filnamn för PDF:en.
 * Protokollet: "Klassråd 4B v.40 2026-10-01". Mallen: "Klassråd 4B tom mall".
 * Aldrig ett elevnamn: bara klassens namn, veckan och datumet.
 */
export function printTitle({ kind = "protocol", className = "", date = "" } = {}) {
  const cls = cleanName(className);
  if (kind === "template") return ["Klassråd", cls, "tom mall"].filter(Boolean).join(" ");
  const week = weekOfDate(date);
  return ["Klassråd", cls, week ? `v.${week}` : "", isIsoDate(date) ? date : ""].filter(Boolean).join(" ");
}

/** Anteckningsrubriken med kolon: "Anteckningar:", "Det här skickar vi med:". */
export function notesHeading(label) {
  const l = String(label ?? "").trim() || "Anteckningar";
  return /[:?!.]$/.test(l) ? l : `${l}:`;
}

/**
 * Vad som skrivs ut — samma data för båda utskrifterna.
 *   head:   { date, week, chair, secretary } (tomma i mallen → linjer)
 *   points: [{ id, num, icon, title, prompts, heading, lines, rules, prev }]
 *     lines  anteckningarna, en rad per punkt i listan
 *     rules  antal tomma linjer (tom punkt, eller mallen)
 *     prev   "Från förra klassrådet" (bara punkt 2, om det finns något)
 * `meeting` för protokollet, `template` för den tomma mallen.
 */
export function printModel({ kind = "protocol", meeting = null, template = null, prev = null } = {}) {
  const blank = kind === "template";
  const src = blank ? template : meeting;
  const points = src?.points ?? [];
  const nums = pointNumbers(points);
  const done = new Set(blank ? [] : meeting?.followDone ?? []);
  const prevBox = !blank && prev && prev.groups?.length
    ? {
      date: formatDate(prev.from.date),
      week: weekOfDate(prev.from.date),
      groups: prev.groups.map((g) => ({ title: g.title, items: g.items.map((it) => ({ text: it.text, done: done.has(it.key) })) })),
    }
    : null;
  return {
    kind: blank ? "template" : "protocol",
    head: blank
      ? { date: "", week: null, chair: "", secretary: "" }
      : { date: formatDate(meeting?.date), week: weekOfDate(meeting?.date), chair: meeting?.chair ?? "", secretary: meeting?.secretary ?? "" },
    points: points.map((p, i) => {
      const lines = blank ? [] : noteLines(p.notes);
      return {
        id: p.id,
        num: nums[i],
        icon: p.icon,
        title: p.title,
        prompts: [...p.prompts],
        heading: notesHeading(p.notesLabel),
        lines,
        rules: blank ? TEMPLATE_RULES : (lines.length ? 0 : EMPTY_RULES),
        prev: p.role === "previous" ? prevBox : null,
      };
    }),
  };
}

/**
 * Packa blocken på ark. Höjderna mäts i webbläsaren (print.js); här är
 * de bara tal, så att regeln går att testa.
 *
 *   blocks  [{ head: px, lines: [px, …] }] — `head` hålls alltid ihop
 *           (rubrik, frågor, rutan, anteckningsrubriken); `lines` är
 *           anteckningarnas synliga rader / de tomma linjerna
 *   pageH   textytans höjd per ark
 *   gap     luft mellan två block på samma ark (inte överst på ett ark)
 *   contH   höjden på "(forts.)"-raden överst när en punkt fortsätter
 *
 * Svar: ark → delar { block, from, to, cont }: blockets rader [from, to),
 * `cont` = fortsättning (rubriken står på ett tidigare ark).
 *
 * Regeln: ett block som ryms på arket läggs där. Annars börjar det på
 * nästa ark — om det ryms på ett helt ark. Bara ett block som är längre
 * än ett helt ark bryts, mellan två rader, med minst `minLines` rader
 * kvar hos rubriken och minst `minLines` på nästa ark (om det går).
 */
export function printPages(blocks, { pageH, gap = 0, contH = 0, minLines = MIN_LINES } = {}) {
  const pages = [[]];
  let used = 0;
  const sum = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i]; return s; };
  const newPage = () => { if (pages.at(-1).length) pages.push([]); used = 0; };
  const fits = (h) => used + (used > 0 ? gap : 0) + h <= pageH;
  const put = (part, h) => { used += (used > 0 ? gap : 0) + h; pages.at(-1).push(part); };

  blocks.forEach((b, block) => {
    const lines = b.lines ?? [];
    const total = b.head + sum(lines);
    if (fits(total)) { put({ block, from: 0, to: lines.length, cont: false }, total); return; }
    if (total <= pageH) { newPage(); put({ block, from: 0, to: lines.length, cont: false }, total); return; }

    // Längre än ett ark: bryts. Rubriken börjar där minst minLines rader ryms med den.
    const lead = Math.min(minLines, lines.length);
    if (!fits(b.head + sum(lines, 0, lead))) newPage();
    let from = 0;
    let first = true;
    while (from < lines.length || first) {
      const top = first ? b.head : contH;
      const room = pageH - used - (used > 0 ? gap : 0) - top;
      let to = from;
      let h = 0;
      while (to < lines.length && h + lines[to] <= room) { h += lines[to]; to++; }
      if (to === from && from < lines.length) { h += lines[to]; to++; } // minst en rad per ark
      // Ingen ensam rest: lämna minst minLines till nästa ark, om den här delen ändå behåller minLines.
      const rest = lines.length - to;
      if (rest > 0 && rest < minLines) {
        const back = Math.min(minLines - rest, to - from - minLines);
        if (back > 0) { to -= back; h = sum(lines, from, to); }
      }
      put({ block, from, to, cont: !first }, top + h);
      first = false;
      from = to;
      if (from < lines.length) newPage();
    }
  });
  return pages;
}
