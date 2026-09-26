/**
 * SKRIVTAVLA (issue #46) — läraren skriver, eleverna ser texten live på
 * ett virtuellt linjerat papper och skriver av.
 *
 * Papperet: svagt varmvit botten, mörkgrå linjer (ingen marginallinje),
 * typsnittet Andika (SIL, enkelt "a" och "g" som i handskrift, självhostat
 * under fonts/andika/). Linjerna ritas som en bakgrund vars period ÄR
 * radhöjden (heltal px) och vars linje ligger på den UPPMÄTTA baslinjen —
 * bokstäverna står alltså på linjen i alla storlekar.
 *
 * Proportionellt: textstorleken räknas som en andel av papperets
 * innerbredd (layout()). Lärarens förhandsvisning och elevskärmen bryter
 * därför raderna på samma ställen, oavsett skärmstorlek — och en
 * scrollposition kan skickas som RADNUMMER (scrollLine) i stället för px.
 *
 * Följ skrivandet (standard): papperet rullar så att raden läraren skriver
 * på står högt upp (FOLLOW_AT av höjden) — både i lärarvyn och på
 * elevskärmen, som var för sig mäter var markören hamnar i sin egen layout.
 * Scrollar läraren själv (hjul, touch, rullist, PageUp/Down) stängs Följ
 * av och elevskärmen följer lärarens scroll; knappen "Följ skrivandet"
 * slår på det igen.
 *
 * Data (se DATAMODELL.md): hela tillståndet ligger i den ENDAST LOKALA
 * classes/{cid}/skriv/board (js/data/local-only.js — texten kan innehålla
 * elevnamn och får ALDRIG nå Firestore). Varje ändring går direkt ut på
 * sync-bussen (`skriv:state`); lagringen sker med debounce så att en
 * omladdad elevskärm visar rätt text. `rev` ordnar bussen mot
 * storage-eventet så att en sen sparning aldrig skriver över nyare text.
 *
 * Skriv ut (issue #50): lärarvyn kan skriva ut aktuell sida eller valda
 * sparade sidor på linjerat A4 — se js/modes/skriv/print.js.
 */

import { icon } from "../lib/icons.js";
import { printSkrivPages, buildSkrivPrint, closeSkrivPrint, hasSkrivPrint } from "./skriv/print.js";

const DOC_ID = "board";
const EVENT = "skriv:state";
const SAVE_DEBOUNCE_MS = 400;
const MAX_PAGES = 10;

/** Textstorlek = andel av papperets innerbredd. Index sparas. */
const SIZES = [0.026, 0.032, 0.037, 0.044, 0.052, 0.06];
const DEFAULT_SIZE = 2;
const LINE_HEIGHT = 1.75;  // radavstånd i em — plats för versaler och svansar
const PAD_X = 0.045;       // sidomarginal som andel av papperets bredd
const PAD_TOP = 0.6;       // luft ovanför första raden, i radhöjder
const FOLLOW_AT = 0.25;    // Följ: aktuell rad står här (andel av höjden)

const skrivPath = (cid) => `classes/${cid}/skriv`;

const reducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

const clampSize = (n) => (Number.isInteger(n) && n >= 0 && n < SIZES.length ? n : DEFAULT_SIZE);

/** Normalisera det sparade dokumentet. */
function normalizeBoard(raw) {
  const pages = Array.isArray(raw?.pages)
    ? raw.pages.filter((p) => typeof p?.text === "string").slice(-MAX_PAGES).map((p) => ({ text: p.text, at: Number(p.at) || 0 }))
    : [];
  if (pages.length === 0) pages.push({ text: "", at: Date.now() });
  const cur = Number.isInteger(raw?.cur) && raw.cur >= 0 && raw.cur < pages.length ? raw.cur : pages.length - 1;
  const text = pages[cur].text;
  const caret = Number.isInteger(raw?.caret) ? Math.min(Math.max(0, raw.caret), text.length) : text.length;
  return {
    pages,
    cur,
    caret,
    size: clampSize(raw?.size),
    follow: raw?.follow !== false,
    scrollLine: Number.isFinite(raw?.scrollLine) && raw.scrollLine > 0 ? raw.scrollLine : 0,
    rev: Number(raw?.rev) || 0,
  };
}

// ---- Papperet: mått, rader, markörens rad ----------------------------------

/**
 * Räkna ut papperets mått ur dess bredd och sätt dem som CSS-variabler.
 * Radhöjden avrundas till hela px så att bakgrundens linjer aldrig driftar
 * mot textraderna långt ned på sidan. Baslinjen MÄTS (inline-block med
 * höjd 0 står på baslinjen) — då gäller linjerna även med reservtypsnittet.
 */
function layout(paper, sizeIndex) {
  const w = paper.clientWidth;
  const h = paper.clientHeight;
  if (!w || !h) return null;
  const padX = Math.round(w * PAD_X);
  const font = (w - 2 * padX) * SIZES[sizeIndex];
  const lh = Math.max(8, Math.round(font * LINE_HEIGHT));
  const padTop = Math.round(lh * PAD_TOP);
  const s = paper.style;
  s.setProperty("--skr-font", `${font.toFixed(2)}px`);
  s.setProperty("--skr-lh", `${lh}px`);
  s.setProperty("--skr-pad-x", `${padX}px`);
  s.setProperty("--skr-pad-top", `${padTop}px`);
  s.setProperty("--skr-pad-bottom", `${Math.round(h * (1 - FOLLOW_AT))}px`);
  s.setProperty("--skr-min-text", `${Math.max(lh, h - padTop)}px`);

  const probe = paper.querySelector(".skr-probe");
  const line = probe.firstElementChild;
  const mark = line.querySelector(".skr-probe__base");
  const base = mark.getBoundingClientRect().bottom - line.getBoundingClientRect().top;
  const ruleW = Math.max(1, Math.round(lh / 50));
  // Linjens överkant på baslinjen: bokstäverna står på linjen.
  const ruleY = Math.min(lh - ruleW, Math.max(0, Math.round(base)));
  s.setProperty("--skr-rule-y", `${ruleY}px`);
  s.setProperty("--skr-rule-w", `${ruleW}px`);
  return { lh, padTop, height: h };
}

/** Rendera texten som en div per rad (samma radbrytning som textarean). */
function renderLines(el, text) {
  const frag = document.createDocumentFragment();
  for (const row of text.split("\n")) {
    const div = document.createElement("div");
    div.className = "skr-line";
    div.textContent = row;
    frag.append(div);
  }
  el.replaceChildren(frag);
}

/**
 * Överkanten (px från textytans topp) för den rad markören står på.
 * Logisk rad = antal radbrytningar före markören; inom en ombruten rad
 * mäts positionen med en Range på textnoden.
 */
function caretLineTop(el, text, caret, lh) {
  const before = text.slice(0, caret);
  const row = before.split("\n").length - 1;
  const col = caret - (before.lastIndexOf("\n") + 1);
  const lineEl = el.children[row];
  if (!lineEl) return 0;
  const top = el.getBoundingClientRect().top;
  let y = lineEl.getBoundingClientRect().top - top;
  const node = lineEl.firstChild;
  if (col > 0 && node?.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    range.setStart(node, Math.min(col, node.length));
    range.collapse(true);
    const rects = range.getClientRects();
    const r = rects[rects.length - 1] ?? range.getBoundingClientRect();
    if (r && r.height) y = r.top - top + r.height / 2;
  }
  return Math.max(0, Math.floor((y + 0.5) / lh)) * lh;
}

/** Scrollposition som håller markörens rad på FOLLOW_AT av höjden. */
function followTarget(m, lineTop) {
  return Math.max(0, m.padTop + lineTop - Math.round(m.height * FOLLOW_AT));
}

function scrollPaper(paper, top, smooth) {
  const max = paper.scrollHeight - paper.clientHeight;
  const target = Math.round(Math.min(Math.max(0, top), Math.max(0, max)));
  if (Math.abs(paper.scrollTop - target) < 1) return;
  // Dolt fönster: webbläsaren pausar mjuk scroll där — hoppa direkt.
  const soft = smooth && !reducedMotion() && document.visibilityState === "visible";
  paper.scrollTo({ top: target, behavior: soft ? "smooth" : "auto" });
}

/** Ladda Andika uttryckligen (webbläsaren laddar annars först vid behov). */
function whenFontReady(cb) {
  const fonts = document.fonts;
  if (!fonts?.load) return;
  fonts.load('32px "Andika"', "aAgG åäö").then(() => cb(), () => {});
}

// ---- Läget ------------------------------------------------------------------

export default {
  id: "skriv",
  title: "Skrivtavla",
  icon: "pen",

  async mount(el, ctx) {
    const offs = [];
    this._offs = offs; // städning registreras innan något startas

    const { view, activeClass, data, sync } = ctx;
    const isStudent = view === "student";

    if (!activeClass) {
      el.innerHTML = `
        <div class="mode-placeholder">
          <div class="mode-placeholder__icon">${icon("pen", { size: 44, strokeWidth: 1.4 })}</div>
          <h1>Skrivtavla</h1>
          <p>${isStudent ? "Ingen klass vald." : "Välj en klass i topbaren för att skriva på skrivtavlan."}</p>
        </div>`;
      return;
    }

    const cid = activeClass.id;
    el.innerHTML = isStudent ? studentMarkup() : teacherMarkup();
    const paper = el.querySelector(".skr-paper");
    const textEl = el.querySelector(".skr-text:not(textarea)"); // elev: själva texten; lärare: spegeln
    let metrics = null;

    const offResize = (fn) => {
      if (typeof ResizeObserver !== "function") return;
      let frame = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(fn);
      });
      ro.observe(paper);
      offs.push(() => { cancelAnimationFrame(frame); ro.disconnect(); });
    };

    if (isStudent) {
      mountStudent();
      return;
    }
    mountTeacher();

    // ---- Elevskärmen: bara papperet, följer läraren ----

    function mountStudent() {
      let state = normalizeBoard(null);
      let drawnText = null;
      let drawnSize = null;
      let lastRev = -1;

      function apply(next, { smooth = true } = {}) {
        if (!paper.isConnected) return;
        if (next) {
          if (next.rev < lastRev) return; // en sen sparning — bussen har redan nyare
          lastRev = next.rev;
          state = next;
        }
        const text = state.pages[state.cur].text;
        if (drawnSize !== state.size || !metrics) {
          metrics = layout(paper, state.size);
          drawnSize = state.size;
          smooth = false;
        }
        if (drawnText !== text) { renderLines(textEl, text); drawnText = text; }
        if (!metrics) return;
        const top = state.follow
          ? followTarget(metrics, caretLineTop(textEl, text, state.caret, metrics.lh))
          : state.scrollLine * metrics.lh;
        scrollPaper(paper, top, smooth && state.follow);
      }

      const relayout = () => { metrics = layout(paper, state.size); drawnSize = state.size; apply(null, { smooth: false }); };
      offResize(relayout);
      whenFontReady(relayout);

      offs.push(data.watch(skrivPath(cid), (docs) => {
        apply(normalizeBoard(docs.find((d) => d.id === DOC_ID)), { smooth: false });
      }));
      offs.push(sync.on(EVENT, ({ payload }) => apply(normalizeBoard(payload))));
    }

    // ---- Lärarvyn: skrivyta, storlek, sidor, Följ ----

    function mountTeacher() {
      const ta = el.querySelector("textarea.skr-text");
      const sizeDown = el.querySelector('[data-act="size-down"]');
      const sizeUp = el.querySelector('[data-act="size-up"]');
      const sizeLabel = el.querySelector(".skr-size");
      const followBtn = el.querySelector('[data-act="follow"]');
      const pageLabel = el.querySelector(".skr-pagelabel");
      const prevBtn = el.querySelector('[data-act="page-prev"]');
      const nextBtn = el.querySelector('[data-act="page-next"]');
      const newBtn = el.querySelector('[data-act="new-page"]');
      const confirmEl = el.querySelector(".skr-confirm");
      const printBtn = el.querySelector('[data-act="print"]');
      const printPanel = el.querySelector(".skr-printpanel");
      const printList = printPanel.querySelector(".skr-printpanel__list");
      const printAll = printPanel.querySelector("[data-print-all]");
      const printTitle = printPanel.querySelector('input[name="skr-print-title"]');
      const printGo = printPanel.querySelector('[data-act="print-go"]');

      let board = normalizeBoard(null);
      let loaded = false;
      let saveTimer = 0;
      let scrollFrame = 0;
      let followFrame = 0;

      // ---- Tillstånd ut: bussen direkt, lagringen med debounce ----

      const caretOf = () => (ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd);

      function snapshot() {
        board.pages[board.cur].text = ta.value;
        board.caret = caretOf();
        board.rev = Math.max(Date.now(), board.rev + 1);
        return {
          id: DOC_ID,
          pages: board.pages.map((p) => ({ ...p })),
          cur: board.cur,
          caret: board.caret,
          size: board.size,
          follow: board.follow,
          scrollLine: board.scrollLine,
          rev: board.rev,
        };
      }

      function save(doc) {
        clearTimeout(saveTimer);
        saveTimer = 0;
        void data.put(skrivPath(cid), doc);
      }

      let pending = null;
      function publish({ now = false } = {}) {
        if (!loaded) return;
        const doc = snapshot();
        sync.publish(EVENT, doc);
        pending = doc;
        clearTimeout(saveTimer);
        if (now) save(doc);
        else saveTimer = setTimeout(() => save(pending), SAVE_DEBOUNCE_MS);
      }
      const flush = () => { if (saveTimer && pending) save(pending); };
      window.addEventListener("pagehide", flush);
      offs.push(() => { window.removeEventListener("pagehide", flush); flush(); });
      offs.push(() => { cancelAnimationFrame(scrollFrame); cancelAnimationFrame(followFrame); });

      // ---- Papperet i lärarvyn ----

      /** Spegeln (dold, samma layout) + textareans höjd = innehållets. */
      function syncMirror() {
        renderLines(textEl, ta.value);
        if (!metrics) return;
        const h = textEl.offsetHeight + metrics.lh; // en rad luft: textarean ska aldrig scrolla själv
        ta.style.height = `${h}px`;
        ta.scrollTop = 0;
      }

      function relayout() {
        metrics = layout(paper, board.size);
        syncMirror();
        if (board.follow) followCaret(false);
        else if (metrics) scrollPaper(paper, board.scrollLine * metrics.lh, false);
      }

      function followCaret(smooth = true) {
        if (!metrics) return;
        const top = caretLineTop(textEl, ta.value, caretOf(), metrics.lh);
        scrollPaper(paper, followTarget(metrics, top), smooth);
      }

      function drawControls() {
        sizeLabel.textContent = `${board.size + 1} / ${SIZES.length}`;
        sizeDown.disabled = board.size === 0;
        sizeUp.disabled = board.size === SIZES.length - 1;
        followBtn.setAttribute("aria-pressed", String(board.follow));
        followBtn.classList.toggle("is-off", !board.follow);
        const n = board.pages.length;
        pageLabel.textContent = `Sida ${board.cur + 1} av ${n}`;
        prevBtn.disabled = board.cur === 0;
        nextBtn.disabled = board.cur === n - 1;
        drawPrintBtn();
      }

      function showPage(i, caret = null) {
        closePrintPanel();
        board.pages[board.cur].text = ta.value;
        board.cur = i;
        ta.value = board.pages[i].text;
        const c = caret ?? ta.value.length;
        ta.setSelectionRange(c, c);
        syncMirror();
        board.follow = true;
        drawControls();
        followCaret(false);
        publish({ now: true });
      }

      function setFollow(on) {
        if (board.follow === on) return;
        board.follow = on;
        if (!on && metrics) board.scrollLine = paper.scrollTop / metrics.lh;
        drawControls();
        if (on) followCaret(true);
        publish();
      }

      // ---- Skriva ----

      const onCaret = () => {
        cancelAnimationFrame(followFrame);
        followFrame = requestAnimationFrame(() => {
          if (board.follow) followCaret(true);
          publish();
        });
      };

      ta.addEventListener("input", () => {
        syncMirror();
        closeConfirm();
        closePrintPanel();
        drawPrintBtn();
        onCaret();
      });
      for (const type of ["keyup", "click", "select"]) ta.addEventListener(type, () => {
        if (caretOf() !== board.caret) onCaret();
      });
      // Textarean har ingen egen scroll — texten ska alltid ligga på linjerna.
      ta.addEventListener("scroll", () => { ta.scrollTop = 0; });

      // Klick på tomt papper under texten: skriv vidare i slutet.
      paper.addEventListener("mousedown", (e) => {
        if (e.target === ta || e.target === paper) return;
        e.preventDefault();
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        onCaret();
      });

      // ---- Scroll: manuell scroll stänger av Följ, speglas på elevskärmen ----

      const manual = () => setFollow(false);
      paper.addEventListener("wheel", manual, { passive: true });
      paper.addEventListener("touchmove", manual, { passive: true });
      // Rullisten: mousedown direkt på papperet (inte på texten).
      paper.addEventListener("mousedown", (e) => { if (e.target === paper) manual(); });
      paper.addEventListener("keydown", (e) => {
        if (e.target !== ta && /^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown| )$/.test(e.key)) manual();
      });
      paper.addEventListener("scroll", () => {
        if (board.follow || !metrics) return;
        cancelAnimationFrame(scrollFrame);
        scrollFrame = requestAnimationFrame(() => {
          board.scrollLine = paper.scrollTop / metrics.lh;
          publish();
        });
      }, { passive: true });

      followBtn.addEventListener("click", () => {
        setFollow(!board.follow);
        if (board.follow) ta.focus({ preventScroll: true });
      });

      // ---- Storlek ----

      function setSize(n) {
        const next = clampSize(n);
        if (next === board.size) return;
        board.size = next;
        drawControls();
        relayout();
        publish({ now: true });
      }
      sizeDown.addEventListener("click", () => setSize(board.size - 1));
      sizeUp.addEventListener("click", () => setSize(board.size + 1));

      // ---- Ångra / Gör om (webbläsarens egen historik i textarean) ----

      for (const b of el.querySelectorAll("[data-undo]")) {
        b.addEventListener("click", () => {
          ta.focus({ preventScroll: true });
          document.execCommand(b.dataset.undo); // input-eventet sköter resten
        });
      }

      // ---- Sidor: Ny sida (med bekräftelse), bläddra bland de senaste ----

      function closeConfirm() { confirmEl.hidden = true; newBtn.hidden = false; }

      function newPage() {
        closeConfirm();
        board.pages[board.cur].text = ta.value;
        const kept = board.pages.filter((p) => p.text.trim() !== "");
        kept.push({ text: "", at: Date.now() });
        board.pages = kept.slice(-MAX_PAGES);
        board.cur = board.pages.length - 1; // (showPage sparar inte om den gamla sidan)
        ta.value = "";
        showPage(board.cur, 0);
        ta.focus({ preventScroll: true });
      }

      newBtn.addEventListener("click", () => {
        if (ta.value.trim() === "" && board.cur === board.pages.length - 1) { ta.focus(); return; }
        newBtn.hidden = true;
        confirmEl.hidden = false;
        confirmEl.querySelector('[data-act="confirm-new"]').focus();
      });
      confirmEl.querySelector('[data-act="confirm-new"]').addEventListener("click", newPage);
      confirmEl.querySelector('[data-act="cancel-new"]').addEventListener("click", () => { closeConfirm(); ta.focus(); });
      // ---- Skriv ut: aktuell sida som standard, eller valda sparade sidor ----

      /** Sidorna med text (index i board.pages), aktuell sida med textareans text. */
      function printable() {
        board.pages[board.cur].text = ta.value;
        return board.pages.map((p, i) => ({ ...p, i })).filter((p) => p.text.trim() !== "");
      }

      function drawPrintBtn() {
        const empty = printable().length === 0;
        printBtn.setAttribute("aria-disabled", String(empty));
        printBtn.title = empty
          ? "Inget att skriva ut — sidan är tom"
          : "Skriv ut på linjerat A4, t.ex. till elever som varit borta (eller spara som PDF)";
      }

      function closePrintPanel() {
        if (printPanel.hidden) return;
        printPanel.hidden = true;
        printBtn.setAttribute("aria-expanded", "false");
      }

      const printChecks = () => [...printList.querySelectorAll("input[data-page]")];

      function drawPrintAll() {
        const boxes = printChecks();
        const n = boxes.filter((b) => b.checked).length;
        printAll.checked = n > 0 && n === boxes.length;
        printAll.indeterminate = n > 0 && n < boxes.length;
        printGo.disabled = n === 0;
      }

      function openPrintPanel() {
        const pages = printable();
        if (pages.length === 0) return;
        closeConfirm();
        // Förval: den aktuella sidan — eller, om den är tom, den senaste med text.
        const pre = pages.some((p) => p.i === board.cur) ? board.cur : pages[pages.length - 1].i;
        const frag = document.createDocumentFragment();
        for (const p of pages) {
          const label = document.createElement("label");
          const box = document.createElement("input");
          box.type = "checkbox";
          box.dataset.page = String(p.i);
          box.checked = p.i === pre;
          const meta = document.createElement("span");
          meta.className = "skr-printpanel__meta";
          const day = new Date(p.at || Date.now()).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
          meta.textContent = `Sida ${p.i + 1}${p.i === board.cur ? " (den här)" : ""} · ${day}`;
          const snip = document.createElement("span");
          snip.className = "skr-printpanel__snip";
          snip.textContent = p.text.trim().replace(/\s+/g, " ").slice(0, 80);
          label.append(box, meta, snip);
          frag.append(label);
        }
        printList.replaceChildren(frag);
        printAll.closest("label").hidden = pages.length < 2;
        drawPrintAll();
        printPanel.hidden = false;
        printBtn.setAttribute("aria-expanded", "true");
        printTitle.focus();
      }

      printBtn.addEventListener("click", () => {
        if (!printPanel.hidden) { closePrintPanel(); return; }
        openPrintPanel();
      });
      printList.addEventListener("change", drawPrintAll);
      printAll.addEventListener("change", () => {
        for (const b of printChecks()) b.checked = printAll.checked;
        drawPrintAll();
      });
      printPanel.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); closePrintPanel(); printBtn.focus(); }
        if (e.key === "Enter" && e.target === printTitle && !printGo.disabled) { e.preventDefault(); printGo.click(); }
      });
      printPanel.querySelector('[data-act="print-cancel"]').addEventListener("click", () => { closePrintPanel(); ta.focus(); });
      printGo.addEventListener("click", () => {
        const chosen = new Set(printChecks().filter((b) => b.checked).map((b) => Number(b.dataset.page)));
        const pages = printable().filter((p) => chosen.has(p.i));
        if (pages.length === 0) return;
        closePrintPanel();
        printSkrivPages({ pages, className: activeClass.name ?? "", title: printTitle.value })
          .catch((err) => { console.warn("[skriv] utskrift:", err); closeSkrivPrint(); });
      });

      // Ctrl+P direkt i lärarvyn: skriv ut den aktuella sidan, inte appen.
      const onBeforePrint = () => {
        if (hasSkrivPrint() || ta.value.trim() === "") return;
        buildSkrivPrint({ pages: [board.pages[board.cur]], className: activeClass.name ?? "", title: printTitle.value });
      };
      window.addEventListener("beforeprint", onBeforePrint);
      offs.push(() => { window.removeEventListener("beforeprint", onBeforePrint); closeSkrivPrint(); });

      prevBtn.addEventListener("click", () => { closeConfirm(); if (board.cur > 0) showPage(board.cur - 1); });
      nextBtn.addEventListener("click", () => { closeConfirm(); if (board.cur < board.pages.length - 1) showPage(board.cur + 1); });

      // ---- Start: läs det sparade (lokalt, synkront) ----

      offs.push(data.watch(skrivPath(cid), (docs) => {
        if (loaded) return; // lärarvyn är enda skribenten — bara första svaret
        loaded = true;
        board = normalizeBoard(docs.find((d) => d.id === DOC_ID));
        ta.value = board.pages[board.cur].text;
        ta.setSelectionRange(board.caret, board.caret);
        drawControls();
        relayout();
        publish(); // en redan öppen elevskärm visar direkt samma sak
      }));

      offResize(relayout);
      whenFontReady(relayout);
      requestAnimationFrame(() => { if (ta.isConnected) ta.focus({ preventScroll: true }); });
    }
  },

  async unmount() {
    for (const off of (this._offs ?? []).splice(0)) { try { off(); } catch { /* ok */ } }
  },
};

// ---- Markup-mallar --------------------------------------------------------

/** Dold mätrad för baslinjen (samma typsnitt och storlek som texten). */
const PROBE = `<div class="skr-text skr-probe" aria-hidden="true"><div class="skr-line">Ag<span class="skr-probe__base"></span></div></div>`;

function studentMarkup() {
  return `
    <section class="skr skr--student">
      <div class="skr-paper" aria-live="off">
        <div class="skr-sheet"><div class="skr-text" role="document" aria-label="Skrivtavla"></div></div>
        ${PROBE}
      </div>
    </section>`;
}

function teacherMarkup() {
  return `
    <section class="skr skr--teacher">
      <header class="skr-toolbar teacher-only">
        <div class="skr-group" role="group" aria-label="Textstorlek">
          <button type="button" class="btn skr-abtn" data-act="size-down" title="Mindre text" aria-label="Mindre text">A−</button>
          <span class="skr-size" aria-live="polite"></span>
          <button type="button" class="btn skr-abtn skr-abtn--big" data-act="size-up" title="Större text" aria-label="Större text">A+</button>
        </div>
        <div class="skr-group" role="group" aria-label="Ångra">
          <button type="button" class="btn btn--ghost btn--icon" data-undo="undo" title="Ångra (Ctrl+Z)" aria-label="Ångra">${icon("undo")}</button>
          <button type="button" class="btn btn--ghost btn--icon skr-redo" data-undo="redo" title="Gör om (Ctrl+Y)" aria-label="Gör om">${icon("undo")}</button>
        </div>
        <div class="skr-group skr-pages" role="group" aria-label="Sidor">
          <button type="button" class="btn btn--ghost btn--icon" data-act="page-prev" title="Föregående sida" aria-label="Föregående sida">${icon("chevron-left")}</button>
          <span class="skr-pagelabel" aria-live="polite"></span>
          <button type="button" class="btn btn--ghost btn--icon" data-act="page-next" title="Nästa sida" aria-label="Nästa sida">${icon("chevron-right")}</button>
          <button type="button" class="btn" data-act="new-page">${icon("file")}<span>Ny sida</span></button>
          <span class="skr-confirm" role="group" aria-label="Bekräfta ny sida" hidden>
            <span>Börja på en tom sida? Den här sparas bland de ${MAX_PAGES} senaste.</span>
            <button type="button" class="btn btn--primary" data-act="confirm-new">Ny sida</button>
            <button type="button" class="btn btn--ghost" data-act="cancel-new">Avbryt</button>
          </span>
        </div>
        <button type="button" class="btn skr-printbtn" data-act="print" aria-expanded="false" aria-disabled="true"
          title="Inget att skriva ut — sidan är tom">${icon("printer")}<span>Skriv ut</span></button>
        <button type="button" class="btn skr-follow" data-act="follow" aria-pressed="true"
          title="Papperet rullar så att raden du skriver på syns högt upp">${icon("pen")}<span>Följ skrivandet</span></button>
      </header>

      <div class="skr-printpanel teacher-only" role="group" aria-label="Skriv ut" hidden>
        <label class="skr-printpanel__field"><span>Rubrik (valfri)</span>
          <input type="text" name="skr-print-title" maxlength="80" autocomplete="off" placeholder="t.ex. Matte — bråk"></label>
        <fieldset class="skr-printpanel__pages">
          <legend>Vilka sidor?</legend>
          <label class="skr-printpanel__all"><input type="checkbox" data-print-all> Alla</label>
          <div class="skr-printpanel__list"></div>
        </fieldset>
        <div class="skr-printpanel__foot">
          <p class="skr-printpanel__note">A4 med linjer. Klass och datum står överst på varje sida, inga elevnamn läggs till.
            Välj <strong>Spara som PDF</strong> i utskriftsrutan för en fil.</p>
          <div class="skr-printpanel__actions">
            <button type="button" class="btn btn--primary" data-act="print-go">${icon("printer")}<span>Skriv ut…</span></button>
            <button type="button" class="btn btn--ghost" data-act="print-cancel">Avbryt</button>
          </div>
        </div>
      </div>

      <div class="skr-paper" tabindex="-1">
        <div class="skr-sheet">
          <textarea class="skr-text" aria-label="Skriv här — eleverna ser texten direkt" autocomplete="off"></textarea>
          <div class="skr-text skr-mirror" aria-hidden="true"></div>
        </div>
        ${PROBE}
      </div>
      <p class="skr-hint teacher-only">Skicka ut med <strong>Visa på elevskärm</strong>. Eleverna ser texten medan du skriver.
        Scrollar du själv följer elevskärmen din scroll. Texten sparas bara på den här datorn, aldrig i molnet.</p>
    </section>`;
}
